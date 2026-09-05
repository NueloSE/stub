import { ethers, deployments } from "hardhat";
const HASH = "0x17c842106c79f51d66277046cb2d750b58b3db459647c4865664603108aadef0";
async function main() {
  const r = await ethers.provider.getTransactionReceipt(HASH);
  if (!r) { console.log("  receipt: not found"); return; }
  console.log("  status     ", r.status, r.status === 1 ? "(SUCCESS)" : "(REVERTED)");
  console.log("  block      ", r.blockNumber);
  console.log("  gasUsed    ", r.gasUsed.toString());
  console.log("  to         ", r.to);
  console.log("  from       ", r.from);
  console.log("  logs       ", r.logs.length);

  const pool = await ethers.getContractAt("StubPool", (await deployments.get("StubPool")).address);
  const d = await pool.draws(0);
  console.log("  --- draw 0 ---");
  console.log("  isSealed   ", d.isSealed, " isSettled", d.isSettled, " isVoid", d.isVoid);
  console.log("  sealBlock  ", d.sealBlock.toString());
  console.log("  prize      ", ethers.formatUnits(d.prize, 6));
  console.log("  seedHandle ", d.seedHandle);
  console.log("  totalHandle", d.totalHandle);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
