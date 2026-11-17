// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PayounceFactory} from "./PayounceFactory.sol";
import {PayounceCircle} from "./PayounceCircle.sol";
import {PayounceReputation} from "./PayounceReputation.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PayounceTestBase is Test {
    PayounceFactory factory;
    PayounceReputation rep;
    MockV3Aggregator oracle;
    MockERC20 usd;

    address attester = makeAddr("attester");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint64 constant WEEK = 7 days;
    uint256 constant C = 10 ether;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        oracle = new MockV3Aggregator(8, 15_000_000); // $0.15 per QIE
        PayounceCircle impl = new PayounceCircle();
        factory = new PayounceFactory(address(impl), address(oracle), 1 days, attester);
        rep = factory.reputation();
        usd = new MockERC20();
        address[3] memory all = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            vm.deal(all[i], 10_000 ether);
            usd.mint(all[i], 1_000e18);
        }
    }

    function _cfg() internal pure returns (PayounceFactory.CircleConfig memory c) {
        c = PayounceFactory.CircleConfig({
            name: "Family",
            token: address(0),
            contribution: C,
            usdPriced: false,
            period: WEEK,
            maxMembers: 3,
            joinWindow: 2 days,
            useReputation: false,
            requireVerified: false,
            premiumBps: 0
        });
    }

    function _create(PayounceFactory.CircleConfig memory cfg) internal returns (PayounceCircle) {
        vm.prank(alice);
        return PayounceCircle(factory.createCircle(cfg));
    }

    function _circle(bool useRep) internal returns (PayounceCircle) {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.useReputation = useRep;
        return _create(cfg);
    }

    function _join(PayounceCircle c, address who, uint8 seat) internal {
        uint256 col = c.collateralFor(seat, who);
        vm.prank(who);
        c.join{value: col}(seat);
    }

    function _fill(PayounceCircle c) internal {
        _join(c, alice, 0);
        _join(c, bob, 1);
        _join(c, carol, 2);
    }

    function _pay(PayounceCircle c, address who) internal {
        uint256 due = c.contributionDue();
        vm.prank(who);
        c.contribute{value: due}();
    }

    function _payAll(PayounceCircle c) internal {
        _pay(c, alice);
        _pay(c, bob);
        _pay(c, carol);
    }

    function _runClean(PayounceCircle c) internal {
        _fill(c);
        for (uint256 r; r < 3; r++) {
            _payAll(c);
            c.settleRound();
        }
    }

    function _collateral(PayounceCircle c, address who) internal view returns (uint256 col) {
        (,,,,, col,,) = c.members(who);
    }

    function _defaulted(PayounceCircle c, address who) internal view returns (bool d) {
        (, d,,,,,,) = c.members(who);
    }
}

