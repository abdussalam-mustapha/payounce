// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {PayounceReputation} from "./PayounceReputation.sol";

/// @title PayounceCircle
/// @notice A rotating savings circle where nobody can lose money.
///
/// Seats: seat k collects the pot in round k and locks what it still owes afterwards,
///     collateral(k) = contribution × (members − 1 − k)
/// so the first seat locks the most and the last seat locks nothing.
///
/// Seat premium: early seats are effectively a loan from later seats. With `premiumBps > 0`, seat k
/// pays premiumBps × (members − 1 − k) of one contribution out of its payout; the premiums are shared
/// among members by seat position when the circle ends. Savers earn, early-cash seekers pay a fair price.
///
/// Track record: every join, payment and result is written to `PayounceReputation`. Circles with
/// `useReputation` cut early-seat collateral for members with a clean history; circles with
/// `requireVerified` only admit QIE ID-verified members.
///
/// Flexibility: members can pay rounds ahead, swap seats by mutual consent (collateral rebalances),
/// top up collateral, and ask the group for one round of hardship grace.
///
/// Defaults: a missed round is taken from collateral. A member who runs out defaults; if they had not
/// been paid out yet they are refunded what they paid in minus 10%. Defaulted pots go to the others.
///
/// @dev Deployed as EIP-1167 clones by PayounceFactory; configured once through `initialize`.
/// All payouts are credited to `claimable` and pulled with `withdraw()`.
contract PayounceCircle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Open,
        Active,
        Completed,
        Cancelled
    }

    struct Member {
        bool joined;
        bool defaulted;
        bool receivedPayout;
        bool graceUsed;
        uint8 seat;
        uint256 collateral;
        uint256 contributed; // everything paid in (including amounts covered from collateral)
        uint256 prefunded; // paid ahead, used automatically at settlement
    }

    struct Params {
        string name;
        address creator;
        address token; // address(0) = native QIE
        uint256 contribution; // token units, or USD cents when usdPriced
        bool usdPriced;
        uint64 period;
        uint8 maxMembers;
        uint64 joinDeadline;
        bool useReputation;
        bool requireVerified;
        uint16 premiumBps; // per seat-step, max 2_000 (20%)
        address oracle;
        uint256 maxPriceAge;
        address reputation;
    }

    struct SwapOffer {
        bool active;
        uint8 targetSeat;
        uint256 deposit; // extra collateral escrowed by the proposer
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant DEFAULT_PENALTY_BPS = 1_000; // 10% of what a pre-payout defaulter paid in
    uint16 public constant MAX_PREMIUM_BPS = 2_000;

    // ---- configuration (set once) ----
    bool public initialized;
    string public name;
    address public creator;
    address public token;
    uint256 public contribution;
    bool public usdPriced;
    uint64 public period;
    uint8 public maxMembers;
    uint64 public joinDeadline;
    bool public useReputation;
    bool public requireVerified;
    uint16 public premiumBps;
    AggregatorV3Interface public oracle;
    uint256 public maxPriceAge;
    PayounceReputation public reputation;

    // ---- state ----
    Status public status;
    uint64 public startTime;
    uint256 public currentRound;
    uint256 public pot;
    uint256 public paidCount;
    uint256 public activeCount;
    uint256 public memberCount;
    uint256 public forfeitPool;
    uint256 public premiumPool;

    address[] internal _seats; // seat index => member (address(0) = empty)
    mapping(address => Member) public members;
    mapping(uint256 => mapping(address => bool)) public hasPaid;
    mapping(address => uint256) public claimable;
    mapping(address => SwapOffer) public swapOffers;
    mapping(address => uint256) public graceRequestRound; // round + 1 the member asked grace for
    mapping(address => uint256) public graceVotes;
    mapping(uint256 => mapping(address => mapping(address => bool))) public graceVoted; // round => member => voter

    event Joined(address indexed member, uint8 seat, uint256 collateral);
    event Left(address indexed member, uint8 seat);
    event Started(uint64 startTime);
    event Contributed(uint256 indexed round, address indexed member, uint256 amount, bool fromPrefund);
    event Prefunded(address indexed member, uint256 amount);
    event CollateralToppedUp(address indexed member, uint256 amount);
    event Slashed(uint256 indexed round, address indexed member, uint256 amount, bool defaulted, bool graced);
    event RoundSettled(uint256 indexed round, address indexed recipient, uint256 amount, uint256 premium, bool forfeited);
    event SwapProposed(address indexed proposer, uint8 fromSeat, uint8 toSeat, uint256 deposit);
    event SwapCancelled(address indexed proposer);
    event Swapped(address indexed a, address indexed b, uint8 seatA, uint8 seatB);
    event GraceRequested(address indexed member, uint256 round);
    event GraceApproved(address indexed member, address indexed voter, uint256 votes);
    event Completed();
    event Cancelled();
    event Withdrawn(address indexed account, uint256 amount);

    error AlreadyInitialized();
    error WrongStatus();
    error JoinClosed();
    error AlreadyJoined();
    error SeatTaken();
    error InvalidSeat();
    error NotMember();
    error NotVerified();
    error MemberDefaulted();
    error AlreadyPaid();
    error RoundClosed();
    error RoundStillOpen();
    error InsufficientPayment();
    error InsufficientCollateral();
    error UnexpectedValue();
    error StalePrice();
    error BadPrice();
    error NothingToWithdraw();
    error TransferFailed();
    error SeatLocked();
    error NoOffer();
    error OfferExists();
    error GraceUnavailable();
    error CannotVote();

    /// @dev Locks the implementation contract; clones are configured through `initialize`.
    constructor() {
        initialized = true;
    }

    function initialize(Params calldata p) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        name = p.name;
        creator = p.creator;
        token = p.token;
        contribution = p.contribution;
        usdPriced = p.usdPriced;
        period = p.period;
        maxMembers = p.maxMembers;
        joinDeadline = p.joinDeadline;
        useReputation = p.useReputation;
        requireVerified = p.requireVerified;
        premiumBps = p.premiumBps;
        oracle = AggregatorV3Interface(p.oracle);
        maxPriceAge = p.maxPriceAge;
        reputation = PayounceReputation(p.reputation);
        _seats = new address[](p.maxMembers);
    }

    // ==================================================================
    // Pricing
    // ==================================================================

    /// @notice Amount (token units / wei) one round's payment costs right now.
    function contributionDue() public view returns (uint256) {
        return usdPriced ? usdCentsToNative(contribution) : contribution;
    }

    /// @notice Converts USD cents to native QIE (18 decimals) using the QIE Oracle.
    function usdCentsToNative(uint256 cents) public view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxPriceAge) revert StalePrice();
        return Math.mulDiv(cents * 1e18, 10 ** oracle.decimals(), uint256(answer) * 100);
    }

    /// @notice Full collateral for a seat, before any track-record discount.
    function baseCollateral(uint8 seat) public view returns (uint256) {
        if (seat >= maxMembers) revert InvalidSeat();
        return contributionDue() * (uint256(maxMembers) - 1 - seat);
    }

    /// @notice Collateral `who` needs for `seat` right now.
    function collateralFor(uint8 seat, address who) public view returns (uint256) {
        uint256 base = baseCollateral(seat);
        if (!useReputation || base == 0) return base;
        return Math.mulDiv(base, BPS - reputation.discountBps(who), BPS);
    }

    /// @notice Premium the holder of `seat` pays out of their payout.
    function premiumFor(uint8 seat) public view returns (uint256) {
        if (seat >= maxMembers) revert InvalidSeat();
        if (premiumBps == 0) return 0;
        return Math.mulDiv(contributionDue(), uint256(premiumBps) * (uint256(maxMembers) - 1 - seat), BPS);
    }

    // ==================================================================
    // Joining
    // ==================================================================

    function join(uint8 seat) external payable nonReentrant {
        if (status != Status.Open) revert WrongStatus();
        if (block.timestamp > joinDeadline) revert JoinClosed();
        if (seat >= maxMembers) revert InvalidSeat();
        if (_seats[seat] != address(0)) revert SeatTaken();
        if (requireVerified && !reputation.isVerified(msg.sender)) revert NotVerified();
        Member storage m = members[msg.sender];
        if (m.joined) revert AlreadyJoined();

        uint256 amount = collateralFor(seat, msg.sender);
        _collect(amount);

        m.joined = true;
        m.seat = seat;
        m.collateral = amount;
        _seats[seat] = msg.sender;
        memberCount++;
        activeCount++;
        reputation.recordJoin(msg.sender);
        emit Joined(msg.sender, seat, amount);

        if (memberCount == maxMembers) {
            status = Status.Active;
            startTime = uint64(block.timestamp);
            emit Started(startTime);
        }
    }

    /// @notice Leave before the circle starts; collateral (and any swap deposit) is credited back.
    function leave() external {
        if (status != Status.Open) revert WrongStatus();
        Member storage m = members[msg.sender];
        if (!m.joined) revert NotMember();
        uint8 seat = m.seat;
        claimable[msg.sender] += m.collateral + m.prefunded + _clearOffer(msg.sender);
        _seats[seat] = address(0);
        delete members[msg.sender];
        memberCount--;
        activeCount--;
        emit Left(msg.sender, seat);
    }

    /// @notice Anyone can cancel a circle that did not fill before the join deadline.
    function cancel() external {
        if (status != Status.Open) revert WrongStatus();
        if (block.timestamp <= joinDeadline) revert RoundStillOpen();
        status = Status.Cancelled;
        for (uint256 i; i < maxMembers; i++) {
            address a = _seats[i];
            if (a == address(0)) continue;
            Member storage m = members[a];
            claimable[a] += m.collateral + m.prefunded + _clearOffer(a);
            m.collateral = 0;
            m.prefunded = 0;
        }
        emit Cancelled();
    }

    // ==================================================================
    // Paying
    // ==================================================================

    function roundDeadline(uint256 round) public view returns (uint256) {
        return uint256(startTime) + (round + 1) * uint256(period);
    }

    function contribute() external payable nonReentrant {
        Member storage m = _activeMember();
        uint256 round = currentRound;
        if (hasPaid[round][msg.sender]) revert AlreadyPaid();
        if (block.timestamp > roundDeadline(round)) revert RoundClosed();

        uint256 amount = contributionDue();
        _collect(amount);
        _markPaid(m, msg.sender, round, amount, false);
    }

    /// @notice Pay ahead. Prefunded money pays your rounds automatically at settlement, on time.
    function prefund(uint256 amount) external payable nonReentrant {
        if (status != Status.Open && status != Status.Active) revert WrongStatus();
        Member storage m = members[msg.sender];
        if (!m.joined) revert NotMember();
        if (m.defaulted) revert MemberDefaulted();
        if (amount == 0) revert InsufficientPayment();
        _collect(amount);
        m.prefunded += amount;
        emit Prefunded(msg.sender, amount);
    }

    /// @notice Take unused prefunded money back.
    function withdrawPrefund() external {
        Member storage m = members[msg.sender];
        uint256 amount = m.prefunded;
        if (amount == 0) revert NothingToWithdraw();
        m.prefunded = 0;
        claimable[msg.sender] += amount;
    }

    /// @notice Add collateral, e.g. to restore protection after a covered miss or a grace round.
    function topUpCollateral(uint256 amount) external payable nonReentrant {
        if (status != Status.Open && status != Status.Active) revert WrongStatus();
        Member storage m = members[msg.sender];
        if (!m.joined) revert NotMember();
        if (m.defaulted) revert MemberDefaulted();
        if (amount == 0) revert InsufficientPayment();
        _collect(amount);
        m.collateral += amount;
        emit CollateralToppedUp(msg.sender, amount);
    }

    // ==================================================================
    // Settling
    // ==================================================================

    /// @notice True when every active member has paid or has enough prefunded to pay.
    function roundCovered() public view returns (bool) {
        if (status != Status.Active) return false;
        if (paidCount >= activeCount) return true;
        uint256 due = contributionDue();
        uint256 covered = paidCount;
        for (uint256 i; i < maxMembers; i++) {
            address a = _seats[i];
            Member storage m = members[a];
            if (!m.defaulted && !hasPaid[currentRound][a] && m.prefunded >= due) covered++;
        }
        return covered >= activeCount;
    }

    /// @notice Close the current round once it is covered, or after the deadline.
    /// Unpaid members pay from prefund first, then collateral (graced members carry no mark on their record).
    function settleRound() external nonReentrant {
        if (status != Status.Active) revert WrongStatus();
        uint256 round = currentRound;
        if (!roundCovered() && block.timestamp <= roundDeadline(round)) revert RoundStillOpen();

        if (paidCount < activeCount) {
            uint256 due = contributionDue();
            for (uint256 i; i < maxMembers; i++) {
                address a = _seats[i];
                Member storage m = members[a];
                if (m.defaulted || hasPaid[round][a]) continue;

                if (m.prefunded >= due) {
                    m.prefunded -= due;
                    _markPaid(m, a, round, due, true);
                    continue;
                }

                bool graced = graceApproved(a);
                uint256 taken;
                if (m.collateral >= due) {
                    taken = due;
                    m.collateral -= due;
                } else {
                    taken = m.collateral;
                    m.collateral = 0;
                    m.defaulted = true;
                    activeCount--;
                }
                m.contributed += taken;
                pot += taken;
                if (graced && !m.defaulted) {
                    m.graceUsed = true;
                    reputation.recordGrace(a);
                } else {
                    reputation.recordPayment(a, false);
                }
                emit Slashed(round, a, taken, m.defaulted, graced);
            }
        }

        address recipient = _seats[round];
        Member storage r = members[recipient];
        uint256 amount = pot;
        uint256 premium;
        bool forfeited = r.defaulted;
        if (forfeited) {
            forfeitPool += amount;
        } else {
            premium = Math.min(premiumFor(uint8(round)), amount);
            premiumPool += premium;
            claimable[recipient] += amount - premium;
            r.receivedPayout = true;
        }

        pot = 0;
        paidCount = 0;
        currentRound = round + 1;
        emit RoundSettled(round, recipient, amount - premium, premium, forfeited);

        if (currentRound == maxMembers) _complete();
    }

    function _complete() internal {
        status = Status.Completed;
        uint256 n = maxMembers;

        // 1) Refund members who defaulted before their payout, minus the penalty.
        uint256 pool = forfeitPool;
        for (uint256 i; i < n; i++) {
            Member storage m = members[_seats[i]];
            if (!m.defaulted || m.receivedPayout || pool == 0) continue;
            uint256 refund = m.contributed - Math.mulDiv(m.contributed, DEFAULT_PENALTY_BPS, BPS);
            if (refund > pool) refund = pool;
            claimable[_seats[i]] += refund;
            pool -= refund;
        }

        // 2) Share premiums by seat position (later seats waited longer) among members in good standing.
        uint256 weightSum;
        for (uint256 i; i < n; i++) {
            if (!members[_seats[i]].defaulted) weightSum += i;
        }
        uint256 premiums = premiumPool;
        uint256 premiumPaid;
        if (premiums > 0 && weightSum > 0) {
            for (uint256 i; i < n; i++) {
                if (members[_seats[i]].defaulted || i == 0) continue;
                uint256 part = Math.mulDiv(premiums, i, weightSum);
                claimable[_seats[i]] += part;
                premiumPaid += part;
            }
        }
        pool += premiums - premiumPaid; // rounding dust, or premiums with no eligible later seat

        // 3) Share forfeits, return collateral and prefunds, record results.
        uint256 good = activeCount;
        uint256 share = good == 0 ? 0 : pool / good;
        uint256 dust = pool - share * good;
        if (good == 0) claimable[creator] += pool;
        bool dustPaid;
        for (uint256 i; i < n; i++) {
            address a = _seats[i];
            Member storage m = members[a];
            uint256 credit = m.collateral + m.prefunded + _clearOffer(a);
            m.collateral = 0;
            m.prefunded = 0;
            if (!m.defaulted) {
                credit += share;
                if (!dustPaid) {
                    credit += dust;
                    dustPaid = true;
                }
            }
            claimable[a] += credit;
            reputation.recordFinish(a, m.defaulted);
        }
        forfeitPool = 0;
        premiumPool = 0;
        emit Completed();
    }

    // ==================================================================
    // Seat swaps
    // ==================================================================

    /// @notice Offer to swap your seat with the holder of `targetSeat`. If the new seat needs more
    /// collateral than you hold, send the difference now (it is escrowed until the swap or cancel).
    function proposeSwap(uint8 targetSeat) external payable nonReentrant {
        if (status != Status.Open && status != Status.Active) revert WrongStatus();
        Member storage m = members[msg.sender];
        if (!m.joined) revert NotMember();
        if (m.defaulted) revert MemberDefaulted();
        if (swapOffers[msg.sender].active) revert OfferExists();
        if (targetSeat >= maxMembers) revert InvalidSeat();
        address other = _seats[targetSeat];
        if (other == address(0) || other == msg.sender) revert InvalidSeat();
        _requireSwappable(m.seat);
        _requireSwappable(targetSeat);

        uint256 need = collateralFor(targetSeat, msg.sender);
        uint256 deposit = need > m.collateral ? need - m.collateral : 0;
        _collect(deposit);
        swapOffers[msg.sender] = SwapOffer({active: true, targetSeat: targetSeat, deposit: deposit});
        emit SwapProposed(msg.sender, m.seat, targetSeat, deposit);
    }

    function cancelSwap() external {
        if (!swapOffers[msg.sender].active) revert NoOffer();
        claimable[msg.sender] += _clearOffer(msg.sender);
        emit SwapCancelled(msg.sender);
    }

    /// @notice Accept `proposer`'s offer for your seat. Collateral is rebalanced for both seats:
    /// any surplus is credited back, and you send any extra your new seat needs.
    function acceptSwap(address proposer) external payable nonReentrant {
        if (status != Status.Open && status != Status.Active) revert WrongStatus();
        SwapOffer memory o = swapOffers[proposer];
        if (!o.active) revert NoOffer();
        if (_seats[o.targetSeat] != msg.sender) revert NoOffer();
        Member storage a = members[proposer];
        Member storage b = members[msg.sender];
        if (a.defaulted || b.defaulted) revert MemberDefaulted();
        uint8 seatA = a.seat;
        uint8 seatB = o.targetSeat;
        _requireSwappable(seatA);
        _requireSwappable(seatB);
        delete swapOffers[proposer];

        // proposer moves to seatB
        uint256 needA = collateralFor(seatB, proposer);
        uint256 haveA = a.collateral + o.deposit;
        if (haveA < needA) revert InsufficientCollateral();
        claimable[proposer] += haveA - needA;
        a.collateral = needA;

        // acceptor moves to seatA
        uint256 needB = collateralFor(seatA, msg.sender);
        if (b.collateral < needB) {
            _collect(needB - b.collateral);
        } else {
            claimable[msg.sender] += b.collateral - needB;
            if (msg.value > 0 && token == address(0)) claimable[msg.sender] += msg.value;
            if (msg.value > 0 && token != address(0)) revert UnexpectedValue();
        }
        b.collateral = needB;

        a.seat = seatB;
        b.seat = seatA;
        _seats[seatA] = msg.sender;
        _seats[seatB] = proposer;
        emit Swapped(proposer, msg.sender, seatA, seatB);
    }

    // ==================================================================
    // Hardship grace
    // ==================================================================

    /// @notice Ask the group to forgive missing this round: it is still covered from your collateral,
    /// but it is not recorded as a miss. One grace per member per circle; needs a majority of the others.
    function requestGrace() external {
        Member storage m = _activeMember();
        if (m.graceUsed || hasPaid[currentRound][msg.sender]) revert GraceUnavailable();
        if (graceRequestRound[msg.sender] == currentRound + 1) revert GraceUnavailable();
        graceRequestRound[msg.sender] = currentRound + 1;
        graceVotes[msg.sender] = 0;
        emit GraceRequested(msg.sender, currentRound);
    }

    function approveGrace(address member) external {
        _activeMember();
        if (member == msg.sender) revert CannotVote();
        if (graceRequestRound[member] != currentRound + 1) revert GraceUnavailable();
        if (graceVoted[currentRound][member][msg.sender]) revert CannotVote();
        graceVoted[currentRound][member][msg.sender] = true;
        graceVotes[member]++;
        emit GraceApproved(member, msg.sender, graceVotes[member]);
    }

    /// @notice Whether `member`'s grace request for the current round has a majority of the other active members.
    function graceApproved(address member) public view returns (bool) {
        Member storage m = members[member];
        if (m.graceUsed || m.defaulted || graceRequestRound[member] != currentRound + 1) return false;
        uint256 others = activeCount - 1;
        return others > 0 && graceVotes[member] * 2 > others;
    }

    // ==================================================================
    // Withdrawals
    // ==================================================================

    function withdraw() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;
        if (token == address(0)) {
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit Withdrawn(msg.sender, amount);
    }

    // ==================================================================
    // Views
    // ==================================================================

    /// @notice Seat holders in payout order; address(0) marks an open seat.
    function getSeats() external view returns (address[] memory) {
        return _seats;
    }

    function currentRecipient() external view returns (address) {
        if (status != Status.Active) return address(0);
        return _seats[currentRound];
    }

    // ==================================================================
    // Internal
    // ==================================================================

    function _activeMember() internal view returns (Member storage m) {
        if (status != Status.Active) revert WrongStatus();
        m = members[msg.sender];
        if (!m.joined) revert NotMember();
        if (m.defaulted) revert MemberDefaulted();
    }

    function _markPaid(Member storage m, address who, uint256 round, uint256 amount, bool fromPrefund) internal {
        hasPaid[round][who] = true;
        paidCount++;
        pot += amount;
        m.contributed += amount;
        reputation.recordPayment(who, true);
        emit Contributed(round, who, amount, fromPrefund);
    }

    /// @dev Seats whose payout round has started or passed cannot move.
    function _requireSwappable(uint8 seat) internal view {
        if (status == Status.Active && seat <= currentRound) revert SeatLocked();
    }

    function _clearOffer(address who) internal returns (uint256 deposit) {
        SwapOffer storage o = swapOffers[who];
        deposit = o.deposit;
        delete swapOffers[who];
    }

    /// @dev Pulls `amount` from the caller. Native overpayment is credited back as claimable.
    function _collect(uint256 amount) internal {
        if (token == address(0)) {
            if (msg.value < amount) revert InsufficientPayment();
            if (msg.value > amount) claimable[msg.sender] += msg.value - amount;
        } else {
            if (msg.value != 0) revert UnexpectedValue();
            if (amount > 0) IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }
}
