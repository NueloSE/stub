"use client";

import { Check, ExternalLink, Lock, X } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { isAddress } from "viem";
import { useReadContract, useReadContracts } from "wagmi";

import { Chrome, Footer } from "@/components/shell";
import { ButtonLink } from "@/components/ui/button";
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

/** A spec-sheet line. Label left, value right, with the emboss between rows carrying the join. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0 [&+&]:hairline sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="stat-label w-44 shrink-0 pt-0.5">{label}</dt>
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
      <Chrome
        href="/"
        subtitle="public draw record"
        actions={
          <>
            <span className="hidden font-mono text-[11px] text-fg-faint sm:block">
              no wallet required
            </span>
            <ButtonLink href="/app" variant="secondary">
              Open app
            </ButtonLink>
          </>
        }
      />

      <main id="main" tabIndex={-1} className="page-shell pt-4 sm:pt-6">
        <section className="panel p-6 sm:p-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="stat-label">Draw record</span>
            <span
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${
                draw?.isSettled && !draw.isVoid
                  ? "bg-won-faint text-won"
                  : draw?.isVoid
                    ? "bg-danger/10 text-danger"
                    : "bg-white/5 text-fg-muted"
              }`}
            >
              {status}
            </span>
          </div>

          <h1 className="mt-5 text-[2.5rem] font-medium leading-none tracking-[-0.035em] text-fg sm:text-[3.25rem]">
            Draw #{drawId.toString()}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
            Everything the draw used is on this page. The seed came from the protocol, not from the
            operator, and it was published after the pool was frozen — so any ticket can be
            recomputed by anyone, including you, right now.
          </p>

          <div className="mt-7 flex flex-wrap gap-2">
            {[...Array(Number(currentDrawId > 6n ? 6n : currentDrawId + 1n))].map((_, i) => {
              const id = currentDrawId > 6n ? currentDrawId - BigInt(5 - i) : BigInt(i);
              return (
                <Link
                  key={id.toString()}
                  href={`/verify/${id}`}
                  className={`rounded-full px-3 py-1.5 font-mono text-xs transition-colors ${
                    id === drawId
                      ? "btn-primary-surface"
                      : "btn-secondary-surface text-fg hover:opacity-85"
                  }`}
                >
                  #{id.toString()}
                </Link>
              );
            })}
          </div>
        </section>

        {/*
          The recomputation is the evidence, so it goes above the reference data rather than
          below it. Someone who reads nothing else should still be able to paste an address and
          watch two independently-derived numbers agree.
        */}
        <Panel
          title="Recompute a ticket"
          hint="Paste any address. This runs in your browser, from public data only — nothing here trusts this page."
          className="mt-3"
        >
          <div className="field-surface">
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value.trim())}
              placeholder="0x…"
              spellCheck={false}
              aria-label="Address to check"
              className="h-11 w-full bg-transparent px-3.5 font-mono text-sm text-fg outline-none placeholder:text-fg-faint"
            />
          </div>

          {account && !valid && (
            <p className="mt-3 text-xs text-warn">That is not a valid address.</p>
          )}

          {valid && draw?.isSettled && !draw.isVoid && (
            <div className="mt-5 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="panel-inset p-5">
                  <p className="stat-label">Computed here, in your browser</p>
                  <p className="tabular mt-3 break-all font-mono text-2xl font-light leading-tight text-fg">
                    {localTicket?.toString() ?? "—"}
                  </p>
                </div>
                <div className="panel-inset p-5">
                  <p className="stat-label">Returned by the contract</p>
                  <p className="tabular mt-3 break-all font-mono text-2xl font-light leading-tight text-fg">
                    {(onchainTicket as bigint | undefined)?.toString() ?? "—"}
                  </p>
                </div>
              </div>

              {onchainTicket !== undefined && (
                <p
                  className={`flex items-start gap-2.5 rounded-field px-4 py-3.5 text-sm leading-relaxed ${
                    matches
                      ? "border border-won/25 bg-won-faint text-won"
                      : "border border-danger/30 bg-danger/10 text-danger"
                  }`}
                >
                  {matches ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  )}
                  {matches
                    ? "Identical. The contract did not choose this number for anyone."
                    : "Mismatch — this would mean the contract is not doing what it says."}
                </p>
              )}

              {/* The boundary, stated on the page that is otherwise all disclosure. */}
              <div className="panel-inset p-5">
                <p className="stat-label flex items-center gap-2">
                  <Lock className="h-3 w-3" aria-hidden />
                  What this page cannot tell you
                </p>
                <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                  Whether this address won. The outcome is{" "}
                  <span className="font-mono text-fg">balance &gt; ticket</span>, and the balance is
                  a ciphertext — the comparison runs inside the protocol and the result is released
                  to one key. That gap is the product, not a limitation of this page.
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

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel title="The draw" className="min-w-0">
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

            <p className="hairline mt-5 pt-4 text-xs leading-relaxed text-fg-faint">
              The seed is generated by <span className="font-mono">FHE.randEuint256()</span> inside
              the protocol and marked publicly decryptable at the same moment the pool is frozen.
              Whoever seals the draw cannot know it in advance, and everyone learns it at once.
              Settlement verifies the KMS signatures over both the seed and the total before the
              contract will accept either number.
            </p>
          </Panel>

          <Panel title="Check it yourself" hint="The same computation, from a terminal." className="min-w-0">
            <pre className="panel-inset whitespace-pre-wrap break-all p-4 font-mono text-[11px] leading-relaxed text-fg-muted">
{`ticket = keccak256(abi.encode(seed, pool, drawId, account)) % totalAtSeal

seed        ${draw?.isSettled && !draw.isVoid ? draw.seed.toString() : "<published at settlement>"}
pool        ${POOL}
drawId      ${drawId.toString()}
totalAtSeal ${draw?.isSettled ? draw.totalAtSeal.toString() : "<published at settlement>"}`}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink
                href={`https://sepolia.etherscan.io/address/${POOL}#readContract`}
                variant="secondary"
                size="sm"
              >
                Read the contract <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </ButtonLink>
              <ButtonLink href="https://github.com/NueloSE/stub" variant="ghost" size="sm">
                Source <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </ButtonLink>
            </div>
          </Panel>
        </div>
      </main>

      <Footer pool={POOL} yieldSource={ADDRESSES.yieldSource} />
    </div>
  );
}
