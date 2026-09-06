"use client";

import { LifeBuoy, Unlock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";

import { Button } from "@/components/ui/button";
import { ADDRESSES, CONFIDENTIAL_USDC_ABI } from "@/lib/deployments";
import { encryptAmount, fetchPublicValue, type EncryptedInput } from "@/lib/fhevm";
import { formatUSDC, parseUSDC, toInputValue } from "@/lib/format";
import { useDecryption } from "@/lib/pool";

const CUSDC = ADDRESSES.confidentialUSDC as `0x${string}`;

type Phase =
  | "idle"
  | "encrypting"
  | "ready"
  | "burning"
  | "decrypting"
  | "finalizeReady"
  | "finalizing";

/**
 * Turn confidential cUSDC back into plain USDC.
 *
 * Two transactions with a gap between them, and the gap is the interesting part: the burn has
 * already destroyed the confidential balance, and the underlying sits in the wrapper until
 * someone submits the KMS-proved amount. Close the tab in between and the tokens are stranded
 * with nothing prompting you to recover them.
 *
 * So this component does two jobs — run the flow, and go looking for requests that never
 * finished. The second matters more: an app that only handles its happy path leaves people
 * holding nothing with no way to ask for help.
 */
export function Unwrap({ onDone, available }: { onDone: () => void; available?: bigint }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const decryption = useDecryption();

  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<EncryptedInput>();
  const [requestId, setRequestId] = useState<`0x${string}`>();
  const [finalizeData, setFinalizeData] = useState<{ value: bigint; proof: `0x${string}` }>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState<string[]>([]);
  const [recovering, setRecovering] = useState<string>();

  const parsed = parseUSDC(amount);

  const loadPending = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/pending-unwraps?user=${address}`);
      const json = (await res.json()) as { pending?: { requestId: string }[] };
      setPending((json.pending ?? []).map((p) => p.requestId));
    } catch {
      // A scan that fails should not break the panel; the manual flow still works.
    }
  }, [address]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  /** Same reasoning as the main page: a message that never leaves stops being information. */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(undefined), 8_000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(undefined), 14_000);
    return () => clearTimeout(t);
  }, [error]);

  /** Encrypt, and stop — so the wallet is always called from a fresh click. */
  async function prepare() {
    if (!parsed || parsed === 0n) return setError("Enter an amount above zero.");
    if (!decryption.client) return setError("The Zama SDK is still starting.");
    setError(undefined);
    setNotice(undefined);
    setPhase("encrypting");
    try {
      setPrepared(await encryptAmount(decryption.client, CUSDC, address!, parsed));
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message?.split("\n")[0]);
      setPhase("idle");
    }
  }

  /** Burn the confidential balance. The underlying is now owed but not yet released. */
  async function burn() {
    if (!prepared || !walletClient || !publicClient) return;
    setError(undefined);
    setPhase("burning");
    try {
      const hash = await walletClient.writeContract({
        address: CUSDC,
        abi: CONFIDENTIAL_USDC_ABI,
        functionName: "unwrap",
        args: [address!, address!, prepared.handle, prepared.inputProof],
        account: address!,
        chain: sepolia,
      } as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status === "reverted") throw new Error("The burn transaction reverted.");

      const logs = parseEventLogs({
        abi: CONFIDENTIAL_USDC_ABI,
        logs: receipt.logs,
        eventName: "UnwrapRequested",
      });
      const id = (logs[0]?.args as { unwrapRequestId?: `0x${string}` } | undefined)?.unwrapRequestId;
      if (!id) throw new Error("Could not find the unwrap request in that transaction.");

      setPrepared(undefined);
      setRequestId(id);
      await decrypt(id);
    } catch (e) {
      setError((e as Error).message?.split("\n")[0]);
      setPhase("ready");
      void loadPending();
    }
  }

  /** Ask the relayer what the burned amount was, with a proof the wrapper will accept. */
  async function decrypt(id: `0x${string}`) {
    if (!decryption.client) return;
    setPhase("decrypting");
    try {
      setFinalizeData(await fetchPublicValue(decryption.client, id));
      setPhase("finalizeReady");
    } catch (e) {
      setError(`${(e as Error).message?.split("\n")[0]} — the amount may not be published yet, try again.`);
      setPhase("finalizeReady");
    }
  }

  /** Release the underlying. Until this lands, the tokens are owed but unreachable. */
  async function finalize(id: `0x${string}`, data: { value: bigint; proof: `0x${string}` }) {
    if (!walletClient || !publicClient) return;
    setError(undefined);
    setPhase("finalizing");
    try {
      const hash = await walletClient.writeContract({
        address: CUSDC,
        abi: CONFIDENTIAL_USDC_ABI,
        functionName: "finalizeUnwrap",
        args: [id, data.value, data.proof],
        account: address!,
        chain: sepolia,
      } as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status === "reverted") throw new Error("The finalize transaction reverted.");

      setNotice(`Unwrapped ${formatUSDC(data.value)} back to USDC.`);
      setPhase("idle");
      setRequestId(undefined);
      setFinalizeData(undefined);
      setAmount("");
      await loadPending();
      onDone();
    } catch (e) {
      setError((e as Error).message?.split("\n")[0]);
      setPhase("finalizeReady");
    }
  }

  /** Complete a request found by the scanner rather than started in this session. */
  async function recover(id: string) {
    if (!decryption.client) return;
    setRecovering(id);
    setError(undefined);
    try {
      const data = await fetchPublicValue(decryption.client, id);
      await finalize(id as `0x${string}`, data);
    } catch (e) {
      setError((e as Error).message?.split("\n")[0]);
    } finally {
      setRecovering(undefined);
    }
  }

  const busy = phase !== "idle" && phase !== "ready" && phase !== "finalizeReady";

  return (
    <div className="hairline mt-5 pt-4">
      <p className="stat-label">Back to plain USDC</p>
      <p className="mt-1 text-xs text-fg-faint">
        Two transactions. The first burns the confidential balance, the second releases the
        underlying once the amount is proved.
      </p>

      {pending.length > 0 && (
        <div className="mt-3 rounded-field border border-warn/30 bg-warn/10 p-3.5">
          <p className="flex items-center gap-2 text-xs font-medium text-warn">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
            {pending.length === 1
              ? "An unwrap was started but never finished"
              : `${pending.length} unwraps were started but never finished`}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-warn/80">
            The balance is already burned and the USDC is held by the wrapper until this is
            completed. Finishing it costs one transaction and releases the tokens.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {pending.map((id) => (
              <Button
                key={id}
                size="sm"
                variant="secondary"
                loading={recovering === id}
                onClick={() => recover(id)}
              >
                Finish {id.slice(0, 10)}…
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="field-surface relative flex-1">
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              // The proof is bound to an amount. Changing the figure has to discard it, or
              // confirming would burn the amount prepared earlier.
              if (prepared) {
                setPrepared(undefined);
                setPhase("idle");
                setNotice(undefined);
              }
            }}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Amount to unwrap"
            disabled={busy}
            className="tabular h-10 w-full bg-transparent px-3.5 pr-16 font-mono text-sm outline-none disabled:opacity-50"
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-fg-faint">
            cUSDC
          </span>
          {available !== undefined && available > 0n && !busy && (
            <button
              type="button"
              onClick={() => {
                setAmount(toInputValue(available));
                setPrepared(undefined);
                setPhase("idle");
              }}
              className="absolute right-14 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint hover:bg-white/[0.08] hover:text-fg"
            >
              max
            </button>
          )}
        </div>

        {phase === "finalizeReady" && requestId && finalizeData ? (
          <Button className="shrink-0" loading={false} onClick={() => finalize(requestId, finalizeData)}>
            <Unlock className="h-3.5 w-3.5" aria-hidden />
            Release {formatUSDC(finalizeData.value)}
          </Button>
        ) : phase === "ready" ? (
          <Button className="shrink-0" onClick={burn}>
            Confirm unwrap
          </Button>
        ) : (
          <Button
            className="shrink-0"
            variant="secondary"
            loading={busy}
            disabled={!parsed || (available !== undefined && parsed > available)}
            onClick={prepare}
          >
            Unwrap
          </Button>
        )}
      </div>

      {busy && (
        <p className="mt-2 text-[11px] text-fg-faint">
          {phase === "encrypting"
            ? "Encrypting the amount — about twelve seconds."
            : phase === "burning"
              ? "Burning the confidential balance…"
              : phase === "decrypting"
                ? "Asking the relayer to prove the burned amount…"
                : "Releasing the underlying…"}
        </p>
      )}
      {available !== undefined && parsed !== undefined && parsed > available && phase === "idle" && (
        <p className="mt-2 text-[11px] text-warn">
          You hold {formatUSDC(available)} cUSDC — use max. Unlike withdrawing, asking the token
          for more than you hold burns nothing at all, so the transaction would succeed and move
          zero.
        </p>
      )}
      {phase === "finalizeReady" && !error && (
        <p className="mt-2 text-[11px] text-warn">
          Burned. The USDC is owed to you and stays in the wrapper until you release it.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      {notice && !error && <p className="mt-2 text-[11px] text-won">{notice}</p>}
    </div>
  );
}