contract PayounceCircleTest is PayounceTestBase {
    // ---------------- clones ----------------

    function test_implementationAndClonesCannotBeReinitialised() public {
        PayounceCircle c = _circle(false);
        PayounceCircle.Params memory p;
        vm.expectRevert(PayounceCircle.AlreadyInitialized.selector);
        c.initialize(p);
        PayounceCircle impl = PayounceCircle(factory.implementation());
        vm.expectRevert(PayounceCircle.AlreadyInitialized.selector);
        impl.initialize(p);
    }

    // ---------------- seat-based collateral ----------------

    function test_collateralDependsOnSeat() public {
        PayounceCircle c = _circle(false);
        assertEq(c.baseCollateral(0), 2 * C);
        assertEq(c.baseCollateral(1), C);
        assertEq(c.baseCollateral(2), 0);
        vm.expectRevert(PayounceCircle.InvalidSeat.selector);
        c.baseCollateral(3);
    }

    function test_seatRules() public {
        PayounceCircle c = _circle(false);
        _join(c, alice, 1);
        vm.prank(bob);
        vm.expectRevert(PayounceCircle.SeatTaken.selector);
        c.join{value: C}(1);
        vm.prank(alice);
        vm.expectRevert(PayounceCircle.AlreadyJoined.selector);
        c.join{value: 2 * C}(0);
        vm.prank(bob);
        vm.expectRevert(PayounceCircle.InvalidSeat.selector);
        c.join(7);
        vm.prank(bob);
        vm.expectRevert(PayounceCircle.InsufficientPayment.selector);
        c.join{value: C}(0);
    }

    function test_fullCircleEveryonePays() public {
        PayounceCircle c = _circle(false);
        _runClean(c);
        assertEq(uint8(c.status()), uint8(PayounceCircle.Status.Completed));
        assertEq(c.claimable(alice), 3 * C + 2 * C);
        assertEq(c.claimable(bob), 3 * C + C);
        assertEq(c.claimable(carol), 3 * C);
    }

    function test_earlyTakerCannotHurtTheGroup() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        _payAll(c);
        c.settleRound(); // alice takes 3C and walks away
        for (uint256 r = 1; r < 3; r++) {
            _pay(c, bob);
            _pay(c, carol);
            vm.warp(c.roundDeadline(r) + 1);
            c.settleRound();
        }
        assertEq(c.claimable(bob), 3 * C + C);
        assertEq(c.claimable(carol), 3 * C);
        assertEq(c.claimable(alice), 3 * C);
        assertFalse(_defaulted(c, alice));
    }

    function test_lateSeatDefaultIsRefundedMinusPenalty() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        _payAll(c);
        c.settleRound();
        _pay(c, alice);
        _pay(c, bob);
        vm.warp(c.roundDeadline(1) + 1);
        c.settleRound(); // carol (no collateral) misses -> defaults
        assertTrue(_defaulted(c, carol));
        _pay(c, alice);
        _pay(c, bob);
        c.settleRound();
        assertEq(c.claimable(carol), 9 ether);
        assertEq(c.claimable(alice), 3 * C + 2 * C + 5.5 ether);
        assertEq(c.claimable(bob), 2 * C + C + 5.5 ether);
        assertEq(address(c).balance, c.claimable(alice) + c.claimable(bob) + c.claimable(carol));
    }

    // ---------------- seat premium ----------------

    function test_premiumMovesFromEarlyToLateSeats() public {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.premiumBps = 1_000; // 10% of a contribution per seat-step
        PayounceCircle c = _create(cfg);
        assertEq(c.premiumFor(0), 2 ether); // 2 steps × 10% × 10
        assertEq(c.premiumFor(1), 1 ether);
        assertEq(c.premiumFor(2), 0);
        _runClean(c);
        // pool = 3 ether, weights: bob 1, carol 2
        assertEq(c.claimable(alice), 3 * C - 2 ether + 2 * C);
        assertEq(c.claimable(bob), 3 * C - 1 ether + C + 1 ether);
        assertEq(c.claimable(carol), 3 * C + 2 ether);
        assertEq(address(c).balance, c.claimable(alice) + c.claimable(bob) + c.claimable(carol));
    }

    function test_premiumCappedByFactory() public {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.premiumBps = 2_001;
        vm.expectRevert(PayounceFactory.InvalidParams.selector);
        factory.createCircle(cfg);
    }

    // ---------------- pay ahead ----------------

    function test_prefundPaysAutomaticallyAndCountsOnTime() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        vm.prank(carol);
        c.prefund{value: 3 * C}(3 * C); // carol is travelling

        _pay(c, alice);
        _pay(c, bob);
        assertTrue(c.roundCovered());
        c.settleRound(); // settles early: carol's prefund pays
        assertTrue(c.hasPaid(0, carol));
        assertEq(rep.recordOf(carol).onTimePayments, 1);
        assertEq(rep.recordOf(carol).missedPayments, 0);

        for (uint256 r = 1; r < 3; r++) {
            _pay(c, alice);
            _pay(c, bob);
            c.settleRound();
        }
        assertEq(c.claimable(carol), 3 * C);
        assertEq(rep.recordOf(carol).onTimePayments, 3);
    }

    function test_unusedPrefundReturns() public {
        PayounceCircle c = _circle(false);
        _join(c, alice, 0);
        vm.prank(alice);
        c.prefund{value: C}(C);
        vm.prank(alice);
        c.withdrawPrefund();
        assertEq(c.claimable(alice), C);
    }

    // ---------------- seat swaps ----------------

    function test_swapRebalancesCollateral() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        // carol (seat 2, 0 locked) needs cash early and swaps with bob (seat 1, C locked)
        vm.prank(carol);
        c.proposeSwap{value: C}(1);
        vm.prank(bob);
        c.acceptSwap(carol);

        assertEq(c.getSeats()[1], carol);
        assertEq(c.getSeats()[2], bob);
        assertEq(_collateral(c, carol), C);
        assertEq(_collateral(c, bob), 0);
        assertEq(c.claimable(bob), C); // bob's surplus collateral is freed
    }

    function test_paidOutSeatsCannotSwap() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        _payAll(c);
        c.settleRound();
        vm.prank(alice);
        vm.expectRevert(PayounceCircle.SeatLocked.selector);
        c.proposeSwap(2);
        vm.prank(bob); // bob's seat 1 is the current round
        vm.expectRevert(PayounceCircle.SeatLocked.selector);
        c.proposeSwap(2);
    }

    function test_swapOnlyByTargetHolder() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        vm.prank(carol);
        c.proposeSwap{value: C}(1);
        vm.prank(alice);
        vm.expectRevert(PayounceCircle.NoOffer.selector);
        c.acceptSwap(carol);
        vm.prank(carol);
        c.cancelSwap();
        assertEq(c.claimable(carol), C);
    }

    // ---------------- hardship grace ----------------

    function test_graceNeedsStrictMajority() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        _payAll(c);
        c.settleRound();

        vm.prank(alice); // alice (paid out, 2C collateral) hits hardship
        c.requestGrace();
        vm.prank(bob);
        c.approveGrace(alice);
        assertFalse(c.graceApproved(alice)); // 1 of 2 others is a tie, not a majority
        vm.prank(carol);
        c.approveGrace(alice);
        assertTrue(c.graceApproved(alice));
    }

    function test_graceNeedsMajorityAndIsNotAMiss() public {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.maxMembers = 4;
        PayounceCircle c = _create(cfg);
        address dave = makeAddr("dave");
        vm.deal(dave, 1_000 ether);
        _join(c, alice, 0);
        _join(c, bob, 1);
        _join(c, carol, 2);
        _join(c, dave, 3);

        _pay(c, alice);
        _pay(c, bob);
        _pay(c, dave);
        vm.prank(carol);
        c.requestGrace();
        vm.prank(alice);
        c.approveGrace(carol);
        assertFalse(c.graceApproved(carol)); // 1 of 3 others
        vm.prank(bob);
        c.approveGrace(carol);
        assertTrue(c.graceApproved(carol)); // 2 of 3

        vm.prank(bob);
        vm.expectRevert(PayounceCircle.CannotVote.selector);
        c.approveGrace(carol);

        vm.warp(c.roundDeadline(0) + 1);
        c.settleRound();
        assertEq(rep.recordOf(carol).missedPayments, 0);
        assertEq(rep.recordOf(carol).gracesReceived, 1);
        assertEq(c.claimable(alice), 4 * C); // pot still whole

        vm.prank(carol);
        vm.expectRevert(PayounceCircle.GraceUnavailable.selector);
        c.requestGrace(); // one grace per circle
    }

    // ---------------- reputation & verification ----------------

    function test_reputationBuildsAndDiscountsCollateral() public {
        _runClean(_circle(false));
        PayounceReputation.Record memory r = rep.recordOf(alice);
        assertEq(r.circlesJoined, 1);
        assertEq(r.circlesCompleted, 1);
        assertEq(r.onTimePayments, 3);
        assertEq(rep.discountBps(alice), 2_500);
        assertEq(rep.circlesOf(alice).length, 1);

        PayounceCircle withRep = _circle(true);
        assertEq(withRep.collateralFor(0, alice), (2 * C * 3) / 4);
        assertEq(withRep.collateralFor(0, makeAddr("newcomer")), 2 * C);
        assertEq(_circle(false).collateralFor(0, alice), 2 * C);
    }

    function test_discountCapsAtHalf() public {
        for (uint256 i; i < 3; i++) _runClean(_circle(false));
        assertEq(rep.discountBps(alice), 5_000);
    }

    function test_defaultWipesDiscount() public {
        _runClean(_circle(false));
        PayounceCircle c = _circle(false);
        _fill(c);
        _payAll(c);
        c.settleRound();
        _pay(c, alice);
        _pay(c, bob);
        vm.warp(c.roundDeadline(1) + 1);
        c.settleRound();
        _pay(c, alice);
        _pay(c, bob);
        c.settleRound();
        assertEq(rep.recordOf(carol).defaults, 1);
        assertEq(rep.discountBps(carol), 0);
    }

    function test_verifiedOnlyCircle() public {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.requireVerified = true;
        PayounceCircle c = _create(cfg);
        vm.prank(carol);
        vm.expectRevert(PayounceCircle.NotVerified.selector);
        c.join(2);

        vm.prank(alice);
        vm.expectRevert(PayounceReputation.NotAttester.selector);
        rep.setVerified(carol, true);

        vm.prank(attester);
        rep.setVerified(carol, true);
        vm.prank(carol);
        c.join(2);
        assertEq(c.getSeats()[2], carol);
    }

    function test_onlyCirclesWriteReputation() public {
        vm.expectRevert(PayounceReputation.NotCircle.selector);
        rep.recordFinish(alice, false);
        vm.expectRevert(PayounceReputation.NotFactory.selector);
        rep.registerCircle(address(this));
    }

    // ---------------- lifecycle ----------------

    function test_leaveBeforeStartFreesSeat() public {
        PayounceCircle c = _circle(false);
        _join(c, alice, 0);
        vm.prank(alice);
        c.leave();
        assertEq(c.getSeats()[0], address(0));
        assertEq(c.claimable(alice), 2 * C);
        _join(c, bob, 0);
        assertEq(c.getSeats()[0], bob);
    }

    function test_cancelUnfilledCircle() public {
        PayounceCircle c = _circle(false);
        _join(c, alice, 0);
        vm.expectRevert(PayounceCircle.RoundStillOpen.selector);
        c.cancel();
        vm.warp(block.timestamp + 2 days + 1);
        c.cancel();
        assertEq(c.claimable(alice), 2 * C);
    }

    function test_contributeRules() public {
        PayounceCircle c = _circle(false);
        _fill(c);
        _pay(c, alice);
        vm.prank(alice);
        vm.expectRevert(PayounceCircle.AlreadyPaid.selector);
        c.contribute{value: C}();
        vm.warp(c.roundDeadline(0) + 1);
        vm.prank(bob);
        vm.expectRevert(PayounceCircle.RoundClosed.selector);
        c.contribute{value: C}();
    }

    function test_factoryRejectsBadParams() public {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.maxMembers = 1;
        vm.expectRevert(PayounceFactory.InvalidParams.selector);
        factory.createCircle(cfg);
        cfg = _cfg();
        cfg.token = address(usd);
        cfg.usdPriced = true;
        vm.expectRevert(PayounceFactory.InvalidParams.selector);
        factory.createCircle(cfg);
    }

    // ---------------- pricing & tokens ----------------

    function test_usdPricedSeats() public {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.contribution = 1_500; // $15
        cfg.usdPriced = true;
        cfg.maxMembers = 2;
        PayounceCircle c = _create(cfg);
        assertEq(c.contributionDue(), 100 ether);
        assertEq(c.baseCollateral(0), 100 ether);
        oracle.updateAnswer(30_000_000);
        assertEq(c.contributionDue(), 50 ether);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(PayounceCircle.StalePrice.selector);
        c.contributionDue();
    }

    function test_erc20Circle() public {
        PayounceFactory.CircleConfig memory cfg = _cfg();
        cfg.token = address(usd);
        cfg.contribution = 50e18;
        cfg.maxMembers = 2;
        PayounceCircle c = _create(cfg);
        vm.startPrank(alice);
        usd.approve(address(c), type(uint256).max);
        c.join(0);
        vm.stopPrank();
        vm.startPrank(bob);
        usd.approve(address(c), type(uint256).max);
        c.join(1);
        vm.stopPrank();
        for (uint256 r; r < 2; r++) {
            vm.prank(alice);
            c.contribute();
            vm.prank(bob);
            c.contribute();
            c.settleRound();
        }
        assertEq(c.claimable(alice), 150e18);
        assertEq(c.claimable(bob), 100e18);
    }
}
