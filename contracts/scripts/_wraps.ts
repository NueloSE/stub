import { ethers } from "hardhat";
import { SEPOLIA } from "../config/zama";
const USER = "0x45D2abA26a96B8c99ba459E16915AA53F0eeB1f1";

async function main() {
  const usdc = await ethers.getContractAt(
    ["event Transfer(address indexed from, address indexed to, uint256 value)"],
    SEPOLIA.usdc,
  );
  const latest = await ethers.provider.getBlockNumber();
  let minted = 0n;
  let wrapped = 0n;

  // Public RPCs cap the range, so walk it in chunks.
  for (let end = latest; end > latest - 60000; end -= 9000) {
    const start = Math.max(end - 8999, latest - 60000);
    try {
      const ins = await usdc.queryFilter(usdc.filters.Transfer(null, USER), start, end);
      const outs = await usdc.queryFilter(usdc.filters.Transfer(USER, null), start, end);
      for (const l of ins) if ((l as any).args.from === ethers.ZeroAddress) minted += (l as any).args.value;
      for (const l of outs)
        if (String((l as any).args.to).toLowerCase() === SEPOLIA.confidentialUSDC.toLowerCase())
          wrapped += (l as any).args.value;
    } catch {
      /* chunk unavailable on this provider */
    }
  }
  console.log("  total minted  :", ethers.formatUnits(minted, 6), "USDC");
  console.log("  total wrapped :", ethers.formatUnits(wrapped, 6), "-> cUSDC");
  console.log("  prize claimed :  25.00 cUSDC");
  console.log("  ------------------------------------");
  console.log("  expected cUSDC:", ethers.formatUnits(wrapped + 25_000_000n, 6), "(all wraps + prize, nothing left in the pool)");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
