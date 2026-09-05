import { ethers, deployments } from "hardhat";
async function main() {
  const pool = await ethers.getContractAt("StubPool", (await deployments.get("StubPool")).address);
  const d = await pool.draws(0);
  console.log("  isSealed  ", d.isSealed);
  console.log("  isSettled ", d.isSettled);
  console.log("  isVoid    ", d.isVoid);
  console.log("  sealBlock ", d.sealBlock.toString());
  console.log("  sealedAt  ", d.sealedAt.toString());
  console.log("  prize     ", ethers.formatUnits(d.prize, 6));
  console.log("  seedHandle", d.seedHandle);
  console.log("  totalHandle", d.totalHandle);
  const block = await ethers.provider.getBlock("latest");
  console.log("  now       ", block!.timestamp, new Date(block!.timestamp*1000).toISOString());
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
