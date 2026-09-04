"use client";

import { ArrowLeft, Check, ExternalLink, Lock, X } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { isAddress } from "viem";
import { useReadContract, useReadContracts } from "wagmi";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { ADDRESSES, POOL_ABI } from "@/lib/deployments";
import { formatUSDC } from "@/lib/format";
import { computeTicket } from "@/lib/ticket";

const POOL = ADDRESSES.pool as `0x${string}`;

type Draw = {
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-ink-line py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-44 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
        {label}
      </dt>
      <dd className="tabular min-w-0 break-all font-mono text-sm text-fg">{children}</dd>
    </div>
  );
}

export default function Verify({ params }: { params: Promise<{ drawId: string }> }) {
  const { drawId: drawIdParam } = use(params);
  const drawId = BigInt(drawIdParam);

  const { data } = useReadContracts({
    contracts: [
      { address: POOL, abi: POOL_ABI, functionName: "draws", args: [drawId] },
      { address: POOL, abi: POOL_ABI, functionName: "currentDrawId" },
    ] as const,
    query: { refetchInterval: 20_000 },
  });

  const draw = data?.[0]?.result as Draw | undefined;
  const currentDrawId = (data?.[1]?.result as bigint | undefined) ?? 0n;

  const [account, setAccount] = useState("");
  const valid = isAddress(account);

  // What the browser computes, from public data only.
  const localTicket = useMemo(() => {
    if (!valid || !draw?.isSettled || draw.isVoid) return undefined;
    return computeTicket({
      seed: draw.seed,
      pool: POOL,
      drawId,
      account: account as `0x${string}`,
      totalAtSeal: draw.totalAtSeal,
    });
  }, [valid, draw, drawId, account]);

  // What the contract says, independently.
  const { data: onchainTicket } = useReadContract({
    address: POOL,
    abi: POOL_ABI,
    functionName: "ticketOf",
    args: valid && draw?.isSettled && !draw.isVoid ? [drawId, account as `0x${string}`] : undefined,
    query: { enabled: valid && Boolean(draw?.isSettled) && !draw?.isVoid },
  });

  const matches =
    localTicket !== undefined && onchainTicket !== undefined && localTicket === (onchainTicket as bigint);

  const status = !draw?.isSealed
    ? "not yet sealed"
    : draw.isVoid
      ? "abandoned"
      : draw.isSettled
        ? "settled"
        : "sealed, awaiting settlement";

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="font-mono uppercase tracking-[0.24em]">Stub</span>
        </Link>
        <span className="font-mono text-xs text-fg-faint">no wallet required</span>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-24">
        <h1 className="text-3xl font-medium tracking-tight text-fg">
          Check draw #{drawId.toString()}
        </h1>
        <p className="mt-3 max-w-2xl text-fg-muted">
          Everything the draw used is on this page. The seed came from the protocol, not from the
          operator, and it was published after the pool was frozen — so any ticket can be
          recomputed by anyone, including you, right now.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {[...Array(Number(currentDrawId > 6n ? 6n : currentDrawId + 1n))].map((_, i) => {
            const id = currentDrawId > 6n ? currentDrawId - BigInt(5 - i) : BigInt(i);
            return (
              <Link
                key={id.toString()}
                href={`/verify/${id}`}
                className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                  id === drawId
                    ? "border-accent bg-accent-faint text-accent"
                    : "border-ink-line text-fg-faint hover:text-fg"
                }`}
              >
                #{id.toString()}
              </Link>
            );
          })}
        </div>

        <Panel title="The draw" className="mt-6">
          <dl>
            <Row label="Status">{status}</Row>
            <Row label="Sealed at block">{draw?.sealBlock ? draw.sealBlock.toString() : "—"}</Row>
            <Row label="Pool total at seal">
              {draw?.isSettled ? `${formatUSDC(draw.totalAtSeal)} cUSDC` : "published on settlement"}
            </Row>
            <Row label="Prize">{draw ? `${formatUSDC(draw.prize)} cUSDC` : "—"}</Row>
            <Row label="Seed">
              {draw?.isSettled && !draw.isVoid ? draw.seed.toString() : "not yet published"}
            </Row>
            <Row label="Seed handle">{draw?.seedHandle ?? "—"}</Row>
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-fg-faint">
            The seed is generated by <span className="font-mono">FHE.randEuint256()</span> inside
            the protocol and marked publicly decryptable at the same moment the pool is frozen.
            Whoever seals the draw cannot know it in advance, and everyone learns it at once.
            Settlement verifies the KMS signatures over both the seed and the total before the
            contract will accept either number.
          </p>
        </Panel>

        <Panel
          title="Recompute a ticket"
          hint="Paste any address. This runs in your browser, from public data only."
          className="mt-5"
        >
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value.trim())}
            placeholder="0x…"
            spellCheck={false}
            aria-label="Address to check"
            className="h-10 w-full rounded-lg border border-ink-line bg-ink px-3 font-mono text-sm text-fg outline-none focus:border-accent"
          />

          {account && !valid && (
            <p className="mt-3 text-xs text-warn">That is not a valid address.</p>
          )}

          {valid && draw?.isSettled && !draw.isVoid && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-ink-line bg-ink p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                    Computed here
                  </p>
                  <p className="tabular mt-2 break-all font-mono text-lg text-fg">
                    {localTicket?.toString() ?? "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-ink-line bg-ink p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                    Returned by the contract
                  </p>
                  <p className="tabular mt-2 break-all font-mono text-lg text-fg">
                    {(onchainTicket as bigint | undefined)?.toString() ?? "—"}
                  </p>
                </div>
              </div>

              {onchainTicket !== undefined && (
                <p
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    matches ? "bg-won-faint text-won" : "bg-danger/10 text-danger"
                  }`}
                >
                  {matches ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                  {matches
                    ? "Identical. The contract did not choose this number for anyone."
                    : "Mismatch — this would mean the contract is not doing what it says."}
                </p>
              )}

              <div className="rounded-lg border border-ink-line bg-ink p-4">
                <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                  <Lock className="h-3 w-3" aria-hidden />
                  What this page cannot tell you
                </p>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                  Whether this address won. The outcome is{" "}
                  <span className="font-mono text-fg">balance &gt; ticket</span>, and the balance
                  is a ciphertext — the comparison runs inside the protocol and the result is
                  released to one key. That gap is the product, not a limitation of this page.
                </p>
              </div>
            </div>
          )}

          {valid && draw && !draw.isSettled && (
            <p className="mt-3 text-xs text-fg-faint">
              Tickets exist only once the seed is published. Settle the draw first.
            </p>
          )}
        </Panel>

        <Panel title="Check it yourself" className="mt-5">
          <p className="text-sm leading-relaxed text-fg-muted">
            Nothing above requires trusting this page. The same computation, from a terminal:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-ink-line bg-ink p-4 font-mono text-[11px] leading-relaxed text-fg-muted">
{`ticket = keccak256(abi.encode(seed, pool, drawId, account)) % totalAtSeal

seed        ${draw?.isSettled && !draw.isVoid ? draw.seed.toString() : "<published at settlement>"}
pool        ${POOL}
drawId      ${drawId.toString()}
totalAtSeal ${draw?.isSettled ? draw.totalAtSeal.toString() : "<published at settlement>"}`}
          </pre>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={`https://sepolia.etherscan.io/address/${POOL}#readContract`}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="secondary" size="sm">
                Read the contract <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </a>
            <a href="https://github.com/NueloSE/stub" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm">
                Source <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </a>
          </div>
        </Panel>
      </main>
    </div>
  );
}
