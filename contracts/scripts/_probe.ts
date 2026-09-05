import { ethers, deployments } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const pool = await ethers.getContractAt("StubPool", (await deployments.get("StubPool")).address, signer);

  console.log("caller:", signer.address);

  // 1. Would it revert? randEuint256 needs a real transaction, so an eth_call may fail here
  //    even when the transaction itself would succeed. Worth knowing which.
  try {
    await pool.sealDraw.staticCall();
    console.log("  staticCall  OK");
  } catch (e) {
    console.log("  staticCall  FAILED:", ((e as Error).message ?? "").split("\n")[0].slice(0, 200));
  }

  // 2. Can a wallet estimate gas for it? This is what MetaMask does before prompting.
  try {
    const gas = await pool.sealDraw.estimateGas();
    console.log("  estimateGas OK:", gas.toString());
  } catch (e) {
    console.log("  estimateGas FAILED:", ((e as Error).message ?? "").split("\n")[0].slice(0, 200));
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
