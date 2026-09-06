"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Lock, Ticket } from "lucide-react";

import { Cipher, Scramble, Sweep } from "@/components/ui/cipher";
import { cn } from "@/lib/cn";
import { formatUSDC } from "@/lib/format";

export type StubState =
  | "empty"
  | "waiting"
  | "sealed"
  | "opening"
  | "revealing"
  | "won"
  | "claimed"
  | "lost";

/**
 * The stub. One object with two halves, which is the whole idea:
 *
 *   left  — public. The ticket number, the pool total it was drawn against, the seed. Anyone
 *           can recompute this from the chain and check the draw was honest.
 *   right — sealed. The outcome. Encrypted on-chain, and readable by exactly one person.
 *
 * Showing them side by side is the shortest explanation of FHE anyone has: the maths is public,
 * the person is not.
 *
 * The sealed half carries a security tint — the diagonal hatch printed inside an envelope, or
 * the panel on a scratch card. It is doing real work: it marks the half as physically covered
 * rather than merely empty, so the difference between the two sides is visible before a word is
 * read. Opening the stub lifts the tint, and that lift is the reveal.
 */
export function StubCard({
  state,
  drawId,
  ticket,
  totalAtSeal,
  prize,
  className,
}: {
  state: StubState;
  drawId?: bigint;
  ticket?: bigint;
  totalAtSeal?: bigint;
  prize?: bigint;
  className?: string;
}) {
  const revealed = state === "won" || state === "claimed" || state === "lost";
  const won = state === "won" || state === "claimed";
  const working = state === "opening" || state === "revealing";

  return (
    <div
      className={cn(
        "relative isolate grid grid-cols-1 overflow-hidden rounded-stub text-ink",
        "bg-[linear-gradient(150deg,#fbf9f2_0%,#f5f1e6_55%,#eae4d4_100%)]",
        "shadow-[0_1px_0_0_#ffffff_inset,0_8px_24px_#00000073,0_40px_80px_-32px_#000000a6]",
        "sm:grid-cols-[1.08fr_1fr]",
        className,
      )}
    >
      {/* ── Public half ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-between gap-6 p-6 sm:p-7">
        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/60">
              <Ticket className="h-3 w-3" aria-hidden />
              Draw {drawId !== undefined ? `#${drawId}` : "—"}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/60">
              Public
            </span>
          </div>

          <p className="stat-label mt-6 text-ink/60">Your ticket</p>
          <p className="tabular mt-2 font-mono text-[2.25rem] font-light leading-none tracking-tight text-ink sm:text-[2.75rem]">
            {ticket !== undefined ? ticket.toString() : <span className="text-ink/45">—</span>}
          </p>

          <p className="stat-label mt-5 text-ink/60">Drawn against</p>
          <p className="tabular mt-1.5 font-mono text-sm text-ink/70">
            {totalAtSeal !== undefined ? `${formatUSDC(totalAtSeal)} cUSDC in the pool` : "—"}
          </p>
        </div>

        <p className="max-w-[34ch] text-[11px] leading-relaxed text-ink/60">
          Shown without asking, and without a wallet. Anyone can recompute this number from the
          published seed and check it was not chosen for you.
        </p>
      </div>

      {/* ── The tear ──────────────────────────────────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 hidden sm:left-[51.9%] sm:block"
      >
        {/* Notches at each end, so the line reads as a tear rather than a rule. */}
        <span className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-ink" />
        <span className="perforation absolute inset-y-4 left-1/2 w-[3px] -translate-x-1/2" />
        <span className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-ink" />
      </div>

      {/* ── Sealed half ───────────────────────────────────────────────────────────── */}
      <div className="relative flex min-h-[13.5rem] flex-col justify-between gap-6 border-t border-dashed border-paper-line p-6 sm:border-t-0 sm:p-7">
        {/* The security tint. Present until the stub is opened, then lifted. */}
        <AnimatePresence>
          {!revealed && (
            <motion.span
              key="tint"
              aria-hidden
              initial={false}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,#07070b14_0_7px,transparent_7px_14px)]"
            />
          )}
        </AnimatePresence>

        {/* The sweep fires once, as the tint lifts. */}
        <AnimatePresence>{revealed && <Sweep key="sweep" />}</AnimatePresence>

        <div className="relative flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/60">
            {!revealed && <Lock className="h-3 w-3" aria-hidden />}
            {revealed ? "Opened by you" : "Sealed"}
          </span>
          {state === "claimed" && (
            <span className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/60">
              Claimed
            </span>
          )}
        </div>

        <div className="relative flex flex-1 items-center">
          {revealed ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            >
              {won ? (
                <>
                  <p className="text-[2rem] font-medium leading-none tracking-tight text-ink sm:text-[2.25rem]">
                    You won
                  </p>
                  <p className="tabular mt-3 font-mono text-2xl font-light leading-none text-ink">
                    <Scramble value={formatUSDC(prize)} />{" "}
                    <span className="text-sm text-ink/60">cUSDC</span>
                  </p>
                </>
              ) : (
                <>
                  {/*
                    Losing is the most-seen screen in the product and no-loss is the entire
                    proposition, so it gets the same type scale as winning. Treating it as a
                    smaller, greyer version of the win would tell people they had failed at
                    something the design promises is not a risk.
                  */}
                  <p className="text-[2rem] font-medium leading-none tracking-tight text-ink sm:text-[2.25rem]">
                    Not this time
                  </p>
                  <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-ink/8 px-3 py-1.5 text-xs font-medium text-ink/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink/40" aria-hidden />
                    Principal untouched
                  </p>
                </>
              )}
            </motion.div>
          ) : (
            <div>
              <div className="font-mono text-[2rem] leading-none text-ink/25 sm:text-[2.25rem]">
                <Cipher count={5} className={working ? "opacity-90" : undefined} />
              </div>
            </div>
          )}
        </div>

        <p className="relative max-w-[32ch] text-[11px] leading-relaxed text-ink/60">
          {revealed
            ? won
              ? state === "claimed"
                ? "Paid out by confidential transfer. The result stays readable only by you."
                : "Only you can read this. On-chain it is a ciphertext identical in shape to everyone else's."
              : "Nothing was staked, so nothing was lost. A draw costs a saver only the interest they would have earned."
            : state === "empty"
              ? "Deposit to receive a stub in the next draw."
              : state === "waiting"
                ? "Waiting for the draw to be sealed and settled."
                : state === "opening"
                  ? "Writing your result on-chain…"
                  : state === "revealing"
                    ? "Decrypting — only your key can do this."
                    : "Encrypted on-chain. Nobody can read it, including us, until you open it."}
        </p>
      </div>
    </div>
  );
}
