import type { HardhatRuntimeEnvironment } from "hardhat/types";

import type { StubPool } from "../../types";

/**
 * Seal a draw and settle it.
 *
 * This is the keeper. The bounty accepts "a documented keeper/admin flow" in place of full
 * automation, and this is that flow: three steps, none of which can be faked.
 *
 *   1. `sealDraw` asks the protocol for randomness and marks the seed and the pool total
 *      publicly decryptable. The caller cannot know the seed at this point.
 *   2. The relayer decrypts both handles and returns the cleartexts with a KMS proof.
 *   3. `settleDraw` writes them back. It verifies the KMS signatures before decoding, so
 *      anyone may call it and nobody can settle with numbers the KMS did not sign.
 *
 * Step 2 is asynchronous on a live network — the ACL grant has to reach the relayer before it
 * will serve the decryption — so it is polled rather than awaited once.
 */
export async function sealAndSettle(
  hre: HardhatRuntimeEnvironment,
  pool: StubPool,
  opts: { attempts?: number; delayMs?: number } = {},
) {
  const { fhevm, ethers } = hre;
  const attempts = opts.attempts ?? 20;
  const delayMs = opts.delayMs ?? 6_000;

  const drawId = await pool.currentDrawId();
  const readyAt = await pool.sealableAt();
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  if (now < readyAt) {
    throw new Error(
      `draw ${drawId} is not sealable for another ${readyAt - now}s (at ${new Date(Number(readyAt) * 1000).toISOString()})`,
    );
  }

  console.log(`sealing draw ${drawId}...`);
  const sealReceipt = await (await pool.sealDraw()).wait();
  const sealed = await pool.draws(drawId);
  console.log(`  tx          ${sealReceipt!.hash}`);
  console.log(`  gas         ${sealReceipt!.gasUsed}`);
  console.log(`  seal block  ${sealed.sealBlock}`);
  console.log(`  prize       ${ethers.formatUnits(sealed.prize, 6)} cUSDC`);
  console.log(`  seed handle ${sealed.seedHandle}`);

  console.log(`waiting for the relayer to publish both decryptions...`);
  let decrypted;
  for (let i = 1; i <= attempts; i++) {
    try {
      decrypted = await fhevm.publicDecrypt([sealed.seedHandle, sealed.totalHandle]);
      break;
    } catch (e) {
      if (i === attempts) throw e;
      console.log(`  attempt ${i}/${attempts} not ready yet, retrying in ${delayMs / 1000}s`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(`settling draw ${drawId}...`);
  const settleReceipt = await (
    await pool.settleDraw(decrypted!.abiEncodedClearValues, decrypted!.decryptionProof)
  ).wait();

  const settled = await pool.draws(drawId);
  console.log(`  tx           ${settleReceipt!.hash}`);
  console.log(`  gas          ${settleReceipt!.gasUsed}`);
  console.log(`  seed         ${settled.seed}`);
  console.log(`  total@seal   ${ethers.formatUnits(settled.totalAtSeal, 6)} cUSDC`);

  return { drawId, draw: settled };
}
