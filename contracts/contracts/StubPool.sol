// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64, euint256, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CheckpointsConfidential} from
    "@openzeppelin/confidential-contracts/utils/structs/CheckpointsConfidential.sol";

import {IERC7984ERC20Wrapper} from
    "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";
import {IYieldSource} from "./interfaces/IYieldSource.sol";

/**
 * @title  StubPool
 * @notice Confidential prize savings. Deposit, keep your principal, and the yield the pool earns
 *         is drawn as a prize instead of being spread thinly across everyone.
 *
 * @dev    The draw is a pull model. Settlement does not walk the depositor list; each account's
 *         outcome is an independent O(1) check:
 *
 *           ticket_u = keccak256(seed, pool, drawId, u) mod totalAtSeal      // public
 *           won_u    = balanceAtSeal_u > ticket_u                            // one FHE.gt
 *
 *         `ticket_u` is uniform on [0, totalAtSeal), so P(won_u) = balance_u / totalAtSeal
 *         exactly, and the per-account probabilities sum to one winner per draw in expectation.
 *         Scaling the ticket in plaintext rather than the balance in ciphertext keeps the whole
 *         odds computation to a single scalar comparison — 117,000 HCU against a 20,000,000
 *         per-transaction ceiling.
 *
 *         What is public: the seed (after settlement), the pool total at each seal, the prize,
 *         and every ticket. That is what makes the draw checkable by anyone. What is encrypted:
 *         every individual deposit, balance and outcome. See the README for the leakage this
 *         trades away, including what consecutive sealed totals reveal about net flows.
 */
