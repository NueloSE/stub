# Deploying and testing on Sepolia

Everything runs from `contracts/`. Your `MNEMONIC` and `INFURA_API_KEY` are already in Hardhat
vars, so there is nothing to configure before step 1.

Deployer `0x8bCF8d2f35dFc8D72e0CF40cBeB8e87C12819529`. At 1.05 gwei a deploy costs about
**0.0036 ETH** and a full rehearsal about **0.005 ETH**, so a 0.044 ETH balance is roughly five
complete cycles.

---

## 1. Check Zama's addresses are still what we assumed

```bash
cd contracts
npx hardhat run scripts/check-zama-addresses.ts --network sepolia
```

Reads the live chain and fails loudly if the wrapper's underlying moved or the decimals changed.
Worth running before every deploy: Zama's mock tokens are upgradeable proxies under their
control, so a constant committed last week is not evidence. Expect:

```
confidential token 0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639
  name       Confidential USDC (Mock)
  decimals   6
  rate       1
ok — addresses match config/zama.ts
```

## 2. Check you are who you think you are, and funded

```bash
npx hardhat run scripts/whoami.ts --network sepolia
```

If the balance is under about 0.01 ETH, top up from a Sepolia faucet before going further. A
deploy that runs out of gas halfway leaves the pool unwired.

## 3. Deploy

```bash
npx hardhat deploy --network sepolia
```

Two contracts, both ours — `MockYieldSource` then `StubPool`. The token is Zama's, so nothing is
deployed for it. The script then wires the yield source to the pool, wires the pool to the yield
source, and funds the prize reserve with 50,000 USDCMock from the public mint.

Addresses land in `contracts/deployments/sepolia/`. That directory is committed, so the frontend
and the keeper both read from it.

If a step fails partway, re-running is safe: `hardhat-deploy` reuses what already exists and only
performs the wiring that is still missing.

## 4. Run the whole product once, end to end

```bash
FORCE_DRAW=1 npx hardhat run scripts/rehearse.ts --network sepolia
```

Nine steps: mint, approve, wrap, grant operator, deposit, read your own balance, seal, settle,
open your stub, claim, withdraw. It prints a transaction hash and the measured HCU for every
step, and ends with `WON` or `NOT THIS TIME`.

`FORCE_DRAW=1` is needed **only on the first run after a deploy**. A fresh pool sets
`lastSealedAt` to deployment time, so the first draw is not sealable for fifteen minutes. The
flag collapses the interval for one run and restores it immediately, and only works if you own
the pool. Afterwards, drop the flag and just wait out the interval.

Two things will be slower than they were locally:

- **The input proof takes 10–15 seconds.** It is a real ZK proof against Zama's relayer. This is
  the number the deposit UI has to be designed around, not a spinner bolted on afterwards.
- **Settlement waits on the relayer.** The keeper polls for up to two minutes while the ACL grant
  propagates and the public decryption becomes available. `attempt n/20 not ready yet` in the
  output is normal, not a failure.

Expect HCU roughly in line with the local measurements:

```
openStub     334,096 HCU   1.67% of the 20,000,000 ceiling
claim        586,064 HCU   2.93%
withdraw   1,114,032 HCU   5.57%
```

If Sepolia's numbers differ materially from these, that is a real finding and it changes the
README — the whole point of running this before building the frontend.

## 5. Seal and settle on demand, afterwards

```bash
npx hardhat run scripts/seal-and-settle.ts --network sepolia
```

This is the keeper. Sealing is permissionless once the interval has elapsed, and settling is
guarded by KMS signatures rather than by who is calling, so anyone can run it. Run it on a
schedule, or by hand before recording.

## 6. Verify on Etherscan

Needs a key, which is not set yet:

```bash
npx hardhat vars set ETHERSCAN_API_KEY
npx hardhat etherscan-verify --network sepolia
```

Not required to deploy. Worth doing before submission — verified source is read directly by a
judge who does not want to clone the repo, and it counts against the production-readiness
criterion.

---

## If something goes wrong

**`draw is not sealable for another Ns`** — expected on a fresh pool. Wait, or use `FORCE_DRAW=1`.

**`attempt n/20 not ready yet`** — normal. The relayer has not published the decryption yet.

**Relayer errors on `createEncryptedInput`** — usually transient. Re-run; the deposit has not
happened.

**A deploy that half-finished** — re-run `npx hardhat deploy --network sepolia`. It reuses
existing contracts and completes the wiring.

**Starting over completely** — delete `contracts/deployments/sepolia/` and deploy again. The old
contracts stay on-chain and are simply orphaned; that costs another 0.0036 ETH.
