import { ethers } from "hardhat";
import { SEPOLIA } from "../config/zama";

const USER = "0x45D2abA26a96B8c99ba459E16915AA53F0eeB1f1";

async function main() {
  const usdc = await ethers.getContractAt(
    [
      "event Transfer(address indexed from, address indexed to, uint256 value)",
      "function balanceOf(address) view returns (uint256)",
    ],
    SEPOLIA.usdc,
  );
  const latest = await ethers.provider.getBlockNumber();
  const from = latest - 8000;

  console.log("  plain USDC balance now:", ethers.formatUnits(await usdc.balanceOf(USER), 6));
  console.log("\n  --- public USDC movements (mints and wraps are visible) ---");

  const inbound = await usdc.queryFilter(usdc.filters.Transfer(null, USER), from, latest);
  const outbound = await usdc.queryFilter(usdc.filters.Transfer(USER, null), from, latest);

  const all = [...inbound, ...outbound].sort((a, b) => a.blockNumber - b.blockNumber);
  for (const l of all) {
    const a = (l as any).args;
    const dir = String(a.to).toLowerCase() === USER.toLowerCase() ? "IN " : "OUT";
    const other = dir === "IN " ? a.from : a.to;
    const label =
      other === ethers.ZeroAddress
        ? "mint"
        : String(other).toLowerCase() === SEPOLIA.confidentialUSDC.toLowerCase()
          ? "wrap -> cUSDC"
          : String(other).slice(0, 10);
    console.log(`  block ${l.blockNumber}  ${dir}  ${ethers.formatUnits(a.value, 6).padStart(10)}  ${label}`);
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