contract StubPool is ZamaEthereumConfig, Ownable {
    using CheckpointsConfidential for CheckpointsConfidential.TraceEuint64;
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------------------

    struct Draw {
        /// @dev Block whose balances decide this draw.
        uint48 sealBlock;
        /// @dev Prize for this draw, in cUSD units. Public: it is a property of the pool, not
        ///      of a person, and the yield that funds it is observable anyway.
        uint64 prize;
        /// @dev When the draw was sealed. Starts the settlement window.
        uint64 sealedAt;
        /// @dev Set if the draw was voided because settlement never arrived.
        bool isVoid;
        /// @dev Pool total at the seal, once publicly decrypted. The odds denominator.
        uint64 totalAtSeal;
        /// @dev Protocol randomness for this draw, once publicly decrypted.
        uint256 seed;
        bytes32 seedHandle;
        bytes32 totalHandle;
        bool isSealed;
        bool isSettled;
    }

    // -------------------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------------------

    /**
     * @notice The confidential token this pool accepts.
     * @dev    On Sepolia this is Zama's own `Confidential USDC (Mock)`
     *         (`0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`) — an upgradeable
     *         `ERC7984ERC20Wrapper` listed in their Wrappers Registry, whose underlying carries a
     *         public `mint`. Stub deploys no token of its own: judges get the asset from the
     *         sponsor's contract, and our audit surface stays down to this pool and its yield
     *         source. Held as an interface so the Hardhat suite can point at a local clone.
     */
    IERC7984ERC20Wrapper public immutable token;

    /// @notice Where the prize comes from.
    IYieldSource public yieldSource;

    /// @notice Minimum time between seals.
    uint256 public drawInterval;

    /// @notice How long a sealed draw may wait for settlement before anyone may void it.
    uint256 public constant SETTLEMENT_WINDOW = 24 hours;

    /// @notice When the current draw became sealable.
    uint256 public lastSealedAt;

    uint64 public currentDrawId;

    mapping(uint64 drawId => Draw) private _draws;

    /// @dev Encrypted balance history per account, keyed by block number. `upperLookup` gives
    ///      the balance as of the seal, so a deposit made after the seal cannot win that draw
    ///      and no deposit lock is needed.
    mapping(address account => CheckpointsConfidential.TraceEuint64) private _history;

    /// @dev Running encrypted pool total. Published only at a seal.
    euint64 private _total;

    /// @notice Prize from voided draws, waiting to be added to the next one. Nothing is lost
    ///         when a draw is abandoned; it arrives a draw later.
    uint64 public rolloverPrize;

    /// @dev Sealed per-draw outcome. Decryptable only by its owner.
    mapping(uint64 drawId => mapping(address account => ebool)) private _stub;

    /// @dev Guards against crediting the same account twice for one draw.
    mapping(uint64 drawId => mapping(address account => bool)) public stubOpened;

    /// @dev Unclaimed winnings, encrypted.
    mapping(address account => euint64) private _winnings;

    // -------------------------------------------------------------------------------------
    // Errors and events
    // -------------------------------------------------------------------------------------

    error DrawNotReady(uint256 sealableAt);
    error DrawAlreadySealed(uint64 drawId);
    error DrawNotSealed(uint64 drawId);
    error DrawAlreadySettled(uint64 drawId);
    error DrawNotSettled(uint64 drawId);
    error EmptyPool();
    error StubAlreadyOpened(uint64 drawId, address account);
    error NoYieldSource();
    error SettlementWindowOpen(uint256 voidableAt);
    error DrawVoided(uint64 drawId);

    event Deposited(address indexed account, uint48 blockNumber);
    event Withdrawn(address indexed account, uint48 blockNumber);
    event DrawSealed(
        uint64 indexed drawId, uint48 sealBlock, uint64 prize, bytes32 seedHandle, bytes32 totalHandle
    );
    event DrawSettled(uint64 indexed drawId, uint256 seed, uint64 totalAtSeal);
    event DrawVoid(uint64 indexed drawId, uint64 prizeRolledOver);
    event StubOpened(uint64 indexed drawId, address indexed account, uint64 ticket);
    event Claimed(address indexed account);
    event YieldSourceUpdated(address yieldSource);

    // -------------------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------------------

    constructor(
        IERC7984ERC20Wrapper token_,
        uint256 drawInterval_,
        address initialOwner
    ) Ownable(initialOwner) {
        token = token_;
        drawInterval = drawInterval_;
        lastSealedAt = block.timestamp;
    }

    // -------------------------------------------------------------------------------------
    // Deposit and withdraw
    // -------------------------------------------------------------------------------------

    /**
     * @notice Move cUSD into the pool. The amount is encrypted in the caller's browser and
     *         bound to this contract by a zero-knowledge proof.
     * @dev    The caller must first grant this contract operator rights on the token
     *         (`StubUSD.setOperator`). That grant is a permission, not an amount — it reveals
     *         that an address intends to use the pool, never how much.
     *
     *         The input proof binds the ciphertext to *this* contract and the caller, so the
     *         pool verifies it here and hands the token an already-checked value rather than
     *         forwarding the proof. Forwarding would require the user to have encrypted against
     *         the token instead, which is not the contract they think they are talking to.
     *
     *         The token returns how much actually moved, which is zero if the caller's balance
     *         was short. Crediting the returned value rather than the requested one is what
     *         makes an underfunded deposit a no-op instead of a revert, so the transaction
     *         reveals nothing by failing.
     */
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(amount, address(token));
        euint64 received = token.confidentialTransferFrom(msg.sender, address(this), amount);

        euint64 updated = FHE.add(_balanceOf(msg.sender), received);
        FHE.allowThis(updated);
        FHE.allow(updated, msg.sender);
        _history[msg.sender].push(block.number, updated);

        _total = FHE.add(_total, received);
        FHE.allowThis(_total);

        emit Deposited(msg.sender, uint48(block.number));
    }

    /**
     * @notice Take principal back out. Available at any time — this is the no-loss guarantee.
     * @dev    Withdrawing more than the balance sends the whole balance rather than reverting,
     *         so the transaction costs the same and leaks nothing either way.
     */
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 balance = _balanceOf(msg.sender);

        ebool withinBalance = FHE.le(requested, balance);
        euint64 amount = FHE.select(withinBalance, requested, balance);

        euint64 updated = FHE.sub(balance, amount);
        FHE.allowThis(updated);
        FHE.allow(updated, msg.sender);
        _history[msg.sender].push(block.number, updated);

        _total = FHE.sub(_total, amount);
        FHE.allowThis(_total);

        FHE.allowTransient(amount, address(token));
        token.confidentialTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, uint48(block.number));
    }

    // -------------------------------------------------------------------------------------
    // The draw
    // -------------------------------------------------------------------------------------

    /**
     * @notice Freeze the draw and ask the protocol for randomness.
     * @dev    Permissionless once the interval has elapsed: anyone can seal, so the pool does
     *         not depend on an operator showing up. Constant cost — nothing here touches the
     *         depositor list.
     *
     *         The seed comes from `FHE.randEuint256()`, generated inside the protocol, so the
     *         caller cannot know it at seal time. Both it and the pool total are marked publicly
     *         decryptable; {settleDraw} writes the cleartexts back under a KMS proof. Publishing
     *         the total is what turns the odds denominator into a plaintext scalar and lets any
     *         observer recompute every ticket.
     */
    function sealDraw() external returns (uint64 drawId) {
        drawId = currentDrawId;
        Draw storage d = _draws[drawId];
        if (d.isSealed) revert DrawAlreadySealed(drawId);

        uint256 readyAt = lastSealedAt + drawInterval;
        if (block.timestamp < readyAt) revert DrawNotReady(readyAt);
        if (address(yieldSource) == address(0)) revert NoYieldSource();

        uint64 prize = _harvestPrize() + rolloverPrize;
        rolloverPrize = 0;

        euint256 seed = FHE.randEuint256();
        FHE.allowThis(seed);
        FHE.makePubliclyDecryptable(seed);

        euint64 total = _total;
        FHE.allowThis(total);
        FHE.makePubliclyDecryptable(total);

        d.isSealed = true;
        d.sealedAt = uint64(block.timestamp);
        d.sealBlock = uint48(block.number);
        d.prize = prize;
        d.seedHandle = euint256.unwrap(seed);
        d.totalHandle = euint64.unwrap(total);
        lastSealedAt = block.timestamp;

        emit DrawSealed(drawId, d.sealBlock, prize, d.seedHandle, d.totalHandle);
    }

    /**
     * @notice Write back the publicly decrypted seed and pool total.
     * @dev    Permissionless. The KMS signatures are what make it safe to let anyone call this:
     *         `FHE.checkSignatures` reverts unless the cleartexts really are the decryptions of
     *         the handles this draw published.
     * @param  cleartexts ABI-encoded decryptions of [seedHandle, totalHandle], exactly as the
     *                    KMS signed them. Decoded only after the signatures check out.
     * @param  proof      KMS public-decryption proof covering both handles, in that order.
     */
    function settleDraw(bytes calldata cleartexts, bytes calldata proof) external {
        uint64 drawId = currentDrawId;
        Draw storage d = _draws[drawId];
        if (!d.isSealed) revert DrawNotSealed(drawId);
        if (d.isSettled) revert DrawAlreadySettled(drawId);

        bytes32[] memory handles = new bytes32[](2);
        handles[0] = d.seedHandle;
        handles[1] = d.totalHandle;
        FHE.checkSignatures(handles, cleartexts, proof);

        (uint256 seed, uint64 totalAtSeal) = abi.decode(cleartexts, (uint256, uint64));
        if (totalAtSeal == 0) revert EmptyPool();

        d.seed = seed;
        d.totalAtSeal = totalAtSeal;
        d.isSettled = true;
        currentDrawId = drawId + 1;

        emit DrawSettled(drawId, seed, totalAtSeal);
    }

    /**
     * @notice Abandon a sealed draw that was never settled, and let the pool move on.
     *
     * @dev    Without this the pool bricks. `sealDraw` refuses to re-seal a sealed draw and
     *         `currentDrawId` only advances in {settleDraw}, so a draw whose decryption never
     *         arrives — a relayer outage long enough to matter, a handle that stops being
     *         served — would freeze every future draw permanently. Deposits and withdrawals
     *         would keep working and nobody could ever win again.
     *
     *         Permissionless, and only after {SETTLEMENT_WINDOW}. Settling is already
     *         permissionless and takes seconds, so anyone who wants the draw to complete has a
     *         full day to make it complete. The window is what stops this being a censorship
     *         tool: you cannot void a draw someone is about to settle.
     *
     *         The prize is not lost. It stays in the pool's balance and is added to the next
     *         draw's prize, so the yield reaches depositors a draw later than intended.
     */
    function voidDraw() external returns (uint64 drawId) {
        drawId = currentDrawId;
        Draw storage d = _draws[drawId];
        if (!d.isSealed) revert DrawNotSealed(drawId);
        if (d.isSettled) revert DrawAlreadySettled(drawId);

        uint256 voidableAt = d.sealedAt + SETTLEMENT_WINDOW;
        if (block.timestamp < voidableAt) revert SettlementWindowOpen(voidableAt);

        d.isVoid = true;
        d.isSettled = true;
        uint64 rolled = d.prize;
        d.prize = 0;
        rolloverPrize += rolled;
        currentDrawId = drawId + 1;

        emit DrawVoid(drawId, rolled);
    }

    /**
     * @notice Open one account's stub for a settled draw, and credit any winnings.
     * @dev    This is the entire winner-selection computation, and it is O(1). Always succeeds,
     *         always costs the same, and writes an encrypted result — an observer watching the
     *         chain cannot tell a winner from a loser. Callable by anyone for anyone, so a
     *         keeper can open stubs on behalf of accounts that never come back.
     */
    function openStub(uint64 drawId, address account) external returns (ebool won) {
        Draw storage d = _draws[drawId];
        if (!d.isSettled) revert DrawNotSettled(drawId);
        if (d.isVoid) revert DrawVoided(drawId);
        if (stubOpened[drawId][account]) revert StubAlreadyOpened(drawId, account);
        stubOpened[drawId][account] = true;

        uint64 ticket = _ticket(d.seed, drawId, d.totalAtSeal, account);

        won = FHE.gt(_balanceAt(account, d.sealBlock), ticket);
        FHE.allowThis(won);
        FHE.allow(won, account);
        _stub[drawId][account] = won;

        euint64 credited = FHE.add(_winningsOf(account), FHE.select(won, FHE.asEuint64(d.prize), FHE.asEuint64(0)));
        FHE.allowThis(credited);
        FHE.allow(credited, account);
        _winnings[account] = credited;

        emit StubOpened(drawId, account, ticket);
    }

    /**
     * @notice Sweep unclaimed winnings to the caller.
     * @dev    Transfers the encrypted balance, which is zero for an account that has not won.
     *         The transaction looks identical either way.
     */
    function claim() external {
        euint64 amount = _winningsOf(msg.sender);

        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);
        FHE.allow(zero, msg.sender);
        _winnings[msg.sender] = zero;

        FHE.allowTransient(amount, address(token));
        token.confidentialTransfer(msg.sender, amount);

        emit Claimed(msg.sender);
    }

    // -------------------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------------------

    /// @notice The caller's current pool balance, encrypted.
    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _history[account].latest();
    }

    /// @notice The balance that decided a given draw, encrypted.
    function confidentialBalanceAtSeal(uint64 drawId, address account) external view returns (euint64) {
        return _history[account].upperLookup(_draws[drawId].sealBlock);
    }

    /// @notice Unclaimed winnings, encrypted.
    function confidentialWinningsOf(address account) external view returns (euint64) {
        return _winnings[account];
    }

    /// @notice A sealed outcome. Only `account` can decrypt it.
    function stubOf(uint64 drawId, address account) external view returns (ebool) {
        return _stub[drawId][account];
    }

    /// @notice Handle of the running pool total. Decryptable only at a seal.
    function confidentialTotal() external view returns (euint64) {
        return _total;
    }

    function draws(uint64 drawId) external view returns (Draw memory) {
        return _draws[drawId];
    }

    /**
     * @notice Recompute any account's ticket for a settled draw.
     * @dev    Pure function of public inputs. Anyone can check this off-chain against the seed
     *         and total in `DrawSettled`, which is what makes the draw verifiable without
     *         learning anything about who took part or what they hold.
     */
    function ticketOf(uint64 drawId, address account) external view returns (uint64) {
        Draw storage d = _draws[drawId];
        if (!d.isSettled) revert DrawNotSettled(drawId);
        if (d.isVoid) revert DrawVoided(drawId);
        return _ticket(d.seed, drawId, d.totalAtSeal, account);
    }

    /// @notice When the current draw may next be sealed.
    function sealableAt() external view returns (uint256) {
        return lastSealedAt + drawInterval;
    }

    /// @notice When the current sealed draw could be abandoned, or zero if that does not apply.
    function voidableAt() external view returns (uint256) {
        Draw storage d = _draws[currentDrawId];
        if (!d.isSealed || d.isSettled) return 0;
        return d.sealedAt + SETTLEMENT_WINDOW;
    }

    // -------------------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------------------

    function setYieldSource(IYieldSource yieldSource_) external onlyOwner {
        yieldSource = yieldSource_;
        emit YieldSourceUpdated(address(yieldSource_));
    }

    function setDrawInterval(uint256 drawInterval_) external onlyOwner {
        drawInterval = drawInterval_;
    }

    // -------------------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------------------

    /// @dev Harvest yield as the underlying ERC-20, then wrap it so the pool can pay it out
    ///      confidentially. Returns the prize in cUSD units.
    function _harvestPrize() private returns (uint64) {
        uint256 harvested = yieldSource.harvest();
        if (harvested == 0) return 0;

        IERC20 underlying = IERC20(yieldSource.asset());
        underlying.forceApprove(address(token), harvested);
        token.wrap(address(this), harvested);

        return SafeCast.toUint64(harvested / token.rate());
    }

    /// @dev An account with no checkpoint yet has no ciphertext at all, and FHE operations need
    ///      an initialised one. Materialise a trivial zero rather than reverting, so every path
    ///      through the contract costs the same for a new account as for an old one.
    function _balanceOf(address account) private returns (euint64) {
        return _initialised(_history[account].latest());
    }

    function _balanceAt(address account, uint48 blockNumber) private returns (euint64) {
        return _initialised(_history[account].upperLookup(blockNumber));
    }

    function _winningsOf(address account) private returns (euint64) {
        return _initialised(_winnings[account]);
    }

    function _initialised(euint64 value) private returns (euint64) {
        if (FHE.isInitialized(value)) return value;
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);
        return zero;
    }

    function _ticket(
        uint256 seed,
        uint64 drawId,
        uint64 totalAtSeal,
        address account
    ) private view returns (uint64) {
        return uint64(uint256(keccak256(abi.encode(seed, address(this), drawId, account))) % totalAtSeal);
    }
}
