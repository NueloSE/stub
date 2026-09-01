import { ethers, network } from "hardhat";

import { SEPOLIA } from "../config/zama";

/**
 * Confirms Zama's Sepolia deployments still look the way we assumed before we point a deploy at
 * them. They are upgradeable proxies under Zama's control, so this is worth re-running before
 * any deploy rather than trusting a constant checked in weeks earlier.
 *
 *   npx hardhat run scripts/check-zama-addresses.ts --network sepolia
 */
async function main() {
  if (network.name !== "sepolia") {
    throw new Error(`expected --network sepolia, got ${network.name}`);
  }

  const cusdc = await ethers.getContractAt(
    [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function underlying() view returns (address)",
      "function rate() view returns (uint256)",
    ],
    SEPOLIA.confidentialUSDC,
  );

  const usdc = await ethers.getContractAt(
    [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
    ],
    SEPOLIA.usdc,
  );

  const [name, symbol, decimals, underlying, rate] = await Promise.all([
    cusdc.name(),
    cusdc.symbol(),
    cusdc.decimals(),
    cusdc.underlying(),
    cusdc.rate(),
  ]);

  console.log(`confidential token ${SEPOLIA.confidentialUSDC}`);
  console.log(`  name       ${name}`);
  console.log(`  symbol     ${symbol}`);
  console.log(`  decimals   ${decimals}`);
  console.log(`  rate       ${rate}`);
  console.log(`  underlying ${underlying}`);
  console.log(`underlying   ${SEPOLIA.usdc}`);
  console.log(`  name       ${await usdc.name()}`);
  console.log(`  symbol     ${await usdc.symbol()}`);
  console.log(`  decimals   ${await usdc.decimals()}`);

  if (underlying.toLowerCase() !== SEPOLIA.usdc.toLowerCase()) {
    throw new Error(`underlying moved: expected ${SEPOLIA.usdc}, wrapper reports ${underlying}`);
  }
  if (Number(decimals) !== 6) {
    throw new Error(`expected 6 decimals, got ${decimals}`);
  }

  console.log(`\nok — addresses match config/zama.ts`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
