// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PayounceReputation
/// @notice The Payounce savings passport. Every circle reports each member's joins, payments and
/// results here, building a portable track record. Circles that opt in use it to lower early-seat
/// collateral. An attester (backed by QIE ID verification) can mark members as verified humans,
/// and circles can require that.
/// @dev Only circles registered by the factory that deployed this contract can write records.
contract PayounceReputation {
    struct Record {
        uint32 circlesJoined;
        uint32 circlesCompleted; // finished without defaulting
        uint32 onTimePayments;
        uint32 missedPayments; // covered from collateral
        uint32 gracesReceived; // missed rounds forgiven by the group
        uint32 defaults; // collateral ran out
        uint64 firstActivity;
        uint64 lastActivity;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant DISCOUNT_PER_CIRCLE_BPS = 2_500; // 25% per clean circle
    uint256 public constant MAX_DISCOUNT_BPS = 5_000; // capped at 50%

    address public immutable factory;
    address public attester;
    mapping(address => bool) public isCircle;
    mapping(address => bool) public isVerified;
    mapping(address => Record) internal _records;
    mapping(address => address[]) internal _circlesOf;

    event CircleRegistered(address indexed circle);
    event AttesterChanged(address indexed attester);
    event VerificationSet(address indexed member, bool verified);
    event MemberJoined(address indexed member, address indexed circle);
    event PaymentRecorded(address indexed member, address indexed circle, bool onTime);
    event GraceRecorded(address indexed member, address indexed circle);
    event CircleFinished(address indexed member, address indexed circle, bool defaulted);

    error NotFactory();
    error NotCircle();
    error NotAttester();

    constructor(address attester_) {
        factory = msg.sender;
        attester = attester_;
        emit AttesterChanged(attester_);
    }

    modifier onlyCircle() {
        if (!isCircle[msg.sender]) revert NotCircle();
        _;
    }

    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    // ---- admin ----

    function registerCircle(address circle) external {
        if (msg.sender != factory) revert NotFactory();
        isCircle[circle] = true;
        emit CircleRegistered(circle);
    }

    function setAttester(address next) external onlyAttester {
        attester = next;
        emit AttesterChanged(next);
    }

    /// @notice Called by the QIE ID verification service once a wallet is linked to a verified identity.
    function setVerified(address member, bool verified) external onlyAttester {
        isVerified[member] = verified;
        emit VerificationSet(member, verified);
    }

    // ---- writes from circles ----

    function recordJoin(address member) external onlyCircle {
        Record storage r = _touch(member);
        r.circlesJoined++;
        _circlesOf[member].push(msg.sender);
        emit MemberJoined(member, msg.sender);
    }

    function recordPayment(address member, bool onTime) external onlyCircle {
        Record storage r = _touch(member);
        if (onTime) r.onTimePayments++;
        else r.missedPayments++;
        emit PaymentRecorded(member, msg.sender, onTime);
    }

    function recordGrace(address member) external onlyCircle {
        _touch(member).gracesReceived++;
        emit GraceRecorded(member, msg.sender);
    }

    function recordFinish(address member, bool defaulted) external onlyCircle {
        Record storage r = _touch(member);
        if (defaulted) r.defaults++;
        else r.circlesCompleted++;
        emit CircleFinished(member, msg.sender, defaulted);
    }

    // ---- reads ----

    function recordOf(address member) external view returns (Record memory) {
        return _records[member];
    }

    function circlesOf(address member) external view returns (address[] memory) {
        return _circlesOf[member];
    }

    /// @notice Collateral discount (basis points) a member has earned. Any default removes it.
    function discountBps(address member) public view returns (uint256) {
        Record memory r = _records[member];
        if (r.defaults > 0) return 0;
        uint256 d = uint256(r.circlesCompleted) * DISCOUNT_PER_CIRCLE_BPS;
        return d > MAX_DISCOUNT_BPS ? MAX_DISCOUNT_BPS : d;
    }

    function _touch(address member) internal returns (Record storage r) {
        r = _records[member];
        if (r.firstActivity == 0) r.firstActivity = uint64(block.timestamp);
        r.lastActivity = uint64(block.timestamp);
    }
}
