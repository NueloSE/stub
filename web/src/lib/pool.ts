"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWalletClient } from "wagmi";

import {
  ADDRESSES,
  CONFIDENTIAL_USDC_ABI,
  POOL_ABI,
  USDC_ABI,
  YIELD_SOURCE_ABI,
} from "./deployments";
import {
  decryptBool,
  decryptUint,
  getFhevmClient,
  getSession,
  hasSession,
  type DecryptSession,
  type FhevmClient,
} from "./fhevm";

const POOL = ADDRESSES.pool as `0x${string}`;
const CUSDC = ADDRESSES.confidentialUSDC as `0x${string}`;
const USDC = ADDRESSES.usdc as `0x${string}`;

/** ERC-7984 operator grants take an expiry. Effectively "until revoked". */
export const OPERATOR_UNTIL = 281474976710655n;

export type Draw = {
  sealBlock: number;
  prize: bigint;
  totalAtSeal: bigint;
  seed: bigint;
  seedHandle: `0x${string}`;
  totalHandle: `0x${string}`;
  isSealed: boolean;
  isSettled: boolean;
  sealedAt: bigint;
  isVoid: boolean;
};

/**
 * Everything the page needs from the chain, in one poll.
 *
 * Deliberately one hook rather than several: the draw clock, the prize and the pool total have
 * to agree with each other on screen, and independent refetches make them disagree for a second
 * at a time. A prize that briefly contradicts the countdown reads as a bug.
 */
export function usePoolState() {
  const { address } = useAccount();

  const contracts = useMemo(
    () =>
      [
        { address: POOL, abi: POOL_ABI, functionName: "currentDrawId" },
        { address: POOL, abi: POOL_ABI, functionName: "sealableAt" },
        { address: POOL, abi: POOL_ABI, functionName: "drawInterval" },
        { address: POOL, abi: POOL_ABI, functionName: "voidableAt" },
        { address: POOL, abi: POOL_ABI, functionName: "rolloverPrize" },
        {
          address: ADDRESSES.yieldSource as `0x${string}`,
          abi: YIELD_SOURCE_ABI,
          functionName: "accruedYield",
        },
      ] as const,
    [],
  );

  const { data, refetch, isLoading } = useReadContracts({
    contracts,
    query: { refetchInterval: 12_000 },
  });

  const currentDrawId = (data?.[0]?.result as bigint | undefined) ?? 0n;
  const sealableAt = (data?.[1]?.result as bigint | undefined) ?? 0n;
  const drawInterval = (data?.[2]?.result as bigint | undefined) ?? 0n;
  const voidableAt = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const rolloverPrize = (data?.[4]?.result as bigint | undefined) ?? 0n;
  const accruedYield = (data?.[5]?.result as bigint | undefined) ?? 0n;

  // The draw being played for, and the one before it — the most recent settled result.
  const drawIds = useMemo(() => {
    const ids: bigint[] = [currentDrawId];
    if (currentDrawId > 0n) ids.push(currentDrawId - 1n);
    return ids;
  }, [currentDrawId]);

  const { data: drawData, refetch: refetchDraws } = useReadContracts({
    contracts: drawIds.map(
      (id) => ({ address: POOL, abi: POOL_ABI, functionName: "draws", args: [id] }) as const,
    ),
    query: { enabled: drawIds.length > 0, refetchInterval: 12_000 },
  });

  const draws = useMemo(() => {
    const out = new Map<string, Draw>();
    drawData?.forEach((entry, i) => {
      const raw = entry?.result as Draw | undefined;
      if (raw) out.set(drawIds[i].toString(), raw);
    });
    return out;
  }, [drawData, drawIds]);

  const current = draws.get(currentDrawId.toString());
  const previous = currentDrawId > 0n ? draws.get((currentDrawId - 1n).toString()) : undefined;

  /** The draw a user can actually open a stub for: the last one that settled cleanly. */
  const openable = previous && previous.isSettled && !previous.isVoid ? previous : undefined;
  const openableId = openable ? currentDrawId - 1n : undefined;

  const { data: alreadyOpened, refetch: refetchOpened } = useReadContract({
    address: POOL,
    abi: POOL_ABI,
    functionName: "stubOpened",
    args: openableId !== undefined && address ? [openableId, address] : undefined,
    query: { enabled: openableId !== undefined && Boolean(address) },
  });

  const refresh = useCallback(async () => {
    await Promise.all([refetch(), refetchDraws(), refetchOpened()]);
  }, [refetch, refetchDraws, refetchOpened]);

  return {
    isLoading,
    currentDrawId,
    sealableAt,
    drawInterval,
    voidableAt,
    rolloverPrize,
    accruedYield,
    /** The draw currently accepting deposits, sealed or not. */
    current,
    /** The most recent settled draw — the one with a result to reveal. */
    openable,
    openableId,
    alreadyOpened: Boolean(alreadyOpened),
    /** Live prize estimate for the next seal: accrued yield plus anything rolled over. */
    nextPrize: accruedYield + rolloverPrize,
    refresh,
  };
}

