import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import type { MockYieldSource, StubPool, StubUSD, TestUSD } from "../types";

const DRAW_INTERVAL = 60 * 60; // 1 hour
const MAX_UINT48 = 281474976710655n;

describe("StubPool", function () {
  this.timeout(300_000);

  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let usd: TestUSD;
  let cusd: StubUSD;
  let yieldSource: MockYieldSource;
  let pool: StubPool;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    usd = (await (await ethers.getContractFactory("TestUSD")).deploy(owner.address)) as TestUSD;
    await usd.waitForDeployment();

    cusd = (await (await ethers.getContractFactory("StubUSD")).deploy(
      await usd.getAddress(),
      "https://stub.example/token",
    )) as StubUSD;
    await cusd.waitForDeployment();

    yieldSource = (await (await ethers.getContractFactory("MockYieldSource")).deploy(
      await usd.getAddress(),
      1_000, // 10% simulated APR
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

    // Fund the prize reserve.
    await (await usd.mint(owner.address, 100_000e6)).wait();
    await (await usd.approve(await yieldSource.getAddress(), 100_000e6)).wait();
    await (await yieldSource.fund(50_000e6)).wait();
  });

  /** Faucet -> wrap -> grant the pool operator rights -> deposit an encrypted amount. */
  async function joinPool(who: HardhatEthersSigner, amount: bigint) {
    await (await usd.connect(who).faucet()).wait();
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

  describe("claim", function () {
    it("moves winnings out and costs the same whether or not you won", async function () {
      await joinPool(alice, 600e6);
      await joinPool(bob, 400e6);
      const { drawId, settled } = await runDraw();

      await (await pool.openStub(drawId, alice.address)).wait();
      await (await pool.openStub(drawId, bob.address)).wait();

      const before = {
        alice: await decrypt64(await pool.confidentialWinningsOf(alice.address), alice),
        bob: await decrypt64(await pool.confidentialWinningsOf(bob.address), bob),
      };

      const aliceGas = (await (await pool.connect(alice).claim()).wait())!.gasUsed;
      const bobGas = (await (await pool.connect(bob).claim()).wait())!.gasUsed;

      for (const who of [alice, bob]) {
        expect(await decrypt64(await pool.confidentialWinningsOf(who.address), who)).to.equal(0n);
      }

      const spread = aliceGas > bobGas ? aliceGas - bobGas : bobGas - aliceGas;
      expect(Number(spread)).to.be.lessThan(5_000, "claiming nothing must look like claiming a prize");
      expect(before.alice + before.bob).to.equal(settled.prize * BigInt(before.alice > 0n || before.bob > 0n ? 1 : 0));
    });
  });
});
