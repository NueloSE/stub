# Engineering notes

Measurements and decisions behind the contracts, recorded as they were made. Where a number
appears in the README, this is where it came from.

---

## The draw is O(1) per depositor

Winner selection is a pull model, so settling a draw never walks the depositor list. Each
account's outcome is an independent check:

```
ticket_u = keccak256(seed, pool, drawId, u) mod totalAtSeal      // public
won_u    = balanceAtSeal_u > ticket_u                            // one FHE.gt
```

`ticket_u` is uniform on `[0, totalAtSeal)`, so `P(won_u) = balance_u / totalAtSeal` exactly, and
the per-account probabilities sum to one winner per draw in expectation — the same model
PoolTogether V5 uses.

The important move is scaling the **ticket** in plaintext rather than the **balance** in
ciphertext. Comparing an encrypted balance against a plaintext threshold means one scalar
comparison, with no encrypted division and no widening multiply. An earlier design built an
encrypted threshold first and cost roughly twice as much for the same result.

Measured over 500 depositors (`test/spike.scale.test.ts`):

```
seal() gas @ 10  depositors: 173,672
seal() gas @ 500 depositors: 173,672      constant, not linear
openStub() gas:  134,268 .. 134,292       12 gas of spread across 500 accounts
```

The alternative — sweeping a ticket list over ciphertext — is O(n) and has to be batched across
transactions to stay under the HCU ceiling. That buys a cursor to persist, rounds that can
finish with no winner, and per-round results that cannot always be attributed afterwards. The
pull model has none of those because it never iterates.

## HCU, measured rather than derived

Gas is only half the budget on FHEVM. Every encrypted operation also burns HCU, metered against a
20,000,000 per-transaction ceiling and a 5,000,000 sequential-depth ceiling. Exceeding either
reverts.

| Operation | HCU | of ceiling | depth |
|---|---|---|---|
| `openStub` | 334,096 | 1.67% | 334,000 |
| `claim` | 586,064 | 2.93% | 369,000 |
| `withdraw` | 1,114,032 | 5.57% | 573,000 |
| `deposit` | 910,128 | 4.55% | 369,000 |

Taken from `fhevm.computeTransactionHCU`, asserted in `test/StubPool.test.ts`, and confirmed
against Sepolia — **the live figures matched the local mock to the unit**, depth included.

The published cost table alone would have given 117,000 for `openStub`, counting only the
`FHE.gt`. The other 217,000 is the ACL grants and the winnings credit, which the table does not
cover. Worth knowing before budgeting against it.

## A winner and a loser are indistinguishable

`openStub` always succeeds, at constant cost, and writes an encrypted result. There is no
`DidNotWin` revert, so the transaction itself never publishes the outcome.

Measured for two accounts in the same draw, one winner and one loser:

```
openStub HCU   334,096 both
claim HCU      586,064 both
claim gas      identical once storage is warm
```

The first version of that test showed a 19,900 gas spread and looked like a leak. It was
cold-access cost paid by whichever account transacted first. The test now warms both accounts
before measuring, and says so, because a test that passes for the wrong reason is worse than one
that fails.

## Exact balance-at-seal, via OpenZeppelin

`CheckpointsConfidential` (confidential-contracts 0.5.3) stores encrypted values against block
numbers with `O(log n)` lookup. Encrypted handles survive the round trip and ACL grants made at
deposit time still hold when the handle is read back at draw time.

So the draw reads each account's balance **as of the seal block** rather than its balance now. A
deposit made after the seal cannot win that draw, and there is no deposit lock and no
"mid-round deposits count toward the next round" bookkeeping to get wrong.

One sharp edge: an account with no checkpoint at or before the seal gets an *uninitialised*
handle back, not an encrypted zero, and `FHE.gt` needs an initialised ciphertext. Left unhandled,
`openStub` would revert for anyone who joined after the seal — leaking membership through the
failure and breaking constant cost. `_initialised` materialises a trivial zero for that case.

## A draw that never settles must not brick the pool

`sealDraw` refuses to re-seal a sealed draw, and `currentDrawId` only advances in `settleDraw`.
A draw whose public decryption never arrives would therefore freeze every future draw
permanently, while deposits and withdrawals kept working — a failure that looks fine.

`voidDraw` abandons such a draw after a 24-hour settlement window. Permissionless, because
settling is permissionless and takes seconds: anyone who wants the draw to complete has a full
day to make it complete. The window is what stops this being a censorship tool. The prize is
deferred into `rolloverPrize` and added to the next draw rather than burned.

## Toolchain

`@fhevm/hardhat-plugin` has not been republished since 19 February 2026. It pins
`@fhevm/solidity` to `0.11.1` and validates that file byte-for-byte. Sepolia runs FHEVM v0.13 —
verified by reading `getVersion()` from the deployed `FHEVMExecutor`, which reports `v0.4.0`
(v0.14 would report `v0.5.0`).

Building against 0.11.1 to satisfy the plugin would mean deploying a library that does not match
the live protocol. So the contracts build against **0.13.3**, with a two-hunk patch in
`patches/` letting the mock run against it:

1. A stale placeholder comment in the plugin's expected `_getEthereumConfig()` string. Mainnet is
   deployed now; the addresses are identical, only the comment moved.
2. The exact-version assert, widened to accept 0.13.3 alongside 0.11.1.

This is safe for the operations used here because `Impl.sol` delegates every operation to
`FHEVMExecutor` rather than computing handles locally, so `add` / `gt` / `select` / `randEuint` /
`allow` resolve identically against the mock. Verified rather than assumed: a test decrypts a
stub and checks it against the deterministic plaintext predicate, and the Sepolia HCU figures
above match the mock exactly.

`@fhevm/sdk` is pinned to **0.14.1**. It ships protocol definitions for 0.11 through 0.14 and
resolves the right one from the on-chain ACL version; against Sepolia it negotiates `0.13.0` and
returns a valid input proof from the relayer.

## Timings that shape the interface

Generating an input proof against Zama's relayer takes **11.9 seconds** on Sepolia. That is a
design constraint on the deposit flow, not something to cover with a spinner.

Settlement waits on the relayer publishing the public decryption of the seed and the pool total.
The keeper polls for up to two minutes; in practice the first poll has succeeded.
