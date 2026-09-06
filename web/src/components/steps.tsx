"use client";

import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

export type StepState = "done" | "active" | "pending" | "busy";

/**
 * What a deposit will do, as a checklist rather than a progress stepper.
 *
 * The distinction is not cosmetic. These four conditions are evaluated independently — you can
 * already be an operator, and already hold cUSDC, while still needing the wrap. So the honest
 * states include "satisfied, needed, satisfied, satisfied", which a numbered stepper renders as
 * a tick, a current step, then two more ticks. That reads as a broken progress bar, because a
 * stepper promises a single frontier between done and to-do, and there isn't one here.
 *
 * Dropping the numbers and the connecting rule removes the promise of sequence. What remains
 * is the useful part the deposit path always needed: before you spend anything, you can see
 * which transactions will actually fire.
 */
const DESCRIPTION: Record<StepState, string> = {
  done: "already satisfied, will be skipped",
  active: "will run when you confirm",
  pending: "will run once the step above is met",
  busy: "running now",
};

export function Steps({
  steps,
}: {
  steps: { label: string; hint?: string; state: StepState }[];
}) {
  return (
    <ol className="space-y-3.5">
      {steps.map((step) => (
        <li key={step.label} className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
              step.state === "done" && "border-won/45 bg-won-faint text-won",
              step.state === "busy" && "border-accent/60 bg-accent-faint text-accent",
              step.state === "active" && "border-accent/60 bg-accent-faint",
              step.state === "pending" && "border-white/15",
            )}
          >
            {step.state === "done" ? (
              <Check className="h-3 w-3" />
            ) : step.state === "busy" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  step.state === "active" ? "bg-accent" : "bg-white/25",
                )}
              />
            )}
          </span>

          <div className="min-w-0">
            <p
              className={cn(
                "text-sm leading-5",
                // A satisfied condition has nothing for anyone to do, so it recedes.
                step.state === "done" ? "text-fg-muted" : "text-fg",
              )}
            >
              {step.label}
              {/* State is otherwise carried by icon shape and colour alone. */}
              <span className="sr-only"> — {DESCRIPTION[step.state]}</span>
            </p>
            {step.hint && (
              <p className="mt-0.5 text-xs leading-relaxed text-fg-faint">{step.hint}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