/** Public, unencrypted reads about the connected wallet. */
export function useWalletState() {
  const { address } = useAccount();

  const { data, refetch } = useReadContracts({
    contracts:
      address !== undefined
        ? ([
            { address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [address] },
            { address: USDC, abi: USDC_ABI, functionName: "allowance", args: [address, CUSDC] },
            {
              address: CUSDC,
              abi: CONFIDENTIAL_USDC_ABI,
              functionName: "isOperator",
              args: [address, POOL],
            },
            {
              address: CUSDC,
              abi: CONFIDENTIAL_USDC_ABI,
              functionName: "confidentialBalanceOf",
              args: [address],
            },
          ] as const)
        : [],
    query: { enabled: Boolean(address), refetchInterval: 12_000 },
  });

  return {
    usdc: (data?.[0]?.result as bigint | undefined) ?? 0n,
    allowance: (data?.[1]?.result as bigint | undefined) ?? 0n,
    isOperator: Boolean(data?.[2]?.result),
    confidentialHandle: data?.[3]?.result as `0x${string}` | undefined,
    refetch,
  };
}

/** Encrypted handles belonging to the connected wallet. Meaningless until decrypted. */
export function useEncryptedHandles() {
  const { address } = useAccount();

  const { data, refetch } = useReadContracts({
    contracts:
      address !== undefined
        ? ([
            {
              address: POOL,
              abi: POOL_ABI,
              functionName: "confidentialBalanceOf",
              args: [address],
            },
            {
              address: POOL,
              abi: POOL_ABI,
              functionName: "confidentialWinningsOf",
              args: [address],
            },
          ] as const)
        : [],
    query: { enabled: Boolean(address), refetchInterval: 12_000 },
  });

  return {
    balanceHandle: data?.[0]?.result as `0x${string}` | undefined,
    winningsHandle: data?.[1]?.result as `0x${string}` | undefined,
    refetch,
  };
}

/**
 * The decryption session, and the values it has opened.
 *
 * Deliberately explicit: nothing decrypts until the user asks. A page that silently prompts for
 * a signature on load teaches people to click through wallet dialogs without reading them.
 */
export function useDecryption() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [client, setClient] = useState<FhevmClient>();
  const [session, setSession] = useState<DecryptSession>();
  const [status, setStatus] = useState<"idle" | "preparing" | "signing" | "ready" | "error">("idle");
  const [error, setError] = useState<string>();

  // Warm the SDK as soon as a wallet is present. First init costs seconds; better spent now.
  useEffect(() => {
    if (!publicClient || client) return;
    let cancelled = false;
    setStatus((s) => (s === "idle" ? "preparing" : s));
    getFhevmClient(publicClient as never)
      .then((c) => {
        if (!cancelled) {
          setClient(c);
          setStatus((s) => (s === "preparing" ? "idle" : s));
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message ?? "Could not start the Zama SDK");
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [publicClient, client]);

  const contracts = useMemo(() => [POOL, CUSDC], []);
  const cached = address ? hasSession(address, contracts) : false;

  const unlock = useCallback(async () => {
    if (!client || !walletClient || !address) return undefined;
    setError(undefined);
    setStatus(cached ? "preparing" : "signing");
    try {
      const s = await getSession(client, walletClient as never, address, contracts);
      setSession(s);
      setStatus("ready");
      return s;
    } catch (e) {
      const message = (e as Error)?.message ?? "Signature rejected";
      setError(/rejected|denied/i.test(message) ? "Signature rejected" : message);
      setStatus("error");
      return undefined;
    }
  }, [client, walletClient, address, contracts, cached]);

  const readUint = useCallback(
    async (contract: string, handle: string | undefined) => {
      const s = session ?? (await unlock());
      if (!client || !s) return undefined;
      return decryptUint(client, s, contract, handle);
    },
    [client, session, unlock],
  );

  const readBool = useCallback(
    async (contract: string, handle: string | undefined) => {
      const s = session ?? (await unlock());
      if (!client || !s) return undefined;
      return decryptBool(client, s, contract, handle);
    },
    [client, session, unlock],
  );

  return {
    client,
    session,
    status,
    error,
    /** A permit is cached, so unlocking will not prompt the wallet. */
    cached,
    ready: Boolean(client),
    unlock,
    readUint,
    readBool,
    POOL,
    CUSDC,
  };
}
