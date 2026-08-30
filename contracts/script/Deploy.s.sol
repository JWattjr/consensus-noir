// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/ProofPlayBaseDuel.sol";

/// @notice Deploys the Base Sepolia escrow contract only.
/// @dev Bridge endpoints are deliberately configured in a separate, explicit
///      owner transaction once the official beta bridge addresses are known.
contract Deploy is Script {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84532;
    address private constant BASE_SEPOLIA_TEST_USDC =
        0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    uint256 private constant DEFAULT_RESOLUTION_TIMEOUT_SECONDS = 2 days;
    uint256 private constant MIN_RESOLUTION_TIMEOUT_SECONDS = 1 hours;
    uint256 private constant MAX_RESOLUTION_TIMEOUT_SECONDS = 30 days;

    function run() external returns (ProofPlayBaseDuel duel) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Run on Base Sepolia only");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        uint256 timeoutSeconds = vm.envOr(
            "PROOFPLAY_RESOLUTION_TIMEOUT_SECONDS",
            DEFAULT_RESOLUTION_TIMEOUT_SECONDS
        );
        require(
            timeoutSeconds >= MIN_RESOLUTION_TIMEOUT_SECONDS &&
                timeoutSeconds <= MAX_RESOLUTION_TIMEOUT_SECONDS,
            "Timeout must be 1 hour to 30 days"
        );

        address deployer = vm.addr(deployerPrivateKey);
        console2.log("=== Archived football-duel deployment ===");
        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", deployer);
        console2.log("Base Sepolia test USDC:", BASE_SEPOLIA_TEST_USDC);
        console2.log("Resolution timeout (seconds):", timeoutSeconds);

        vm.startBroadcast(deployerPrivateKey);
        duel = new ProofPlayBaseDuel(
            BASE_SEPOLIA_TEST_USDC,
            uint64(timeoutSeconds)
        );
        vm.stopBroadcast();

        console2.log("Football-duel contract deployed:", address(duel));
        console2.log(
            "Next: configure the verified GenLayer bridge sender, receiver, and resolver."
        );
    }
}
