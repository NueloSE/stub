// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title  MockUSDC
 * @notice Local stand-in for Zama's `USD Coin (Mock)` on Sepolia
 *         (`0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`).
 *
 * @dev    Exists only so the Hardhat suite has something to run against — the local mock FHEVM
 *         cannot reach Sepolia. **This is never deployed to a live network.** Stub uses Zama's
 *         own token there, which is why the interface here mirrors theirs exactly: same name,
 *         same symbol, same six decimals, and the same public `mint(address,uint256)` capped at
 *         one million per call. The app's "get test USDC" button makes the identical call on
 *         both networks.
 */
contract MockUSDC is ERC20 {
    /// @notice Matches the cap Zama documents for the testnet mocks.
    uint256 public constant MINT_LIMIT = 1_000_000e6;

    error MintLimitExceeded(uint256 requested, uint256 limit);

    constructor() ERC20("USD Coin (Mock)", "USDCMock") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MINT_LIMIT) revert MintLimitExceeded(amount, MINT_LIMIT);
        _mint(to, amount);
    }
}
