/**
 * Zama's own deployments on Sepolia. Stub uses these rather than shipping a token of its own.
 *
 * Verified against the live chain on 1 September 2026: every ERC-7984 function StubPool calls
 * was checked against the wrapper's deployed bytecode, and the underlying's public `mint` was
 * confirmed present. Source: https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia
 *
 * These are upgradeable proxies under Zama's control. That is a dependency worth stating in the
 * README, and it is outweighed by using the sponsor's registered token instead of a private one.
 */
export const SEPOLIA = {
  /** Confidential USDC (Mock) — ERC7984ERC20Wrapper, listed in the Wrappers Registry. */
  confidentialUSDC: "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639",

  /** USD Coin (Mock) — the underlying. Public `mint(address,uint256)`, 1,000,000 per call. */
  usdc: "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF",

  /** Zama's confidential wrappers registry. */
  wrappersRegistry: "0x2f0750Bbb0A246059d80e94c454586a7F27a128e",
} as const;

/** Six decimals, matching USDC. */
export const USDC_DECIMALS = 6n;

/** What one call to the underlying's public mint hands out. */
export const MINT_LIMIT = 1_000_000n * 10n ** USDC_DECIMALS;
