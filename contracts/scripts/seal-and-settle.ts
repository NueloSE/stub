import hre from "hardhat";

import { sealAndSettle } from "./lib/draw";
import type { StubPool } from "../types";

/**
 * The keeper, as a one-shot command.
 *
 *   npx hardhat run scripts/seal-and-settle.ts --network sepolia
 *
 * Anyone can run this — sealing is permissionless once the interval has elapsed, and settling
 * is guarded by KMS signatures rather than by who is calling.
 */
async function main() {
  const { deployments, ethers } = hre;
  await hre.fhevm.initializeCLIApi();
  const pool = (await ethers.getContractAt(
    "StubPool",
    (await deployments.get("StubPool")).address,
  )) as unknown as StubPool;

  console.log(`pool ${await pool.getAddress()} on ${hre.network.name}\n`);
  await sealAndSettle(hre, pool);
  console.log(`\ndone — stubs for this draw can now be opened`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
