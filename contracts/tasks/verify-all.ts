import { task } from "hardhat/config";

/**
 * Verifies every contract in `deployments/<network>/` on Etherscan.
 *
 *   npx hardhat verify-all --network sepolia
 *
 * Reads the addresses and constructor arguments hardhat-deploy already recorded, so there is no
 * arg order to get wrong and nothing to re-type after a redeploy. Contracts that are already
 * verified are reported and skipped rather than treated as failures.
 *
 * Uses hardhat-verify's task rather than hardhat-deploy's `etherscan-verify`, because the
 * hardhat-deploy version in this project predates Etherscan's V2 API.
 */
task("verify-all", "Verify all deployed contracts on Etherscan").setAction(async (_args, hre) => {
  const all = await hre.deployments.all();
  const names = Object.keys(all);

  if (names.length === 0) {
    console.log(`no deployments recorded for ${hre.network.name}`);
    return;
  }

  let verified = 0;
  let already = 0;
  const failed: string[] = [];

  for (const name of names) {
    const d = all[name];
    console.log(`\n${name} ${d.address}`);
    console.log(`  args ${JSON.stringify(d.args ?? [])}`);

    try {
      await hre.run("verify:verify", {
        address: d.address,
        constructorArguments: d.args ?? [],
      });
      verified++;
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      if (/already verified/i.test(message)) {
        console.log(`  already verified`);
        already++;
      } else {
        console.log(`  FAILED: ${message.split("\n")[0]}`);
        failed.push(name);
      }
    }
  }

  console.log(
    `\n${verified} verified, ${already} already verified` +
      (failed.length ? `, ${failed.length} failed: ${failed.join(", ")}` : ""),
  );
  if (failed.length) process.exitCode = 1;
});
