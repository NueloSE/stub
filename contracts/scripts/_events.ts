import { ethers, deployments } from "hardhat";

const USER = "0x45D2abA26a96B8c99ba459E16915AA53F0eeB1f1";

async function main() {
  const addr = (await deployments.get("StubPool")).address;
  const pool = await ethers.getContractAt("StubPool", addr);
  const latest = await ethers.provider.getBlockNumber();
  const from = latest - 4000;

  for (const name of ["Deposited", "Withdrawn", "Claimed", "StubOpened", "DrawSealed", "DrawSettled"]) {
    const logs = await pool.queryFilter(pool.filters[name](), from, latest);
    for (const l of logs) {
      const args = (l as any).args;
      const who = args?.account ?? args?.[1] ?? "";
      const mine = String(who).toLowerCase() === USER.toLowerCase();
      console.log(`  ${name.padEnd(12)} block ${l.blockNumber}  ${mine ? "<- you" : ""}  ${l.transactionHash}`);
    }
  }

  console.log("\n  --- your position now ---");
  console.log("  pool balance handle ", await pool.confidentialBalanceOf(USER));
  console.log("  winnings handle     ", await pool.confidentialWinningsOf(USER));

  const cusdc = await ethers.getContractAt(
    ["function confidentialBalanceOf(address) view returns (bytes32)"],
    await pool.token(),
  );
  console.log("  cUSDC balance handle", await cusdc.confidentialBalanceOf(USER));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
