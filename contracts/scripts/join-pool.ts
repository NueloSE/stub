import { ethers, fhevm, deployments } from "hardhat";
import { SEPOLIA } from "../config/zama";

/**
 * Deposit from the deployer so the pool has more than one participant.
 *
 * A single-depositor pool always pays out to that depositor, which makes the losing path
 * impossible to see — and losing is what most participants experience every draw. Set
 * AMOUNT well above the account under test to make a loss the likely outcome.
 */
const AMOUNT = 2_000n * 10n ** 6n;

async function main() {
  await fhevm.initializeCLIApi();
  const [signer] = await ethers.getSigners();
  const poolAddress = (await deployments.get("StubPool")).address;
  const pool = await ethers.getContractAt("StubPool", poolAddress, signer);

  const usdc = await ethers.getContractAt(
    [
      "function mint(address,uint256)",
      "function approve(address,uint256) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
    ],
    SEPOLIA.usdc,
    signer,
  );
  const cusdc = await ethers.getContractAt(
    [
      "function wrap(address,uint256) returns (bytes32)",
      "function setOperator(address,uint48)",
      "function isOperator(address,address) view returns (bool)",
    ],
    SEPOLIA.confidentialUSDC,
    signer,
  );

  if ((await usdc.balanceOf(signer.address)) < AMOUNT) {
    console.log("minting…");
    await (await usdc.mint(signer.address, AMOUNT)).wait();
  }
  console.log("approving and wrapping…");
  await (await usdc.approve(SEPOLIA.confidentialUSDC, AMOUNT)).wait();
  await (await cusdc.wrap(signer.address, AMOUNT)).wait();

  if (!(await cusdc.isOperator(signer.address, poolAddress))) {
    console.log("granting operator…");
    await (await cusdc.setOperator(poolAddress, 281474976710655n)).wait();
  }

  console.log("encrypting…");
  const enc = await fhevm.createEncryptedInput(poolAddress, signer.address).add64(AMOUNT).encrypt();
  console.log("depositing…");
  const r = await (await pool.deposit(enc.handles[0], enc.inputProof)).wait();

  console.log(`deposited ${ethers.formatUnits(AMOUNT, 6)} cUSDC, tx ${r!.hash}`);
  console.log(`draw ${await pool.currentDrawId()} — sealable at ${new Date(Number(await pool.sealableAt()) * 1000).toISOString()}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
