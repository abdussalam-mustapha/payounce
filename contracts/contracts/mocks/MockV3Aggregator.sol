// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Test / testnet stand-in for the QIE Oracle (no testnet feed is published).
contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public immutable override decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        updateAnswer(initialAnswer);
    }

    function updateAnswer(int256 newAnswer) public {
        answer = newAnswer;
        updatedAt = block.timestamp;
        roundId++;
    }

    function setUpdatedAt(uint256 ts) external {
        updatedAt = ts;
    }

    function description() external pure returns (string memory) {
        return "MOCK QIE / USD";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
