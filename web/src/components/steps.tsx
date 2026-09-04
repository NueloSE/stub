"use client";

import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

export type StepState = "done" | "active" | "pending" | "busy";

/**
 * The deposit path is genuinely five steps — mint, approve, wrap, grant, deposit — because a
 * public ERC-20 has to cross into a confidential one before the pool can take it. Hiding that
 * behind a single button would misrepresent where the confidentiality boundary is, and would
 * leave anyone whose transaction failed with no idea which part broke.
 */
export function Steps({
  steps,
}: {
  steps: { label: string; hint?: string; state: StepState }[];
}) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                step.state === "done" && "border-won/40 bg-won-faint text-won",
                step.state === "active" && "border-accent bg-accent-faint text-accent",
                step.state === "busy" && "border-accent bg-accent-faint text-accent",
                step.state === "pending" && "border-ink-line-strong text-fg-faint",
              )}
            >
              {step.state === "done" ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : step.state === "busy" ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "my-1 w-px flex-1",
                  step.state === "done" ? "bg-won/30" : "bg-ink-line",
                )}
              />
            )}
          </div>
          <div className={cn("pb-4", i === steps.length - 1 && "pb-0")}>
            <p
              className={cn(
                "text-sm leading-6",
                step.state === "pending" ? "text-fg-faint" : "text-fg",
              )}
            >
              {step.label}
            </p>
            {step.hint && <p className="mt-0.5 text-xs text-fg-faint">{step.hint}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
