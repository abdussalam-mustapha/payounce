// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Chainlink-compatible price feed interface. QIE Oracle feeds implement it
/// (e.g. QIE / USDT at 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17 on mainnet, 8 decimals).
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
