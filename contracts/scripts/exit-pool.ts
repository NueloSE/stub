import { ethers, fhevm, deployments } from "hardhat";

/**
 * Withdraw the deployer's whole position and shorten the draw interval.
 *
 * A second depositor exists so the losing path can be demonstrated. For a demo of *winning*
 * the account on camera has to hold the pool, so this takes the deployer back out. Asking for
 * more than the balance withdraws all of it, which is the contract's normal behaviour.
 */
async function main() {
  await fhevm.initializeCLIApi();
  const [s] = await ethers.getSigners();
  const poolAddress = (await deployments.get("StubPool")).address;
  const pool = await ethers.getContractAt("StubPool", poolAddress, s);

  process.stdout.write("encrypting a withdrawal larger than the balance...\n");
  const enc = await fhevm
    .createEncryptedInput(poolAddress, s.address)
    .add64(1_000_000n * 10n ** 6n)
    .encrypt();

  process.stdout.write("withdrawing...\n");
  const r = await (await pool.withdraw(enc.handles[0], enc.inputProof)).wait();
  process.stdout.write(`  withdrawn, tx ${r!.hash}\n`);

  const interval = await pool.drawInterval();
  if (interval !== 60n) {
    process.stdout.write("shortening the draw interval to 60s for recording...\n");
    await (await pool.setDrawInterval(60)).wait();
  }

  process.stdout.write(`draw ${await pool.currentDrawId()} sealable at ${new Date(Number(await pool.sealableAt()) * 1000).toISOString()}\n`);
}
main().catch((e) => { process.stdout.write("FAILED: " + (e.message ?? e) + "\n"); process.exitCode = 1; });
