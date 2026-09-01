// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from
    "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";

/**
 * @title  MockConfidentialUSDC
 * @notice Local stand-in for Zama's `Confidential USDC (Mock)` on Sepolia
 *         (`0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`).
 *
 * @dev    Same reason as {MockUSDC}: the Hardhat suite needs a wrapper it can deploy. **Never
 *         deployed to a live network.** Zama's is an upgradeable `ERC7984ERC20Wrapper` behind a
 *         proxy, registered in their Wrappers Registry, and every function {StubPool} calls was
 *         checked against its deployed bytecode before we committed to it.
 *
 *         Wrapping is the confidentiality boundary. `wrap` takes a public amount — that step is
 *         readable by anyone. Everything downstream of it is not.
 */
contract MockConfidentialUSDC is ERC7984, ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(
        IERC20 underlying_
    ) ERC7984("Confidential USDC (Mock)", "cUSDCMock", "") ERC7984ERC20Wrapper(underlying_) {}

    function decimals() public view override(ERC7984, ERC7984ERC20Wrapper) returns (uint8) {
        return ERC7984ERC20Wrapper.decimals();
    }

    function _update(
        address from,
        address to,
        euint64 amount
    ) internal override(ERC7984, ERC7984ERC20Wrapper) returns (euint64) {
        return ERC7984ERC20Wrapper._update(from, to, amount);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC7984, ERC7984ERC20Wrapper) returns (bool) {
        return ERC7984ERC20Wrapper.supportsInterface(interfaceId);
    }
}
