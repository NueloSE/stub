"use client";

import { motion } from "framer-motion";
import { Lock, Ticket } from "lucide-react";

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

  return (
    <div
      className={cn(
        "relative grid grid-cols-1 overflow-hidden rounded-[--radius-stub] bg-paper text-ink shadow-2xl sm:grid-cols-[1.15fr_1fr]",
        className,
      )}
    >
      {/* Public half */}
      <div className="p-6 sm:p-7">
        <div className="flex items-center gap-2 text-ink/50">
          <Ticket className="h-3.5 w-3.5" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Draw {drawId !== undefined ? `#${drawId}` : "—"}
          </span>
        </div>

        <dl className="mt-5 space-y-4">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40">
              Your ticket
            </dt>
            <dd className="tabular mt-1 font-mono text-2xl leading-none text-ink sm:text-[28px]">
              {ticket !== undefined ? ticket.toString() : "········"}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40">
              Drawn against
            </dt>
            <dd className="tabular mt-1 font-mono text-sm text-ink/70">
              {totalAtSeal !== undefined ? `${formatUSDC(totalAtSeal)} cUSDC in the pool` : "—"}
            </dd>
          </div>
        </dl>

        <p className="mt-6 max-w-[34ch] text-[11px] leading-relaxed text-ink/45">
          Public, and shown without asking — anyone can recompute this number from the draw seed
          and check it was not chosen for you.
        </p>
      </div>

      {/* The tear */}
      <div className="perforation absolute inset-y-3 left-auto hidden w-[3px] sm:block sm:left-[53.5%]" aria-hidden />

      {/* Sealed half */}
      <div className="relative flex flex-col justify-center border-t border-dashed border-paper-line p-6 sm:border-l-0 sm:border-t-0 sm:p-7">
        {revealed ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            {state === "won" || state === "claimed" ? (
              <>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
                  Your stub
                </p>
                <p className="mt-2 flex items-baseline gap-2 text-3xl font-medium leading-none tracking-tight text-ink">
                  You won
                  {state === "claimed" && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40">
                      claimed
                    </span>
                  )}
                </p>
                <p className="tabular mt-3 font-mono text-xl text-ink">
                  {formatUSDC(prize)} <span className="text-sm text-ink/50">cUSDC</span>
                </p>
                <p className="mt-4 max-w-[30ch] text-[11px] leading-relaxed text-ink/45">
                  {state === "claimed"
                    ? "Paid out by confidential transfer. The result stays readable only by you."
                    : "Only you can read this. On-chain it is a ciphertext that looks identical to everyone else's."}
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
                  Your stub
                </p>
                <p className="mt-2 text-3xl font-medium leading-none tracking-tight text-ink/80">
                  Not this time
                </p>
                <p className="mt-3 text-sm text-ink/60">Your principal never moved.</p>
                <p className="mt-4 max-w-[30ch] text-[11px] leading-relaxed text-ink/45">
                  You are already entered in the next draw. Nothing was staked and nothing was
                  lost.
                </p>
              </>
            )}
          </motion.div>
        ) : (
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-2 text-ink/35">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Sealed</span>
            </div>
            <div
              className="mt-3 font-mono text-3xl leading-none tracking-tight text-ink/25"
              aria-label="sealed"
            >
              {state === "opening" || state === "revealing" ? (
                <motion.span
                  animate={{ opacity: [0.25, 0.6, 0.25] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                >
                  ▓▓▓▓▓▓
                </motion.span>
              ) : (
                "▓▓▓▓▓▓"
              )}
            </div>
            <p className="mt-4 max-w-[30ch] text-[11px] leading-relaxed text-ink/45">
              {state === "empty"
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
        )}
      </div>
    </div>
  );
}
