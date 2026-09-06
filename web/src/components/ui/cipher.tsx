"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

const GLYPHS = "0123456789abcdef";

/**
 * A ciphertext, drawn as blocks rather than as a spinner.
 *
 * The distinction matters: a spinner claims something is loading and will finish, and an
 * encrypted balance is neither. It is a value that exists, is complete, and cannot be read.
 * Blocks that breathe say "sealed"; a spinner says "wait". The app is in the first state far
 * more often than the second.
 */
export function Cipher({
  count = 6,
  className,
  blockClassName,
}: {
  count?: number;
  className?: string;
  blockClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[3px] align-middle", className)} aria-label="sealed">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={cn("cipher-block h-[1em] w-[0.62em] rounded-[3px] bg-current", blockClassName)}
          style={{ animationDelay: `${i * 0.14}s` }}
        />
      ))}
    </span>
  );
}

/**
 * Settle a revealed value out of noise.
 *
 * Decryption is instantaneous once the key is in hand, so there is no honest progress to show —
 * but a number that simply appears reads as a number that was always there. Cycling glyphs for
 * a few hundred milliseconds before locking each character makes the transition from sealed to
 * readable legible as an event, which is the one moment in this product worth dramatising.
 */
export function Scramble({
  value,
  className,
  duration = 620,
}: {
  value: string;
  className?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const frame = useRef(0);

  useEffect(() => {
    // Honour the same preference the stylesheet does — this one is driven by JS, so the
    // reduced-motion media query in CSS cannot reach it.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }

    const started = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      // Characters lock left to right, so the figure resolves the way it is read.
      const locked = Math.floor(progress * value.length);
      setDisplay(
        value
          .split("")
          .map((ch, i) => {
            if (i < locked || ch === " " || ch === "." || ch === ",") return ch;
            return GLYPHS[(frame.current + i * 7) % GLYPHS.length];
          })
          .join(""),
      );
      frame.current += 1;
      if (progress < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={cn("tabular", className)}>{display}</span>;
}

/** The one-off light sweep across the paper when a stub is opened. */
export function Sweep() {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/55 to-transparent stub-sweep"
    />
  );
}
