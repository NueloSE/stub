import { ethers } from "hardhat";

/** Prints the deployer identity and funding for whichever network is selected. */
async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("network :", net.name, `(${net.chainId})`);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(balance), "ETH");
  console.log("nonce   :", await ethers.provider.getTransactionCount(deployer.address));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
