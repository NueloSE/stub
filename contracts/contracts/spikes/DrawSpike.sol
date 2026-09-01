// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title  DrawSpike
 * @notice Day-1 spike. Proves the draw is O(1) per participant and that no step of settlement
 *         walks the depositor list. Not the production contract — balances are seeded in
 *         cleartext here so the test can drive hundreds of depositors without paying for an
 *         input proof per account. The draw path below is the real one.
 *
 * @dev    The odds identity this spike exists to validate:
 *
 *           ticket_u = keccak256(seed, pool, drawId, u) mod totalAtSeal      // public
 *           won_u    = balance_u > ticket_u                                  // one scalar compare
 *
 *         ticket_u is uniform on [0, totalAtSeal), so P(won_u) = balance_u / totalAtSeal
 *         exactly, and the thresholds sum to 1 — one winner per draw in expectation. Scaling
 *         the *ticket* in plaintext instead of the *balance* in ciphertext collapses the whole
 *         odds computation to a single `FHE.gt` against a scalar.
 */
contract DrawSpike is ZamaEthereumConfig {
    struct Draw {
        uint64 totalAtSeal;
        uint256 seed;
        bool sealed_;
        bool settled;
    }

    /// @notice Individual balances: encrypted.
    mapping(address account => euint64) private _balance;

    /// @notice Aggregate pool total: public by design. It is the odds denominator.
    uint64 public poolTotal;

    uint64 public currentDrawId;
    mapping(uint64 drawId => Draw) public draws;

    /// @notice Per-draw sealed outcome. Readable only by its owner.
    mapping(uint64 drawId => mapping(address account => ebool)) private _stub;

    /// @notice Handle of the encrypted seed, published so anyone can watch it resolve.
    mapping(uint64 drawId => bytes32) public seedHandle;

    error DrawNotSealed();
    error DrawNotSettled();
    error DrawAlreadySealed();
    error DrawAlreadySettled();
    error EmptyPool();

    event DrawSealed(uint64 indexed drawId, uint64 totalAtSeal, bytes32 seedHandle);
    event DrawSettled(uint64 indexed drawId, uint256 seed);
    event StubOpened(uint64 indexed drawId, address indexed account, uint64 ticket);

    /// @dev Spike-only. The production path takes an externalEuint64 plus its input proof.
    ///      `account` is a parameter so one signer can seed hundreds of depositors in a test.
    function depositPlainFor(address account, uint64 amount) public {
        euint64 credited = FHE.add(_balance[account], amount);
        FHE.allowThis(credited);
        FHE.allow(credited, account);
        _balance[account] = credited;
        poolTotal += amount;
    }

    function depositPlain(uint64 amount) external {
        depositPlainFor(msg.sender, amount);
    }

    /**
     * @notice Freeze the draw. Constant cost — nothing here depends on the number of depositors.
     * @dev    One `randEuint256` (24k HCU) and one ACL grant. The seed is generated inside the
     *         protocol, so the operator does not know it at seal time, and made publicly
     *         decryptable so every ticket is recomputable by anyone afterwards.
     */
    function seal() external {
        uint64 id = currentDrawId;
        Draw storage d = draws[id];
        if (d.sealed_) revert DrawAlreadySealed();
        if (poolTotal == 0) revert EmptyPool();

        euint256 seed = FHE.randEuint256();
        FHE.allowThis(seed);
        FHE.makePubliclyDecryptable(seed);

        bytes32 handle = euint256.unwrap(seed);
        d.sealed_ = true;
        d.totalAtSeal = poolTotal;
        seedHandle[id] = handle;

        emit DrawSealed(id, poolTotal, handle);
    }

    /**
     * @dev Spike-only shortcut. Production verifies the KMS proof with
     *      `FHE.checkSignatures(handles, cleartexts, proof)` before writing the seed.
     */
    function settleUnchecked(uint256 seed) external {
        uint64 id = currentDrawId;
        Draw storage d = draws[id];
        if (!d.sealed_) revert DrawNotSealed();
        if (d.settled) revert DrawAlreadySettled();

        d.seed = seed;
        d.settled = true;
        currentDrawId = id + 1;

        emit DrawSettled(id, seed);
    }

    /**
     * @notice Open one participant's stub. This is the whole winner-selection computation.
     * @dev    O(1). Two FHE ops: one scalar `gt` (117k HCU) and the ACL grants. Always
     *         succeeds, always costs the same, and writes an encrypted result — an observer
     *         cannot tell a winner from a loser by watching the chain.
     */
    function openStub(uint64 id, address account) external returns (ebool) {
        Draw storage d = draws[id];
        if (!d.settled) revert DrawNotSettled();

        uint64 ticket = _ticket(id, d.seed, d.totalAtSeal, account);

        ebool won = FHE.gt(_balance[account], ticket);
        FHE.allowThis(won);
        FHE.allow(won, account);
        _stub[id][account] = won;

        emit StubOpened(id, account, ticket);
        return won;
    }

    /// @notice Anyone can recompute any ticket from public data alone. No secrets involved.
    function ticketOf(uint64 id, address account) external view returns (uint64) {
        Draw storage d = draws[id];
        if (!d.settled) revert DrawNotSettled();
        return _ticket(id, d.seed, d.totalAtSeal, account);
    }

    function stubOf(uint64 id, address account) external view returns (ebool) {
        return _stub[id][account];
    }

    function balanceOf(address account) external view returns (euint64) {
        return _balance[account];
    }

    function _ticket(uint64 id, uint256 seed, uint64 totalAtSeal, address account) private view returns (uint64) {
        return uint64(uint256(keccak256(abi.encode(seed, address(this), id, account))) % totalAtSeal);
    }
}
