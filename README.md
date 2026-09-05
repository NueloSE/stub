# Stub

**Everyone gets a stub. Only you can open yours.**

A no-loss prize pool on the Zama Protocol. Deposit a confidential token, keep your principal, and
the yield the pool earns is drawn as a prize instead of being spread thinly across everyone. The
draw is checkable by anyone. Your balance, your odds and your result are readable by one person.

| | |
|---|---|
| **Network** | Ethereum Sepolia |
| **StubPool** | [`0x586E1c4fed4238BcD4E9b197Db688BD2D450e6Fb`](https://sepolia.etherscan.io/address/0x586E1c4fed4238BcD4E9b197Db688BD2D450e6Fb#code) — verified |
| **MockYieldSource** | [`0xAfeAdBFDaB44C1218A4b972e534F81c3DF573255`](https://sepolia.etherscan.io/address/0xAfeAdBFDaB44C1218A4b972e534F81c3DF573255#code) — verified |
| **Token** | Zama's [`cUSDCMock`](https://sepolia.etherscan.io/address/0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639) — we deploy none |
| **Check any draw** | `/verify/[drawId]` — no wallet required |
| **Program** | Zama Developer Program, Mainnet Season 4 — Bounty Track |

---

## What happens

```
  get test USDC  ─▶  wrap  ─▶  deposit  ─▶  ⏳  ─▶  seal  ─▶  settle  ─▶  open  ─▶  claim
   public mint       public    encrypted        protocol   public seed   O(1)      encrypted
                       ▲                        randomness  + total      check     transfer
                       │
              confidentiality boundary
```

1. **Get the token.** Zama already deploys a test ERC-20 on Sepolia with a public `mint`, and the
   confidential wrapper for it. Stub deploys neither — the app calls theirs.
2. **Wrap.** `USDC → cUSDC` (ERC-7984). The wrap amount is public. This is the only step an
   observer can read, and the app says so on screen.
3. **Deposit.** The amount is encrypted in your browser with a zero-knowledge proof binding it to
   this pool and to you. On-chain it is a ciphertext.
4. **Seal.** Once the draw interval has elapsed, anyone can seal. The contract asks the protocol
   for randomness with `FHE.randEuint256()` and publishes both the seed and the pool total as
   publicly decryptable. Whoever seals cannot know the seed in advance.
5. **Settle.** Anyone fetches the decryptions and the KMS proof from the relayer and writes them
   back. `settleDraw` verifies the signatures before it will believe either number, which is what
   makes settling safe to leave open to everyone.
6. **Open your stub.** One O(1) check against your encrypted balance. Always succeeds, always
   costs the same, and writes an encrypted result.
7. **Claim, or withdraw.** Winnings move by confidential transfer. Principal is withdrawable at
   any time — that is the no-loss guarantee.

---

## The draw

Winner selection is a pull model. Settling a draw never walks the depositor list; each account's
outcome is an independent check:

```
ticket_u = keccak256(seed, pool, drawId, u) mod totalAtSeal      ← public
won_u    = balanceAtSeal_u > ticket_u                            ← one FHE.gt
```

`ticket_u` is uniform on `[0, totalAtSeal)`, so `P(won_u) = balance_u / totalAtSeal` **exactly**,
and the per-account probabilities sum to one winner per draw in expectation — the same model
PoolTogether V5 uses. Zero-winner draws roll the prize into the next one.

The move that makes it cheap is scaling the **ticket** in plaintext rather than the **balance** in
ciphertext. Comparing an encrypted balance against a plaintext threshold is one scalar
comparison: no encrypted division, no widening multiply.

**Measured over 500 depositors:**

```
seal() gas @ 10  depositors: 173,672
seal() gas @ 500 depositors: 173,672      constant, not linear
openStub() gas:  134,268 .. 134,292       12 gas of spread across 500 accounts
```

The alternative is sweeping a ticket list over ciphertext. That is O(n), has to be batched across
transactions to stay under the HCU ceiling, and buys a settlement cursor to persist, rounds that
can finish with no winner for mechanical rather than probabilistic reasons, and per-round results
that cannot always be attributed afterwards. None of that exists here, because nothing iterates.

### Eligibility is exact

Each draw reads your balance **as of the seal block**, via OpenZeppelin's
`CheckpointsConfidential`. A deposit made after the seal genuinely cannot win that draw, so there
is no deposit lock and no "mid-round deposits count toward the next round" bookkeeping to get
wrong.

---

## Confidentiality design

The bounty asks for the leakage to be documented, not just the guarantees. Both are below.

### Encrypted

- Every individual deposit amount
- Every individual pool balance, and its whole history
- Every account's odds
- Every outcome — whether you won is an `ebool` released to one key
- Every prize credit and claim amount

### Public, deliberately

- **The pool total at each seal.** This is the odds denominator. Publishing it makes the
  comparison a plaintext scalar rather than an encrypted division, and it is what lets anyone
  recompute every ticket without knowing anything about who took part. It is also what a saver
  already expects to be public in any pooled product.
- **The seed**, after settlement. That is the point — the draw is only checkable if the seed is.
- **Every ticket.** Derived from public inputs; reveals nothing without the balance.
- **The prize per draw.** A property of the pool, not of a person.
- **Participation.** A deposit is a transaction from an address. That an address uses Stub is
  public and always will be; *how much* is not.
- **The wrap amount**, at the ERC-20 → ERC-7984 boundary.

### What that leaks

**Consecutive sealed totals reveal net flow.** If the pool total is 10,000 at one seal and 12,000
at the next, an observer learns +2,000 moved in between. If exactly one deposit happened in that
window, they learn its size. The window is one draw interval, so the mitigation in production is
a longer interval or a fixed schedule that guarantees several deposits per window — not a change
to the cryptography.

**A first deposit is inferable.** An address with no prior position that deposits between two
seals contributes the whole delta if it is the only depositor in that window.

**Timing is public.** When you deposited, when you withdrew, when you opened your stub.

### What does not leak

**Winners are indistinguishable from losers.** `openStub` has no `DidNotWin` revert and no
outcome-dependent branch. Measured for a winner and a loser in the same draw:

```
openStub   334,096 HCU both
claim      586,064 HCU both
claim gas  identical once storage is warm
```

Losing transactions and winning transactions are the same transaction.

**Failure never reveals a balance.** Withdrawing more than you hold sends your whole balance
rather than reverting. An underfunded deposit credits the zero the token actually moved. A
transaction that reverted on insufficient funds would leak the funds.

---

## Verify a draw yourself

`/verify/[drawId]` needs no wallet. It shows the seed, the pool total it was drawn against, and
lets you paste any address and recompute its ticket **in your browser**, beside what the contract
independently returns.

```
ticket = keccak256(abi.encode(seed, pool, drawId, account)) % totalAtSeal
```

The page also states what it cannot do: whether that address won. The outcome is
`balance > ticket`, the balance is a ciphertext, and no amount of public data resolves it. That
boundary is the product.

---

## Yield

`IYieldSource` is a real interface, denominated in the underlying ERC-20 — a yield venue has no
reason to understand ERC-7984, so the pool wraps what it harvests.

On Sepolia there is no real yield, so `MockYieldSource` releases a fixed amount per second from a
reserve the owner funds. **It is a simulation and the app labels it as one everywhere it appears.**
A drip rather than an APR, deliberately: 900 seconds is a rounding error against a year, so any
believable rate pays a prize of a few cents, and reaching a visible one would need a number nobody
would print. Accrual is capped at one draw interval so a quiet weekend cannot make the next draw
pay a multiple of every other.

The mainnet path is the **Steakhouse Confidential Prime USDC vault on Morpho** (`csteakcUSDC`) —
Zama's own confidential yield product. `deposit` supplies the vault, `harvest` redeems accrued
interest, `totalAssets` reads the position. Nothing in `StubPool` changes. One honest difference:
a real venue's yield scales with deposits; this drip does not.

---

## Contracts

Two are ours. The token is Zama's.

| Contract | Role |
|---|---|
| `StubPool` | The vault and the draw |
| `MockYieldSource` | Admin-funded prize reserve, simulated |
| `cUSDCMock` | **Zama's** ERC-7984 wrapper — we deploy no token |
| `USDCMock` | **Zama's** underlying, public `mint` — this is the faucet |

`contracts/contracts/mocks/` holds local clones of Zama's two tokens. They exist only so the
Hardhat suite has something to run against, and are never deployed to a live network.

### Getting back out

Withdrawing returns principal to your wallet as confidential cUSDC. Turning that back into plain
USDC is Zama's two-step unwrap, and the gap between the steps is the interesting part: `unwrap`
has already burned the confidential balance, and the underlying stays in the wrapper until
someone submits the KMS-proved amount to `finalizeUnwrap`. Close the tab in between and the
tokens are stranded with nothing prompting you to recover them.

Stub runs the flow and also goes looking for requests that never finished. A finalized request is
deleted, so `unwrapRequester(id)` reading back non-zero means the underlying is still owed —
`/api/pending-unwraps` scans for those and the app offers to complete them in one transaction.
Log scanning is server-side because public RPCs routinely reject `eth_getLogs` from a browser
origin.

Verified against live Sepolia by stranding an unwrap deliberately: burn, confirm the scanner
finds it, prove the amount through the relayer, finalize, confirm it clears.

### Liveness

Sealing is permissionless and the pool total is encrypted, so nothing on-chain can stop a draw
being sealed over an empty pool. Two guards keep that from freezing the protocol:

- A draw whose total decrypts to zero **settles as void** rather than reverting, and the pool
  moves on immediately with the prize rolled forward.
- A draw whose decryption never arrives at all can be abandoned by anyone after a 24-hour
  settlement window. Settling takes seconds and is open to everyone, so a day is ample; the window
  is what stops `voidDraw` becoming a censorship tool.

---

## Running it

```bash
# contracts
cd contracts && pnpm install
npx hardhat test                                     # 25 tests, including a 500-depositor draw
npx hardhat run scripts/rehearse.ts --network localhost   # the whole product, one command

# app
cd web && pnpm install && pnpm dev
```

> Do not run `pnpm build` while `pnpm dev` is running. They share `.next`, and the build
> replaces the chunks the dev server is still serving — the page then dies with
> `__webpack_modules__[moduleId] is not a function`. Use `pnpm typecheck` to check the app while
> dev is up. If you hit it: stop dev, `rm -rf .next`, start again.

Against Sepolia, see [`docs/deploying.md`](docs/deploying.md). The short version:

```bash
npx hardhat run scripts/check-zama-addresses.ts --network sepolia   # Zama's tokens are proxies
npx hardhat deploy --network sepolia
npx hardhat verify-all --network sepolia
npx hardhat run scripts/export-deployments.ts --network sepolia     # regenerate the app's ABIs
FORCE_DRAW=1 npx hardhat run scripts/rehearse.ts --network sepolia
```

`scripts/seal-and-settle.ts` is the keeper: seal, poll the relayer for both decryptions, settle.
Permissionless, so it can run from anywhere or by hand. The app exposes the same two actions, so a
visitor can drive a draw without any keeper running at all.

---

## Measurements

Gas is only half the budget on FHEVM. Every encrypted operation also burns HCU against a
20,000,000 per-transaction ceiling and a 5,000,000 depth ceiling.

| Operation | HCU | of ceiling | depth |
|---|---|---|---|
| `openStub` | 334,096 | 1.67% | 334,000 |
| `claim` | 586,064 | 2.93% | 369,000 |
| `withdraw` | 1,114,032 | 5.57% | 573,000 |
| `deposit` | 910,128 | 4.55% | 369,000 |

Asserted in the test suite, and **identical on Sepolia and on the local mock, to the unit.**

Further detail, including the toolchain patch and why it is safe, is in
[`docs/engineering-notes.md`](docs/engineering-notes.md).

---

## Known limitations

Stated rather than hidden. Each is a decision, not an oversight.

- **Yield is simulated.** Sepolia has no venue. The interface is real, the reserve is not.
- **A single prize tier.** The bounty does not ask for tiers, and PoolTogether's `4^t` structure
  is a liquidity-distribution feature rather than a confidentiality one.
- **One asset.**
- **The pool owner can change the yield source and the draw interval.** An EOA today; a timelock
  in production.
- **Zama's mock tokens are upgradeable proxies under their control.** Using the sponsor's
  registered token beats shipping a private one, but it is a dependency, and
  `scripts/check-zama-addresses.ts` re-checks the assumption against the live chain before any
  deploy.
- **No prize history.** Past draws are on `/verify/[drawId]` and in the events; there is no feed.
- **Balance-at-seal, not time-weighted.** The seal snapshot closes the deposit-just-before-the-draw
  hole. Full TWAB would additionally weight by how long a balance was held, which matters for
  fairness between a saver who deposited a month ago and one who deposited an hour before the
  seal. `CheckpointsConfidential` already stores what a cumulative-balance-seconds implementation
  would need.

---

## Licence

BSD-3-Clause-Clear.
