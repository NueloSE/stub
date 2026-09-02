import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import type { MockConfidentialUSDC, MockUSDC, MockYieldSource, StubPool } from "../types";

const DRAW_INTERVAL = 60 * 60; // 1 hour
const MAX_UINT48 = 281474976710655n;

describe("StubPool", function () {
  this.timeout(300_000);

  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let usd: MockUSDC;
  let cusd: MockConfidentialUSDC;
  let yieldSource: MockYieldSource;
  let pool: StubPool;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    usd = (await (await ethers.getContractFactory("MockUSDC")).deploy()) as MockUSDC;
    await usd.waitForDeployment();

    cusd = (await (await ethers.getContractFactory("MockConfidentialUSDC")).deploy(
      await usd.getAddress(),
    )) as MockConfidentialUSDC;
    await cusd.waitForDeployment();

    yieldSource = (await (await ethers.getContractFactory("MockYieldSource")).deploy(
      await usd.getAddress(),
      25_000_000n / 3600n, // ~25 cUSDC per hour-long draw
      owner.address,
    )) as MockYieldSource;
    await yieldSource.waitForDeployment();

    pool = (await (await ethers.getContractFactory("StubPool")).deploy(
      await cusd.getAddress(),
      DRAW_INTERVAL,
      owner.address,
    )) as StubPool;
    await pool.waitForDeployment();

    await (await yieldSource.setPool(await pool.getAddress())).wait();
    await (await pool.setYieldSource(await yieldSource.getAddress())).wait();

    // Fund the prize reserve from the same public mint judges will use.
    await (await usd.mint(owner.address, 100_000e6)).wait();
    await (await usd.approve(await yieldSource.getAddress(), 100_000e6)).wait();
    await (await yieldSource.fund(50_000e6)).wait();
  });

  /** Faucet -> wrap -> grant the pool operator rights -> deposit an encrypted amount. */
  async function joinPool(who: HardhatEthersSigner, amount: bigint) {
    await (await usd.connect(who).mint(who.address, amount)).wait();
    await (await usd.connect(who).approve(await cusd.getAddress(), amount)).wait();
    await (await cusd.connect(who).wrap(who.address, amount)).wait();
    await (await cusd.connect(who).setOperator(await pool.getAddress(), MAX_UINT48)).wait();

    const encrypted = await fhevm
      .createEncryptedInput(await pool.getAddress(), who.address)
      .add64(amount)
      .encrypt();

    await (await pool.connect(who).deposit(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function decrypt64(handle: string, who: HardhatEthersSigner) {
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, await pool.getAddress(), who);
  }

  /** Seal, publicly decrypt the seed and total, and settle under the KMS proof. */
  async function runDraw() {
    await time.increase(DRAW_INTERVAL + 1);
    const drawId = await pool.currentDrawId();
    await (await pool.sealDraw()).wait();

    const d = await pool.draws(drawId);
    const decrypted = await fhevm.publicDecrypt([d.seedHandle, d.totalHandle]);

    await (await pool.settleDraw(decrypted.abiEncodedClearValues, decrypted.decryptionProof)).wait();
    return { drawId, settled: await pool.draws(drawId) };
  }

  describe("deposit and withdraw", function () {
    it("credits an encrypted deposit that only the depositor can read", async function () {
      await joinPool(alice, 500e6);

      const handle = await pool.confidentialBalanceOf(alice.address);
      expect(await decrypt64(handle, alice)).to.equal(500_000_000n);
      await expect(decrypt64(handle, bob)).to.be.rejected;
    });

    it("returns principal in full at any time", async function () {
      await joinPool(alice, 500e6);

      const encrypted = await fhevm
        .createEncryptedInput(await pool.getAddress(), alice.address)
        .add64(500e6)
        .encrypt();
      await (await pool.connect(alice).withdraw(encrypted.handles[0], encrypted.inputProof)).wait();

      expect(await decrypt64(await pool.confidentialBalanceOf(alice.address), alice)).to.equal(0n);

      const back = await cusd.confidentialBalanceOf(alice.address);
      const backClear = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        back,
        await cusd.getAddress(),
        alice,
      );
      expect(backClear).to.equal(500_000_000n, "no loss: principal comes back whole");
    });

    it("caps an oversized withdrawal at the balance instead of reverting", async function () {
      await joinPool(alice, 100e6);

      const encrypted = await fhevm
        .createEncryptedInput(await pool.getAddress(), alice.address)
        .add64(999_999e6)
        .encrypt();
      // Must not revert — a failing transaction would leak that the balance was short.
      await (await pool.connect(alice).withdraw(encrypted.handles[0], encrypted.inputProof)).wait();

      expect(await decrypt64(await pool.confidentialBalanceOf(alice.address), alice)).to.equal(0n);
    });
  });

  describe("the draw", function () {
    it("settles against a KMS-proved seed and total", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);

      const { settled } = await runDraw();

      expect(settled.isSettled).to.equal(true);
      expect(settled.totalAtSeal).to.equal(1_000_000_000n, "published total is the odds denominator");
      expect(settled.seed).to.not.equal(0n);
      expect(settled.prize).to.be.greaterThan(0n, "a draw must have something to pay out");
    });

    it("rejects a settlement whose cleartexts are not what the KMS signed", async function () {
      await joinPool(alice, 600e6);
      await time.increase(DRAW_INTERVAL + 1);

      const drawId = await pool.currentDrawId();
      await (await pool.sealDraw()).wait();
      const d = await pool.draws(drawId);
      const decrypted = await fhevm.publicDecrypt([d.seedHandle, d.totalHandle]);

      const forged = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint64"], [1n, 1n]);
      await expect(pool.settleDraw(forged, decrypted.decryptionProof)).to.be.reverted;
    });

    it("gives every account a ticket anyone can recompute from public data", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);
      const { drawId, settled } = await runDraw();

      for (const account of [alice.address, bob.address]) {
        const onchain = await pool.ticketOf(drawId, account);
        const offchain =
          BigInt(
            ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "uint64", "address"],
                [settled.seed, await pool.getAddress(), drawId, account],
              ),
            ),
          ) % settled.totalAtSeal;
        expect(onchain).to.equal(offchain);
      }
    });

    it("opens a stub only its owner can read, at the same cost either way", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);
      const { drawId, settled } = await runDraw();

      const aliceGas = (await (await pool.openStub(drawId, alice.address)).wait())!.gasUsed;
      const bobGas = (await (await pool.openStub(drawId, bob.address)).wait())!.gasUsed;

      const aliceWon = await fhevm.userDecryptEbool(
        await pool.stubOf(drawId, alice.address),
        await pool.getAddress(),
        alice,
      );
      const aliceTicket = await pool.ticketOf(drawId, alice.address);
      expect(aliceWon).to.equal(600_000_000n > aliceTicket, "outcome must match the public predicate");

      await expect(
        fhevm.userDecryptEbool(await pool.stubOf(drawId, alice.address), await pool.getAddress(), bob),
      ).to.be.rejected;

      const spread = aliceGas > bobGas ? aliceGas - bobGas : bobGas - aliceGas;
      expect(Number(spread)).to.be.lessThan(5_000, "winner and loser must cost the same");
      expect(settled.prize).to.be.greaterThan(0n);
    });

    it("pays the prize to whoever the draw picked, and nothing to anyone else", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);
      const { drawId, settled } = await runDraw();

      await (await pool.openStub(drawId, alice.address)).wait();
      await (await pool.openStub(drawId, bob.address)).wait();

      for (const who of [alice, bob]) {
        const ticket = await pool.ticketOf(drawId, who.address);
        const balance = who === alice ? 600_000_000n : 400_000_000n;
        const winnings = await decrypt64(await pool.confidentialWinningsOf(who.address), who);
        expect(winnings).to.equal(balance > ticket ? settled.prize : 0n);
      }
    });

    it("refuses to open the same stub twice", async function () {
      await joinPool(alice, 600e6);
      const { drawId } = await runDraw();

      await (await pool.openStub(drawId, alice.address)).wait();
      await expect(pool.openStub(drawId, alice.address)).to.be.revertedWithCustomError(
        pool,
        "StubAlreadyOpened",
      );
    });

    it("excludes a deposit made after the seal", async function () {
      await joinPool(alice, 600e6);
      await time.increase(DRAW_INTERVAL + 1);

      const drawId = await pool.currentDrawId();
      await (await pool.sealDraw()).wait();

      await joinPool(bob, 400e6); // lands after the seal

      const d = await pool.draws(drawId);
      const decrypted = await fhevm.publicDecrypt([d.seedHandle, d.totalHandle]);
      await (await pool.settleDraw(decrypted.abiEncodedClearValues, decrypted.decryptionProof)).wait();

      expect((await pool.draws(drawId)).totalAtSeal).to.equal(600_000_000n, "seal total excludes Bob");

      await (await pool.openStub(drawId, bob.address)).wait();
      const bobWinnings = await decrypt64(await pool.confidentialWinningsOf(bob.address), bob);
      expect(bobWinnings).to.equal(0n, "Bob had no balance at the seal and cannot win");
    });

    it("will not seal before the interval has elapsed", async function () {
      await joinPool(alice, 600e6);
      await expect(pool.sealDraw()).to.be.revertedWithCustomError(pool, "DrawNotReady");
    });
  });

  describe("prize calibration", function () {
    /**
     * The first live draw paid 0.039954 cUSDC because the mock accrued an APR over four minutes.
     * The arithmetic was right and the result was useless: a prize nobody can see is a prize
     * nobody believes. The mock now drips against the draw interval instead, and this pins it.
     */
    it("pays a prize worth looking at over one draw interval", async function () {
      await joinPool(alice, 600e6);

      const perInterval = await yieldSource.prizePerInterval(DRAW_INTERVAL);
      expect(perInterval).to.be.greaterThan(10e6, "a draw must pay more than pocket change");

      const { settled } = await runDraw();
      console.log(`      prize: ${ethers.formatUnits(settled.prize, 6)} cUSDC per ${DRAW_INTERVAL}s draw`);
      expect(settled.prize).to.be.greaterThan(10e6);
    });

    it("reports how long the reserve lasts", async function () {
      const runway = await yieldSource.runwaySeconds();
      console.log(`      runway: ${(Number(runway) / 86400).toFixed(1)} days of draws`);
      expect(runway).to.be.greaterThan(7n * 86400n, "reserve must outlast the judging window");
    });
  });

  describe("HCU budget", function () {
    /**
     * Gas is only half the budget on FHEVM. Every encrypted operation also burns HCU, metered
     * against a 20,000,000 per-transaction ceiling and a 5,000,000 sequential-depth ceiling.
     * Exceeding either reverts. These are the numbers the README quotes, measured rather than
     * derived from the published cost table.
     */
    const GLOBAL_LIMIT = 20_000_000;
    const DEPTH_LIMIT = 5_000_000;

    it("keeps every operation far inside the per-transaction ceilings", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);
      const { drawId } = await runDraw();

      const openReceipt = await (await pool.openStub(drawId, alice.address)).wait();
      const claimReceipt = await (await pool.connect(alice).claim()).wait();

      const encrypted = await fhevm
        .createEncryptedInput(await pool.getAddress(), alice.address)
        .add64(600e6)
        .encrypt();
      const withdrawReceipt = await (
        await pool.connect(alice).withdraw(encrypted.handles[0], encrypted.inputProof)
      ).wait();

      const measured = [
        ["openStub", openReceipt],
        ["claim", claimReceipt],
        ["withdraw", withdrawReceipt],
      ] as const;

      for (const [label, receipt] of measured) {
        const hcu = fhevm.computeTransactionHCU(receipt!);
        const pct = ((hcu.globalHCU / GLOBAL_LIMIT) * 100).toFixed(2);
        console.log(
          `      ${label.padEnd(9)} ${hcu.globalHCU.toLocaleString().padStart(10)} HCU ` +
            `(${pct.padStart(5)}% of ceiling)  depth ${hcu.maxHCUDepth.toLocaleString()}`,
        );
        expect(hcu.globalHCU).to.be.lessThan(GLOBAL_LIMIT);
        expect(hcu.maxHCUDepth).to.be.lessThan(DEPTH_LIMIT);
      }
    });

    it("costs the same to open a stub whether the account won or lost", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);
      const { drawId } = await runDraw();

      const a = fhevm.computeTransactionHCU((await (await pool.openStub(drawId, alice.address)).wait())!);
      const b = fhevm.computeTransactionHCU((await (await pool.openStub(drawId, bob.address)).wait())!);

      console.log(`      alice ${a.globalHCU.toLocaleString()} HCU, bob ${b.globalHCU.toLocaleString()} HCU`);
      expect(a.globalHCU).to.equal(b.globalHCU, "HCU must not vary with the outcome either");
    });
  });

  describe("claim", function () {
    it("moves winnings out, and looks identical whether or not you won", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);

      // Claim once with nothing owed. This warms each account's storage so the comparison
      // below measures the operation rather than who happened to transact first — the first
      // caller pays cold-access costs on the token, the ACL and the executor.
      await (await pool.connect(alice).claim()).wait();
      await (await pool.connect(bob).claim()).wait();

      const { drawId, settled } = await runDraw();
      await (await pool.openStub(drawId, alice.address)).wait();
      await (await pool.openStub(drawId, bob.address)).wait();

      const owed = {
        alice: await decrypt64(await pool.confidentialWinningsOf(alice.address), alice),
        bob: await decrypt64(await pool.confidentialWinningsOf(bob.address), bob),
      };

      const aliceReceipt = (await (await pool.connect(alice).claim()).wait())!;
      const bobReceipt = (await (await pool.connect(bob).claim()).wait())!;

      // Exactly one of them should be holding the prize.
      expect(owed.alice + owed.bob).to.equal(settled.prize * BigInt(Number(owed.alice > 0n) + Number(owed.bob > 0n)));
      for (const who of [alice, bob]) {
        expect(await decrypt64(await pool.confidentialWinningsOf(who.address), who)).to.equal(0n);
      }

      // The property that matters: the encrypted work is identical, so the coprocessor cannot
      // distinguish a winner from a loser either.
      const aliceHCU = fhevm.computeTransactionHCU(aliceReceipt);
      const bobHCU = fhevm.computeTransactionHCU(bobReceipt);
      console.log(
        `      claim HCU  alice ${aliceHCU.globalHCU.toLocaleString()}  bob ${bobHCU.globalHCU.toLocaleString()}` +
          `   (alice won: ${owed.alice > 0n})`,
      );
      expect(aliceHCU.globalHCU).to.equal(bobHCU.globalHCU, "HCU must not vary with the outcome");

      const gasSpread =
        aliceReceipt.gasUsed > bobReceipt.gasUsed
          ? aliceReceipt.gasUsed - bobReceipt.gasUsed
          : bobReceipt.gasUsed - aliceReceipt.gasUsed;
      console.log(`      claim gas spread once warm: ${gasSpread}`);
      expect(Number(gasSpread)).to.be.lessThan(5_000, "claiming nothing must look like claiming a prize");
    });
  });
});
