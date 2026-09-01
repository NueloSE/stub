import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";

import type { CheckpointSpike } from "../types";

/**
 * Spike C — is balance-at-seal exact, for free, using an OpenZeppelin primitive?
 *
 * If encrypted handles survive `CheckpointsConfidential`, the draw can read each account's
 * balance as of the seal block instead of its balance now. That removes the deposit lock and
 * the "tag mid-round deposits for the next round" bookkeeping the sweep-based entries need.
 */
describe("CheckpointSpike — encrypted historical balances", function () {
  this.timeout(120_000);

  async function deploy() {
    const [deployer, alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("CheckpointSpike");
    const spike = (await factory.deploy()) as CheckpointSpike;
    await spike.waitForDeployment();
    return { spike, deployer, alice, bob };
  }

  it("reads back an encrypted balance from a past block", async function () {
    const { spike, alice } = await deploy();

    await (await spike.deposit(alice.address, 100_000_000n)).wait();
    await mine(5);
    await (await spike.seal()).wait();
    await mine(5);
    // A deposit made after the seal must not count toward this draw.
    await (await spike.deposit(alice.address, 900_000_000n)).wait();

    const atSeal = await spike.balanceAtSeal(alice.address);
    const now = await spike.latestBalance(alice.address);

    const atSealClear = await fhevm.userDecryptEuint(FhevmType.euint64, atSeal, await spike.getAddress(), alice);
    const nowClear = await fhevm.userDecryptEuint(FhevmType.euint64, now, await spike.getAddress(), alice);

    console.log(`      balance at seal: ${atSealClear}`);
    console.log(`      balance now:     ${nowClear}`);
    console.log(`      checkpoints:     ${await spike.checkpointCount(alice.address)}`);

    expect(atSealClear).to.equal(100_000_000n, "seal-block balance must exclude the later deposit");
    expect(nowClear).to.equal(1_000_000_000n);
  });

  it("uses the seal-block balance in the draw, not the current one", async function () {
    const { spike, alice, bob } = await deploy();

    // Alice holds everything at seal time; Bob deposits afterwards.
    await (await spike.deposit(alice.address, 1_000_000n)).wait();
    await (await spike.seal()).wait();
    await mine(2);
    await (await spike.deposit(bob.address, 999_000_000n)).wait();

    await (await spike.settle(12345n)).wait();

    // Alice held 100% of the pool at seal, so her ticket is always below her balance.
    await (await spike.openStub(alice.address)).wait();
    const aliceStub = await spike.openStub.staticCall(alice.address);
    const aliceTicket = await spike.ticketOf(alice.address);
    expect(aliceTicket).to.be.lessThan(1_000_000n);

    // Bob had no checkpoint at or before the seal, so the lookup returns an uninitialised
    // handle. openStub must still succeed for him, at the same cost as everyone else.
    const bobAtSeal = await spike.balanceAtSeal(bob.address);
    expect(bobAtSeal).to.equal(ethers.ZeroHash, "no checkpoint in range yields a zero handle");
    const bobReceipt = await (await spike.openStub(bob.address)).wait();
    console.log(`      bob openStub gas: ${bobReceipt!.gasUsed} (deposited after the seal)`);

    expect(aliceStub).to.not.equal(ethers.ZeroHash);
  });
});
