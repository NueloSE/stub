"use client";

import { MotionConfig, motion } from "framer-motion";
import { ArrowRight, Eye, RotateCcw } from "lucide-react";
import { useState } from "react";

import {
  ArtCheck,
  ArtOnlyYou,
  ArtPrincipal,
  ArtWithdraw,
} from "@/components/landing-art";
import { Chrome, Footer } from "@/components/shell";
import { StubCard } from "@/components/stub-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { ADDRESSES } from "@/lib/deployments";
import { formatUSDC, UNIT } from "@/lib/format";

/** A fixed stub, so the marketing page shows the real component rather than a picture of one. */
const DEMO = {
  drawId: 7n,
  ticket: 8_412_996n,
  totalAtSeal: 12_500n * UNIT,
  prize: 214_630_000n,
};

const FEATURES = [
  {
    art: ArtPrincipal,
    title: "Your principal never moves",
    body: "Deposits are yours the whole time. A draw spends the pooled yield, never the deposits that produced it — so entering costs you nothing but the interest.",
  },
  {
    art: ArtCheck,
    title: "Anyone can check the draw",
    body: "The seed comes from the protocol, not an operator, and is published the moment the pool is frozen. Recompute any ticket in your browser, from public data, without a wallet.",
  },
  {
    art: ArtOnlyYou,
    title: "Only you can read your result",
    body: "The outcome is a ciphertext on-chain. The comparison that decides it runs inside the protocol, and the answer is released to exactly one key — yours.",
  },
  {
    art: ArtWithdraw,
    title: "Withdraw whenever you like",
    body: "No lock-up and no penalty. Asking for more than you hold sends your whole balance rather than reverting, so a transaction never reveals your position by failing.",
  },
];

const STEPS = [
  { n: "01", t: "Deposit", b: "Wrap USDC into a confidential balance and send an encrypted amount to the pool." },
  { n: "02", t: "The draw runs", b: "Anyone can seal and settle it. The seed is published; every ticket becomes recomputable." },
  { n: "03", t: "Open your stub", b: "One signature decrypts your own result. Win and claim, or keep your principal and stay in." },
];

export function Landing() {
  const [opened, setOpened] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen">
        <Chrome
          actions={
            <>
              <ButtonLink href="/verify" variant="ghost" className="hidden sm:inline-flex">
                Check a draw
              </ButtonLink>
              <ButtonLink href="/app">
                Open app
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </ButtonLink>
            </>
          }
        />

        <main id="main" tabIndex={-1} className="page-shell pt-4 sm:pt-6">
          {/* ── Hero ─────────────────────────────────────────────────────────────────── */}
          <section className="panel grid items-center gap-10 p-6 sm:p-10 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
            <div>
              <p className="stat-label">Confidential prize savings · Zama fhEVM</p>
              <h1 className="mt-5 max-w-[15ch] text-[2.5rem] font-medium leading-[0.98] tracking-[-0.035em] text-fg sm:text-[3.25rem] lg:text-[3.75rem]">
                Everyone gets a stub. Only you can open yours.
              </h1>
              <p className="mt-6 max-w-lg text-base leading-relaxed text-fg-muted">
                Deposit a confidential token and keep your principal. The pooled yield is drawn as a
                prize — publicly, so the draw can be checked by anyone, and privately, so the result
                can be read by one person.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/app" size="lg">
                  Open the app
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
                <ButtonLink href="/verify" variant="secondary" size="lg">
                  Check a draw
                </ButtonLink>
              </div>
              <p className="mt-5 text-xs text-fg-faint">
                Live on Sepolia. Test USDC from a faucet in the app — no real funds involved.
              </p>
            </div>

            {/*
              The hero visual is the real component in a fixed state, not an image of it. Letting a
              visitor open it is the cheapest possible demonstration of what the product is: the
              left half was always readable, and the right half needed a key.
            */}
            <div className="panel-inset relative p-4 sm:p-6">
              <p role="status" aria-live="polite" className="sr-only">
                {opened
                  ? `Demo stub opened. This one won ${formatUSDC(DEMO.prize)} cUSDC.`
                  : "Demo stub is sealed."}
              </p>
              <StubCard
                state={opened ? "won" : "sealed"}
                drawId={DEMO.drawId}
                ticket={DEMO.ticket}
                totalAtSeal={DEMO.totalAtSeal}
                prize={DEMO.prize}
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {opened ? (
                  <Button variant="secondary" onClick={() => setOpened(false)}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Seal it again
                  </Button>
                ) : (
                  <Button variant="paper" onClick={() => setOpened(true)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    Open the stub
                  </Button>
                )}
                <p className="text-[11px] leading-relaxed text-fg-faint">
                  A demo, with no wallet attached. Most real stubs read{" "}
                  <span className="text-fg-muted">not this time</span> — and the deposit behind them
                  is never at stake.
                </p>
              </div>
            </div>
          </section>

          {/* ── What it does ─────────────────────────────────────────────────────────── */}
          <section className="mt-3 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f, i) => (
              <motion.article
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                className="panel overflow-hidden"
              >
                {/*
                  The illustration is given real room rather than shrunk to a glyph. At this
                  size it can carry the idea on its own, which is the only reason to put a
                  picture on a page of prose.
                */}
                <div className="flex h-44 items-center justify-center px-6 pt-2 sm:h-56">
                  <f.art className="h-full w-auto max-w-full" />
                </div>
                <div className="px-6 pb-7">
                  <h2 className="text-lg font-medium tracking-tight text-fg">{f.title}</h2>
                  <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-fg-muted">{f.body}</p>
                </div>
              </motion.article>
            ))}
          </section>

          {/* ── How it works ─────────────────────────────────────────────────────────── */}
          <section className="panel mt-3 p-6 sm:p-10">
            <h2 className="stat-label">How a draw runs</h2>
            <ol className="mt-7 grid gap-8 sm:grid-cols-3 sm:gap-6">
              {STEPS.map((s) => (
                <li key={s.n} className="relative">
                  <span className="tabular font-mono text-xs tracking-[0.18em] text-accent">{s.n}</span>
                  <h3 className="mt-3 text-lg font-medium tracking-tight text-fg">{s.t}</h3>
                  <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-fg-muted">{s.b}</p>
                </li>
              ))}
            </ol>
            <div className="hairline mt-9 flex flex-wrap items-center gap-4 pt-6">
              <ButtonLink href="/app">
                Start with a deposit
                <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
              <p className="text-xs text-fg-faint">
                Sealing and settling are permissionless — no operator can withhold a draw.
              </p>
            </div>
          </section>
        </main>

        <Footer pool={ADDRESSES.pool} yieldSource={ADDRESSES.yieldSource} />
      </div>
    </MotionConfig>
  );
}
