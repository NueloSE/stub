import { ethers, deployments } from "hardhat";

async function main() {
  const pool = await ethers.getContractAt("StubPool", (await deployments.get("StubPool")).address);
  const ysAddr = await pool.yieldSource();
  const ys = await ethers.getContractAt("MockYieldSource", ysAddr);
  const usdc = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    await ys.asset(),
  );

  const interval = await pool.drawInterval();
  console.log("StubPool        ", await pool.getAddress());
  console.log("  token         ", await pool.token());
  console.log("  yieldSource   ", ysAddr);
  console.log("  drawInterval  ", interval.toString(), "s");
  console.log("  currentDrawId ", (await pool.currentDrawId()).toString());
  console.log("  sealableAt    ", new Date(Number(await pool.sealableAt()) * 1000).toISOString());
  console.log("MockYieldSource ", ysAddr);
  console.log("  pool          ", await ys.pool());
  console.log("  dripPerSecond ", (await ys.dripPerSecond()).toString());
  console.log("  reserve       ", ethers.formatUnits(await usdc.balanceOf(ysAddr), 6), "USDC");
  console.log("  prize/draw    ", ethers.formatUnits(await ys.prizePerInterval(interval), 6), "cUSDC");
  console.log("  runway        ", (Number(await ys.runwaySeconds()) / 86400).toFixed(1), "days");
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
