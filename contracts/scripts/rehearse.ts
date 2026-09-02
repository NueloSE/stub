import hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

import { sealAndSettle } from "./lib/draw";
import type { MockYieldSource, StubPool } from "../types";

/**
 * Walks the entire product in one run, against whatever network is selected.
 *
 *   npx hardhat run scripts/rehearse.ts --network sepolia
 *
 * mint -> approve -> wrap -> grant operator -> deposit -> read your own balance ->
 * seal -> settle -> open your stub -> read it -> claim -> withdraw
 *
 * This is the run to do before recording the video and again before submitting. It is the
 * same sequence a judge will follow by hand, so if it passes here the live app has no excuse.
 */
const DEPOSIT = 250n * 10n ** 6n; // 250 cUSDC

const ERC20 = [
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const ERC7984 = [
  "function wrap(address to, uint256 amount) returns (bytes32)",
  "function setOperator(address operator, uint48 until)",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function underlying() view returns (address)",
];

const MAX_UINT48 = 281474976710655n;

function step(n: number, label: string) {
  console.log(`\n${"-".repeat(70)}\n${n}. ${label}\n${"-".repeat(70)}`);
}

/** Gas is only half the budget on FHEVM. The other half is HCU, and it has its own ceilings. */
function reportHCU(hre: typeof import("hardhat"), receipt: any, label: string) {
  try {
    const hcu = hre.fhevm.computeTransactionHCU(receipt);
    const pctGlobal = ((hcu.globalHCU / 20_000_000) * 100).toFixed(2);
    const pctDepth = ((hcu.maxHCUDepth / 5_000_000) * 100).toFixed(2);
    console.log(
      `  HCU ${label}: ${hcu.globalHCU.toLocaleString()} of 20,000,000 (${pctGlobal}%), ` +
        `depth ${hcu.maxHCUDepth.toLocaleString()} of 5,000,000 (${pctDepth}%)`,
    );
  } catch {
    // HCU accounting is only available where the coprocessor events are readable.
  }
}

async function main() {
  const { deployments, ethers, fhevm } = hre;
  await hre.fhevm.initializeCLIApi();
  const [signer] = await ethers.getSigners();
  const me = signer.address;

  const poolAddress = (await deployments.get("StubPool")).address;
  const pool = (await ethers.getContractAt("StubPool", poolAddress, signer)) as unknown as StubPool;
  const yieldSource = (await ethers.getContractAt(
    "MockYieldSource",
    (await deployments.get("MockYieldSource")).address,
    signer,
  )) as unknown as MockYieldSource;

  const cusdcAddress = await pool.token();
  const cusdc = await ethers.getContractAt(ERC7984, cusdcAddress, signer);
  const usdcAddress: string = await cusdc.underlying();
  const usdc = await ethers.getContractAt(ERC20, usdcAddress, signer);

  console.log(`network  ${hre.network.name}`);
  console.log(`account  ${me}`);
  console.log(`pool     ${poolAddress}`);
  console.log(`cUSDC    ${cusdcAddress}`);
  console.log(`USDC     ${usdcAddress}`);

  step(1, "get test USDC from the public mint");
  const before = await usdc.balanceOf(me);
  if (before < DEPOSIT) {
    const r = await (await usdc.mint(me, DEPOSIT * 4n)).wait();
    console.log(`  minted, tx ${r!.hash}`);
  }
  console.log(`  balance ${ethers.formatUnits(await usdc.balanceOf(me), 6)} USDC`);

  step(2, "approve and wrap into confidential cUSDC");
  await (await usdc.approve(cusdcAddress, DEPOSIT)).wait();
  const wrapReceipt = await (await cusdc.wrap(me, DEPOSIT)).wait();
  console.log(`  wrapped ${ethers.formatUnits(DEPOSIT, 6)}, tx ${wrapReceipt!.hash}`);
  console.log(`  this amount is public — it is the confidentiality boundary`);

  step(3, "grant the pool operator rights");
  if (!(await cusdc.isOperator(me, poolAddress))) {
    const r = await (await cusdc.setOperator(poolAddress, MAX_UINT48)).wait();
    console.log(`  granted, tx ${r!.hash}`);
  } else {
    console.log(`  already granted`);
  }
  console.log(`  a permission, not an amount`);

  step(4, "deposit an encrypted amount");
  console.log(`  building the input proof (slow — this is a real ZK proof)...`);
  const t0 = Date.now();
  const encrypted = await fhevm.createEncryptedInput(poolAddress, me).add64(DEPOSIT).encrypt();
  console.log(`  proof built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const depositReceipt = await (
    await pool.deposit(encrypted.handles[0], encrypted.inputProof)
  ).wait();
  console.log(`  deposited, tx ${depositReceipt!.hash}, gas ${depositReceipt!.gasUsed}`);
  reportHCU(hre, depositReceipt, "deposit");

  step(5, "read your own balance — nobody else can");
  const balanceHandle = await pool.confidentialBalanceOf(me);
  const balance = await fhevm.userDecryptEuint(FhevmType.euint64, balanceHandle, poolAddress, signer);
  console.log(`  handle  ${balanceHandle}`);
  console.log(`  your balance: ${ethers.formatUnits(balance, 6)} cUSDC`);

  step(6, "seal and settle the draw");
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const readyAt = await pool.sealableAt();
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  let restoreInterval = 0n;

  if (now < readyAt) {
    if (chainId === 31337n) {
      // Local networks can simply skip ahead.
      await ethers.provider.send("evm_increaseTime", [Number(readyAt - now) + 1]);
      await ethers.provider.send("evm_mine", []);
      console.log(`  (local network: advanced past the draw interval)`);
    } else if (process.env.FORCE_DRAW === "1" && (await pool.owner()) === me) {
      // A freshly deployed pool is not sealable for a full interval, and a recording cannot
      // wait. Collapse the interval, seal, and put it back — deliberately, behind a flag.
      restoreInterval = await pool.drawInterval();
      console.log(`  FORCE_DRAW: collapsing the ${restoreInterval}s interval for this run`);
      await (await pool.setDrawInterval(0)).wait();
    } else {
      throw new Error(
        `draw is not sealable for another ${readyAt - now}s. ` +
          `Wait, or re-run with FORCE_DRAW=1 if you own the pool.`,
      );
    }
  }
  const reserve = await usdc.balanceOf(await yieldSource.getAddress());
  console.log(`  prize reserve: ${ethers.formatUnits(reserve, 6)} USDC`);
  console.log(`  accrued yield: ${ethers.formatUnits(await yieldSource.accruedYield(), 6)} USDC`);
  const { drawId, draw } = await sealAndSettle(hre, pool);

  if (restoreInterval > 0n) {
    console.log(`  restoring the ${restoreInterval}s draw interval`);
    await (await pool.setDrawInterval(restoreInterval)).wait();
  }

  step(7, "open your stub");
  const ticket = await pool.ticketOf(drawId, me);
  console.log(`  your ticket : ${ticket}`);
  console.log(`  total@seal  : ${draw.totalAtSeal}`);
  console.log(`  anyone can recompute that from the seed. Only you can read the result.`);
  const openReceipt = await (await pool.openStub(drawId, me)).wait();
  console.log(`  opened, tx ${openReceipt!.hash}, gas ${openReceipt!.gasUsed}`);
  reportHCU(hre, openReceipt, "openStub");

  const won = await fhevm.userDecryptEbool(await pool.stubOf(drawId, me), poolAddress, signer);
  console.log(`\n  >>> ${won ? "WON" : "NOT THIS TIME"} <<<`);

  step(8, "claim");
  const winnings = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    await pool.confidentialWinningsOf(me),
    poolAddress,
    signer,
  );
  console.log(`  claimable: ${ethers.formatUnits(winnings, 6)} cUSDC`);
  const claimReceipt = await (await pool.claim()).wait();
  console.log(`  claimed, tx ${claimReceipt!.hash}, gas ${claimReceipt!.gasUsed}`);
  reportHCU(hre, claimReceipt, "claim");
  console.log(`  cost the same whether or not you won`);

  step(9, "withdraw the principal — no loss");
  const wEnc = await fhevm.createEncryptedInput(poolAddress, me).add64(DEPOSIT).encrypt();
  const wReceipt = await (await pool.withdraw(wEnc.handles[0], wEnc.inputProof)).wait();
  console.log(`  withdrawn, tx ${wReceipt!.hash}, gas ${wReceipt!.gasUsed}`);
  reportHCU(hre, wReceipt, "withdraw");

  const after = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    await pool.confidentialBalanceOf(me),
    poolAddress,
    signer,
  );
  console.log(`  pool balance now: ${ethers.formatUnits(after, 6)} cUSDC`);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`full cycle complete on ${hre.network.name}`);
  console.log(`${"=".repeat(70)}`);
}

main().catch((e) => {
  console.error("\nREHEARSAL FAILED:", e.message ?? e);
  process.exitCode = 1;
});
