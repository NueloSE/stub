/** Six decimals everywhere — the pool, the token and the prize are all USDC-denominated. */
export const DECIMALS = 6;
export const UNIT = 10n ** BigInt(DECIMALS);

/**
 * Money, formatted for reading rather than for precision. Two decimals for anything a person
 * would call an amount; more only when the number is small enough that dropping them would
 * round it to nothing.
 */
export function formatUSDC(value: bigint | undefined, opts: { compact?: boolean } = {}): string {
  if (value === undefined) return "—";
  const whole = value / UNIT;
  const frac = value % UNIT;

  if (opts.compact && whole >= 1_000_000n) return `${(Number(whole) / 1e6).toFixed(2)}M`;
  if (opts.compact && whole >= 10_000n) return `${(Number(whole) / 1e3).toFixed(1)}k`;

  const decimals = whole === 0n && frac > 0n && frac < UNIT / 100n ? 6 : 2;
  const scaled = Number(value) / Number(UNIT);
  return scaled.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Parse a user-typed amount into base units, rejecting anything that is not a clean number. */
export function parseUSDC(input: string): bigint | undefined {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return undefined;
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (frac.length > DECIMALS) return undefined;
  return BigInt(whole || "0") * UNIT + BigInt((frac || "0").padEnd(DECIMALS, "0"));
}

export function shortAddress(address: string | undefined): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** "in 4m 12s" / "now" — countdowns that never show a bare negative. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * A balance as an exact input value, not a display value.
 *
 * `formatUSDC` rounds to two decimals, so typing what the screen shows can ask for slightly more
 * than you hold. On a withdrawal that is harmless — the pool sends everything. On an unwrap it is
 * not: the token transfers zero when the balance is short, so the transaction burns nothing and
 * appears to do nothing. Max fills the real figure.
 */
export function toInputValue(value: bigint): string {
  const whole = value / UNIT;
  const frac = (value % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
