// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from
    "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";

/**
 * @title  StubUSD
 * @notice The confidential form of {TestUSD}. Wrapping is where the confidentiality boundary
 *         sits: the wrap amount is public, everything after it is not.
 * @dev    Thin concrete instance of OpenZeppelin's ERC-7984 wrapper. Unwrapping is a two-step
 *         request/finalize flow — see {ERC7984ERC20Wrapper-finalizeUnwrap}. A request that is
 *         made but never finalized strands the underlying, which is the failure mode the app
 *         has to detect and offer to complete.
 */
contract StubUSD is ERC7984, ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(
        IERC20 underlying_,
        string memory contractURI_
    ) ERC7984("Stub USD", "cUSD", contractURI_) ERC7984ERC20Wrapper(underlying_) {}

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
