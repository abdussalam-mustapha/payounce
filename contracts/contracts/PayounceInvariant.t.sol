// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PayounceFactory} from "./PayounceFactory.sol";
import {PayounceCircle} from "./PayounceCircle.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";

/// @dev Drives a circle through random sequences of every user action.
contract CircleHandler is Test {
    PayounceCircle public c;
    MockV3Aggregator public oracle;
    address[] public actors;

    constructor(PayounceCircle c_, MockV3Aggregator oracle_, address[] memory actors_) {
        c = c_;
        oracle = oracle_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _seat(uint256 seed) internal view returns (uint8) {
        return uint8(seed % c.maxMembers());
    }

    function join(uint256 a, uint256 s) external {
        address who = _actor(a);
        uint8 seat = _seat(s);
        uint256 col = c.collateralFor(seat, who);
        vm.prank(who);
        c.join{value: col + (a % 3)}(seat); // sometimes overpay
    }

    function contribute(uint256 a) external {
        uint256 due = c.contributionDue();
        vm.prank(_actor(a));
        c.contribute{value: due}();
    }

    function prefund(uint256 a, uint256 amount) external {
        amount = bound(amount, 1, 30 ether);
        vm.prank(_actor(a));
        c.prefund{value: amount}(amount);
    }

    function withdrawPrefund(uint256 a) external {
        vm.prank(_actor(a));
        c.withdrawPrefund();
    }

    function topUp(uint256 a, uint256 amount) external {
        amount = bound(amount, 1, 20 ether);
        vm.prank(_actor(a));
        c.topUpCollateral{value: amount}(amount);
    }

    function proposeSwap(uint256 a, uint256 s, uint256 extra) external {
        extra = bound(extra, 0, 40 ether);
        vm.prank(_actor(a));
        c.proposeSwap{value: extra}(_seat(s));
    }

    function acceptSwap(uint256 a, uint256 b, uint256 extra) external {
        extra = bound(extra, 0, 40 ether);
        vm.prank(_actor(a));
        c.acceptSwap{value: extra}(_actor(b));
    }

    function cancelSwap(uint256 a) external {
        vm.prank(_actor(a));
        c.cancelSwap();
    }

    function requestGrace(uint256 a) external {
        vm.prank(_actor(a));
        c.requestGrace();
    }

    function approveGrace(uint256 a, uint256 b) external {
        vm.prank(_actor(a));
        c.approveGrace(_actor(b));
    }

    function settle() external {
        c.settleRound();
    }

    function leave(uint256 a) external {
        vm.prank(_actor(a));
        c.leave();
    }

    function cancel() external {
        c.cancel();
    }

    function withdraw(uint256 a) external {
        vm.prank(_actor(a));
        c.withdraw();
    }

    function passTime(uint256 secs) external {
        secs = bound(secs, 1, 3 days);
        vm.warp(block.timestamp + secs);
        oracle.updateAnswer(oracle.answer()); // keep the price fresh
    }

    function movePrice(uint256 p) external {
        oracle.updateAnswer(int256(bound(p, 5_000_000, 50_000_000)));
    }
}

contract PayounceInvariantTest is Test {
    PayounceCircle c;
    CircleHandler handler;
    address[] actors;

    function setUp() public {
        vm.warp(1_700_000_000);
        MockV3Aggregator oracle = new MockV3Aggregator(8, 15_000_000);
        PayounceFactory factory = new PayounceFactory(address(new PayounceCircle()), address(oracle), 1 days, address(this));
        for (uint256 i; i < 5; i++) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            vm.deal(a, 1_000_000 ether);
        }
        vm.prank(actors[0]);
        c = PayounceCircle(
            factory.createCircle(
                PayounceFactory.CircleConfig({
                    name: "Invariant",
                    token: address(0),
                    contribution: 500, // $5, USD-priced so the price moves too
                    usdPriced: true,
                    period: 1 days,
                    maxMembers: 4,
                    joinWindow: 5 days,
                    useReputation: true,
                    requireVerified: false,
                    premiumBps: 500
                })
            )
        );
        handler = new CircleHandler(c, oracle, actors);
        targetContract(address(handler));
    }

    /// The circle always holds exactly what it owes: nothing is created or lost.
    function invariant_solvent() public view {
        uint256 owed = c.pot() + c.forfeitPool() + c.premiumPool();
        for (uint256 i; i < actors.length; i++) {
            address a = actors[i];
            (,,,,, uint256 collateral,, uint256 prefunded) = c.members(a);
            (, , uint256 deposit) = c.swapOffers(a);
            owed += c.claimable(a) + collateral + prefunded + deposit;
        }
        assertEq(address(c).balance, owed);
    }

    /// Seats and membership stay consistent.
    function invariant_seatsMatchMembers() public view {
        address[] memory seats = c.getSeats();
        uint256 filled;
        for (uint256 i; i < seats.length; i++) {
            if (seats[i] == address(0)) continue;
            filled++;
            (bool joined,,,, uint8 seat,,,) = c.members(seats[i]);
            assertTrue(joined);
            assertEq(seat, i);
        }
        assertEq(filled, c.memberCount());
    }
}
