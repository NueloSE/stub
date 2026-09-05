"use client";

import { sepolia } from "@fhevm/sdk/chains";
import { createFhevmClient, initFhevmRuntime, setFhevmRuntimeConfig } from "@fhevm/sdk/viem";
import type { PublicClient, WalletClient } from "viem";

/**
 * The Zama SDK, wrapped so the rest of the app never has to think about it.
 *
 * Two things about this module shape the whole interface:
 *
 *  1. **Encryption is slow.** Producing an input proof takes 10–15 seconds on Sepolia — it is a
 *     real zero-knowledge proof, not a formality. Every call site has to show progress that
 *     survives that long without looking hung.
 *
 *  2. **Reading your own balance costs a signature, but only once.** A decryption permit is an
 *     EIP-712 signature over a transport key. Sign once, decrypt as often as you like until it
 *     expires. Caching it is the difference between a wallet prompt per glance and a wallet
 *     prompt per session.
 *
 * Built on `@fhevm/sdk` 0.14.x, which resolves the protocol version from the on-chain ACL — it
 * negotiates 0.13 against Sepolia without being told.
 */

const PERMIT_TTL_SECONDS = 24 * 60 * 60;
const SESSION_KEY = "stub.fhevm.session.v1";

/** A handle that was never written. Decrypting it would fail; it means zero. */
export const EMPTY_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

export type FhevmClient = ReturnType<typeof createFhevmClient>;

let runtimeReady: Promise<void> | undefined;
let clientPromise: Promise<FhevmClient> | undefined;

/** WASM only exists in the browser. Fail loudly rather than half-working during SSR. */
function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("The Zama SDK is browser-only; call this from a client component.");
  }
}

async function ensureRuntime() {
  assertBrowser();
  runtimeReady ??= (async () => {
    setFhevmRuntimeConfig({});
    await initFhevmRuntime();
  })();
  return runtimeReady;
}

/**
 * The shared client. First call pays for WASM init and a key fetch — roughly four seconds —
 * so it is worth warming as soon as a wallet connects rather than on first use.
 */
export async function getFhevmClient(publicClient: PublicClient): Promise<FhevmClient> {
  clientPromise ??= (async () => {
    await ensureRuntime();
    const client = createFhevmClient({ publicClient, chain: sepolia });
    await client.ready;
    return client;
  })();
  return clientPromise;
}

export type DecryptSession = {
  readonly address: string;
  readonly transportKeyPair: unknown;
  readonly signedPermit: unknown;
  readonly expiresAt: number;
};

type StoredSession = {
  address: string;
  expiresAt: number;
  contracts: string[];
  transportKeyPair: unknown;
  signedPermit: unknown;
};

function readStored(): StoredSession | undefined {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : undefined;
  } catch {
    // Private windows and blocked site data both land here. Not an error — just no cache.
    return undefined;
  }
}

function writeStored(session: StoredSession) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Caching is a convenience. Losing it costs a signature, not correctness.
  }
}

