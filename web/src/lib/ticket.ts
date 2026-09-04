import { encodeAbiParameters, keccak256 } from "viem";

/**
 * Recompute a ticket exactly as the contract does.
 *
 *   ticket = keccak256(abi.encode(seed, pool, drawId, account)) mod totalAtSeal
 *
 * Every input is public. That is the point of publishing the pool total at each seal: it makes
 * the odds denominator a number anyone can see, so the draw can be checked by someone who
 * knows nothing about who took part or what they hold.
 *
 * The one thing this cannot tell you is whether the account won, because that comparison runs
 * against an encrypted balance. Being able to show the limit is what makes the guarantee
 * credible.
 */
export function computeTicket({
  seed,
  pool,
  drawId,
  account,
  totalAtSeal,
}: {
  seed: bigint;
  pool: `0x${string}`;
  drawId: bigint;
  account: `0x${string}`;
  totalAtSeal: bigint;
}): bigint {
  if (totalAtSeal === 0n) return 0n;
  const encoded = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "address" }],
    [seed, pool, drawId, account],
  );
  return BigInt(keccak256(encoded)) % totalAtSeal;
}

/** Odds this account held, given a balance. Expressed the way a person reads odds. */
export function oddsOf(balance: bigint, totalAtSeal: bigint): string {
  if (totalAtSeal === 0n || balance === 0n) return "0";
  const pct = (Number(balance) / Number(totalAtSeal)) * 100;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  return "<0.01%";
}
