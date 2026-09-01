// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {CheckpointsConfidential} from "@openzeppelin/confidential-contracts/utils/structs/CheckpointsConfidential.sol";

/**
 * @title  CheckpointSpike
 * @notice Day-1 spike C. Asks one question: does an encrypted balance survive a round trip
 *         through OpenZeppelin's `CheckpointsConfidential` and remain usable in FHE operations
 *         and ACL grants afterwards?
 *
 * @dev    If it does, balance-at-seal becomes exact — the draw reads each account's balance as
 *         of the seal block via `upperLookup`, so a deposit made after the seal genuinely cannot
 *         win that draw, and no "deposits are tagged for the next round" bookkeeping is needed.
 *         The library stores the raw handle, so what is really under test is whether an ACL
 *         grant made at deposit time still holds when the handle is read back at draw time.
 */
contract CheckpointSpike is ZamaEthereumConfig {
    using CheckpointsConfidential for CheckpointsConfidential.TraceEuint64;

    mapping(address account => CheckpointsConfidential.TraceEuint64) private _history;

    uint64 public poolTotal;
    uint64 public sealBlock;
    uint64 public totalAtSeal;
    uint256 public seed;
    bool public settled;

    error NotSettled();

    event Deposited(address indexed account, uint48 blockNumber, uint64 amount);

    function deposit(address account, uint64 amount) external {
        euint64 current = _history[account].latest();
        euint64 updated = FHE.add(current, amount);
        FHE.allowThis(updated);
        FHE.allow(updated, account);

        _history[account].push(block.number, updated);
        poolTotal += amount;

        emit Deposited(account, uint48(block.number), amount);
    }

    function seal() external {
        sealBlock = uint64(block.number);
        totalAtSeal = poolTotal;
    }

    function settle(uint256 seed_) external {
        seed = seed_;
        settled = true;
    }

    /// @notice The balance this account held at the seal block — not its balance now.
    /// @dev    An account with no checkpoint at or before the seal gets a zero handle back.
    ///         FHE operations need an initialised ciphertext, so the caller must materialise
    ///         a trivial zero for that case — see `_balanceAtSealOrZero`.
    function balanceAtSeal(address account) public view returns (euint64) {
        return _history[account].upperLookup(sealBlock);
    }

    function latestBalance(address account) external view returns (euint64) {
        return _history[account].latest();
    }

    function checkpointCount(address account) external view returns (uint256) {
        return _history[account].length();
    }

    /// @notice The same O(1) check as DrawSpike, but reading a historical encrypted balance.
    function openStub(address account) external returns (ebool) {
        if (!settled) revert NotSettled();

        uint64 ticket = uint64(uint256(keccak256(abi.encode(seed, address(this), account))) % totalAtSeal);

        ebool won = FHE.gt(_balanceAtSealOrZero(account), ticket);
        FHE.allowThis(won);
        FHE.allow(won, account);
        return won;
    }

    /// @dev Accounts that joined after the seal have no checkpoint in range. Treat them as zero
    ///      rather than reverting, so `openStub` costs the same for everyone and never fails.
    function _balanceAtSealOrZero(address account) private returns (euint64) {
        euint64 balance = balanceAtSeal(account);
        if (!FHE.isInitialized(balance)) {
            balance = FHE.asEuint64(0);
            FHE.allowThis(balance);
        }
        return balance;
    }

    function ticketOf(address account) external view returns (uint64) {
        return uint64(uint256(keccak256(abi.encode(seed, address(this), account))) % totalAtSeal);
    }
}