export function clearSession() {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Does a usable permit already exist for this address and these contracts? */
export function hasSession(address: string, contracts: readonly string[]): boolean {
  if (typeof window === "undefined") return false;
  const stored = readStored();
  if (!stored) return false;
  if (stored.address.toLowerCase() !== address.toLowerCase()) return false;
  if (stored.expiresAt <= Date.now() / 1000) return false;
  return contracts.every((c) => stored.contracts.includes(c.toLowerCase()));
}

/**
 * Get a decryption permit, prompting for a signature only if there isn't a live one.
 *
 * @param contracts every contract whose ciphertexts this session should be able to open. Listing
 *        them up front is what keeps this to a single prompt rather than one per contract.
 */
export async function getSession(
  client: FhevmClient,
  walletClient: WalletClient,
  address: string,
  contracts: readonly string[],
): Promise<DecryptSession> {
  assertBrowser();
  const wanted = contracts.map((c) => c.toLowerCase());

  const stored = readStored();
  if (
    stored &&
    stored.address.toLowerCase() === address.toLowerCase() &&
    stored.expiresAt > Date.now() / 1000 &&
    wanted.every((c) => stored.contracts.includes(c))
  ) {
    try {
      // Order matters: the permit is verified against the key pair it was signed with.
      const transportKeyPair = await client.parseTransportKeyPair(
        stored.transportKeyPair as Parameters<typeof client.parseTransportKeyPair>[0],
      );
      const signedPermit = await client.parseSignedDecryptionPermit({
        serializedPermit: stored.signedPermit as never,
        transportKeyPair,
      });
      return { address, transportKeyPair, signedPermit, expiresAt: stored.expiresAt };
    } catch {
      // A cached permit that no longer parses is not worth diagnosing — sign a fresh one.
      clearSession();
    }
  }

  const transportKeyPair = await client.generateTransportKeyPair();
  const startTimestamp = Math.floor(Date.now() / 1000);

  const signedPermit = await client.signDecryptionPermit({
    contractAddresses: [...contracts],
    startTimestamp,
    durationSeconds: PERMIT_TTL_SECONDS,
    signerAddress: address,
    signer: walletClient,
    transportKeyPair,
  });

  const expiresAt = startTimestamp + PERMIT_TTL_SECONDS;

  try {
    const [serializedKeyPair, serializedPermit] = await Promise.all([
      client.serializeTransportKeyPair({ transportKeyPair }),
      client.serializeSignedDecryptionPermit({ signedPermit }),
    ]);
    writeStored({
      address,
      expiresAt,
      contracts: wanted,
      transportKeyPair: serializedKeyPair,
      signedPermit: serializedPermit,
    });
  } catch {
    // Not serializable in this browser — the session still works, it just will not survive a reload.
  }

  return { address, transportKeyPair, signedPermit, expiresAt };
}

/**
 * Open one ciphertext.
 *
 * An unwritten handle is returned as zero rather than sent to the relayer. The pool leaves
 * handles empty for accounts it has never seen, and asking the relayer about one is both a
 * wasted round trip and a confusing error.
 */
export async function decryptHandle(
  client: FhevmClient,
  session: DecryptSession,
  contractAddress: string,
  handle: string | undefined,
): Promise<bigint | boolean | undefined> {
  if (!handle || handle === EMPTY_HANDLE) return undefined;

  const result = await client.decryptValue({
    encryptedValue: handle,
    contractAddress,
    transportKeyPair: session.transportKeyPair as never,
    signedPermit: session.signedPermit as never,
  });

  return result.value as bigint | boolean;
}

/** Convenience wrappers so call sites do not repeat the narrowing. */
export async function decryptUint(
  client: FhevmClient,
  session: DecryptSession,
  contractAddress: string,
  handle: string | undefined,
): Promise<bigint> {
  const value = await decryptHandle(client, session, contractAddress, handle);
  return typeof value === "bigint" ? value : 0n;
}

export async function decryptBool(
  client: FhevmClient,
  session: DecryptSession,
  contractAddress: string,
  handle: string | undefined,
): Promise<boolean> {
  const value = await decryptHandle(client, session, contractAddress, handle);
  return value === true;
}

export type EncryptedInput = {
  readonly handle: `0x${string}`;
  readonly inputProof: `0x${string}`;
};

/**
 * Encrypt an amount for one contract and one caller.
 *
 * Slow by nature — budget 10–15 seconds on Sepolia. The proof binds the ciphertext to both the
 * contract and the caller, so an input built for one pool cannot be replayed against another.
 */
export async function encryptAmount(
  client: FhevmClient,
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<EncryptedInput> {
  const { encryptedValue, inputProof } = await client.encryptValue({
    contractAddress,
    userAddress,
    value: { type: "uint64", value: amount },
  });

  return { handle: encryptedValue as `0x${string}`, inputProof: inputProof as `0x${string}` };
}

/**
 * Fetch the public decryptions of a draw's seed and total, with the KMS proof the contract
 * needs to accept them.
 *
 * This is the whole keeper flow, and it runs in the browser: sealing marks both handles
 * publicly decryptable, the relayer produces the cleartexts and a proof, and `settleDraw`
 * verifies the signatures before it will believe either number. That is why settling can be
 * permissionless — nobody can settle a draw with values the KMS did not sign.
 */
export async function fetchSettlement(
  client: FhevmClient,
  seedHandle: string,
  totalHandle: string,
): Promise<{ cleartexts: `0x${string}`; proof: `0x${string}` }> {
  const { checkSignaturesArgs } = await client.decryptPublicValuesWithSignatures({
    encryptedValues: [seedHandle, totalHandle],
  });
  return {
    cleartexts: checkSignaturesArgs.abiEncodedCleartexts as `0x${string}`,
    proof: checkSignaturesArgs.decryptionProof as `0x${string}`,
  };
}

/**
 * Publicly decrypt one handle and return the cleartext with the proof a contract will accept.
 *
 * Used to finalize an unwrap: the burn marks its amount publicly decryptable and keys the
 * request by that very handle, so the request id and the ciphertext are the same thing.
 */
export async function fetchPublicValue(
  client: FhevmClient,
  handle: string,
): Promise<{ value: bigint; proof: `0x${string}` }> {
  const { clearValues, checkSignaturesArgs } = await client.decryptPublicValuesWithSignatures({
    encryptedValues: [handle],
  });
  const raw = clearValues[0]?.value;
  return {
    value: typeof raw === "bigint" ? raw : BigInt((raw as number | string | undefined) ?? 0),
    proof: checkSignaturesArgs.decryptionProof as `0x${string}`,
  };
}

/** Read the publicly decryptable pool total, published at each seal. */
export async function decryptPublic(
  client: FhevmClient,
  handle: string | undefined,
): Promise<bigint | undefined> {
  if (!handle || handle === EMPTY_HANDLE) return undefined;
  try {
    const [result] = await client.decryptPublicValues({ encryptedValues: [handle] });
    return result?.value as bigint | undefined;
  } catch {
    // Public decryption is only available once a seal has marked the handle decryptable.
    return undefined;
  }
}
