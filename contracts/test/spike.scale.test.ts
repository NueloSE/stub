import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

import type { DrawSpike } from "../types";

/**
 * Spike B — the day-1 go/no-go.
 *
 * Claim under test: settlement is O(1) in the number of depositors, and every participant's
 * outcome is an independent constant-cost check. A sweep-based draw cannot make that claim; it
 * pays per ticket and has to batch across transactions to stay under the 20M HCU ceiling.
 */
describe("DrawSpike — O(1) settlement", function () {
  this.timeout(600_000);

  async function deployWith(depositorCount: number) {
    const [deployer] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("DrawSpike");
    const spike = (await factory.deploy()) as DrawSpike;
    await spike.waitForDeployment();

    const accounts: string[] = [];
    const amounts: bigint[] = [];
    for (let i = 0; i < depositorCount; i++) {
      const account = ethers.Wallet.createRandom().address;
      // Spread of deposit sizes, 1..1000 units, so odds genuinely differ per account.
      const amount = BigInt(1 + ((i * 7919) % 1000)) * 1_000_000n;
      accounts.push(account);
      amounts.push(amount);
      await (await spike.connect(deployer).depositPlainFor(account, amount)).wait();
    }

    return { spike, deployer, accounts, amounts };
  }

  async function sealAndSettle(spike: DrawSpike) {
    const drawId = await spike.currentDrawId();

    const sealTx = await spike.seal();
    const sealReceipt = await sealTx.wait();

    const handle = await spike.seedHandle(drawId);
    const seed = await fhevm.publicDecryptEuint(FhevmType.euint256, handle);

    const settleTx = await spike.settleUnchecked(seed);
    await settleTx.wait();

    return { drawId, seed, sealGas: sealReceipt!.gasUsed };
  }

  it("seals at constant gas regardless of depositor count", async function () {
    const small = await deployWith(10);
    const large = await deployWith(500);

    const smallSeal = await sealAndSettle(small.spike);
    const largeSeal = await sealAndSettle(large.spike);

    console.log(`      seal() gas @ 10  depositors: ${smallSeal.sealGas}`);
    console.log(`      seal() gas @ 500 depositors: ${largeSeal.sealGas}`);

    // A sweep would grow with N. This must not.
    const ratio = Number(largeSeal.sealGas) / Number(smallSeal.sealGas);
    expect(ratio).to.be.lessThan(1.05, "seal() cost must not scale with depositor count");
  });

  it("opens 500 stubs, each at constant cost, with no batching", async function () {
    const { spike, accounts, amounts } = await deployWith(500);
    const totalAtSeal = await spike.poolTotal();
    const { drawId, seed } = await sealAndSettle(spike);

    const gasUsed: bigint[] = [];
    let winners = 0;

    for (let i = 0; i < accounts.length; i++) {
      const receipt = await (await spike.openStub(drawId, accounts[i])).wait();
      gasUsed.push(receipt!.gasUsed);

      // The ticket is public and recomputable off-chain from public data alone.
      const ticket = await spike.ticketOf(drawId, accounts[i]);
      const expected =
        BigInt(
          ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["uint256", "address", "uint64", "address"],
              [seed, await spike.getAddress(), drawId, accounts[i]],
            ),
          ),
        ) % totalAtSeal;
      expect(ticket).to.equal(expected, "ticket must be reproducible off-chain");

      if (amounts[i] > ticket) winners++;
    }

    const min = gasUsed.reduce((a, b) => (a < b ? a : b));
    const max = gasUsed.reduce((a, b) => (a > b ? a : b));
    console.log(`      openStub() gas: min ${min}  max ${max}  over ${gasUsed.length} accounts`);
    console.log(`      winners this draw: ${winners} (expected value: 1)`);

    // Constant cost is what makes a winner indistinguishable from a loser on-chain.
    expect(Number(max - min)).to.be.lessThan(30_000, "openStub cost must not vary with outcome");
  });

  it("lets only the account decrypt its own stub", async function () {
    const [deployer, alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("DrawSpike");
    const spike = (await factory.deploy()) as DrawSpike;
    await spike.waitForDeployment();

    await (await spike.connect(deployer).depositPlainFor(alice.address, 900_000_000n)).wait();
    await (await spike.connect(deployer).depositPlainFor(bob.address, 100_000_000n)).wait();

    const { drawId } = await sealAndSettle(spike);
    await (await spike.openStub(drawId, alice.address)).wait();

    const handle = await spike.stubOf(drawId, alice.address);
    const aliceSees = await fhevm.userDecryptEbool(handle, await spike.getAddress(), alice);
    expect(typeof aliceSees).to.equal("boolean");

    // The predicate is deterministic given the public ticket, so we can check the FHE result.
    const ticket = await spike.ticketOf(drawId, alice.address);
    expect(aliceSees).to.equal(900_000_000n > ticket);

    await expect(fhevm.userDecryptEbool(handle, await spike.getAddress(), bob)).to.be.rejected;
  });
});
