// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PayounceCircle} from "./PayounceCircle.sol";
import {PayounceReputation} from "./PayounceReputation.sol";

/// @title PayounceFactory
/// @notice Creates Payounce circles as cheap EIP-1167 clones and owns the shared reputation registry.
contract PayounceFactory {
    struct CircleConfig {
        string name;
        address token; // address(0) for native QIE, otherwise an ERC-20 such as a stablecoin
        uint256 contribution; // per round, token units or USD cents when usdPriced
        bool usdPriced; // price a native-QIE circle in USD through the QIE Oracle
        uint64 period; // seconds per round, minimum 60
        uint8 maxMembers; // 2..50 seats, also the number of rounds
        uint64 joinWindow; // seconds the circle stays open for joining
        bool useReputation; // clean track records reduce early-seat collateral
        bool requireVerified; // only QIE ID-verified members may join
        uint16 premiumBps; // early-seat premium per seat-step (0 = classic circle), max 2_000
    }

    address public immutable implementation;
    address public immutable oracle;
    uint256 public immutable maxPriceAge;
    PayounceReputation public immutable reputation;

    address[] internal _circles;
    mapping(address => address[]) internal _circlesByCreator;

    event CircleCreated(address indexed circle, address indexed creator, string name);

    error InvalidParams();

    /// @param implementation_ Deployed PayounceCircle used as the clone template.
    /// @param oracle_ QIE/USD price feed (Chainlink AggregatorV3 compatible), or address(0) to disable USD pricing.
    /// @param maxPriceAge_ Oldest oracle answer (seconds) circles will accept.
    /// @param attester_ Account allowed to mark members as QIE ID-verified.
    constructor(address implementation_, address oracle_, uint256 maxPriceAge_, address attester_) {
        implementation = implementation_;
        oracle = oracle_;
        maxPriceAge = maxPriceAge_;
        reputation = new PayounceReputation(attester_);
    }

    function createCircle(CircleConfig calldata c) external returns (address circle) {
        if (bytes(c.name).length == 0 || bytes(c.name).length > 64) revert InvalidParams();
        if (c.contribution == 0 || c.period < 60 || c.joinWindow == 0) revert InvalidParams();
        if (c.maxMembers < 2 || c.maxMembers > 50) revert InvalidParams();
        if (c.usdPriced && (c.token != address(0) || oracle == address(0))) revert InvalidParams();
        if (c.premiumBps > 2_000) revert InvalidParams();

        circle = Clones.clone(implementation);
        PayounceCircle(circle).initialize(
            PayounceCircle.Params({
                name: c.name,
                creator: msg.sender,
                token: c.token,
                contribution: c.contribution,
                usdPriced: c.usdPriced,
                period: c.period,
                maxMembers: c.maxMembers,
                joinDeadline: uint64(block.timestamp) + c.joinWindow,
                useReputation: c.useReputation,
                requireVerified: c.requireVerified,
                premiumBps: c.premiumBps,
                oracle: oracle,
                maxPriceAge: maxPriceAge,
                reputation: address(reputation)
            })
        );
        reputation.registerCircle(circle);
        _circles.push(circle);
        _circlesByCreator[msg.sender].push(circle);
        emit CircleCreated(circle, msg.sender, c.name);
    }

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    function getCircles() external view returns (address[] memory) {
        return _circles;
    }

    function getCirclesByCreator(address creator) external view returns (address[] memory) {
        return _circlesByCreator[creator];
    }
}
