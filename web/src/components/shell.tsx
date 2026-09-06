import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The mark: an admission ticket — notched silhouette, two ruled lines.
 *
 * Drawn bare rather than set inside a tile. The previous mark was a thin outline on a dark
 * chip, which at 36px read as a generic icon container rather than as a logo; a solid shape
 * carries itself.
 *
 * This exists in three places that must stay in step: here (JSX, for the header), `app/icon.svg`
 * (the favicon, simplified to one rule so it survives 16px) and `app/opengraph-image.tsx` (a
 * data URI, because Satori cannot render JSX SVG).
 */
export function StubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("h-8 w-8 shrink-0", className)}
      fill="none"
    >
      <defs>
        <linearGradient id="stub-mark-gold" x1="0" y1="6" x2="0" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff3ad" />
          <stop offset="55%" stopColor="#ffdf58" />
          <stop offset="100%" stopColor="#e0b93f" />
        </linearGradient>
        {/* The notches are cut out of the shape, not painted over it, so the mark stays
            transparent there and sits on any background. */}
        <mask id="stub-mark-notch">
          <rect x="3" y="7.5" width="26" height="17" rx="4.5" fill="#fff" />
          <circle cx="3" cy="16" r="3.1" fill="#000" />
          <circle cx="29" cy="16" r="3.1" fill="#000" />
        </mask>
      </defs>
      <rect
        x="3"
        y="7.5"
        width="26"
        height="17"
        rx="4.5"
        fill="url(#stub-mark-gold)"
        mask="url(#stub-mark-notch)"
      />
      <path
        d="M10.5 13.4h11M10.5 18h7"
        stroke="#07070b"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.66"
      />
    </svg>
  );
}

/**
 * The floating top bar, shared by the landing and the app.
 *
 * It is a panel rather than a full-bleed header: it sits over the ground with a gutter on every
 * side, which keeps the page reading as a set of objects on a surface rather than as stacked
 * bands. Sticky, so the wallet control and the network warning are always one glance away.
 */
export function Chrome({
  actions,
  href = "/",
  subtitle = "confidential prize savings",
}: {
  actions?: ReactNode;
  href?: string;
  subtitle?: string;
}) {
  return (
    <>
      {/*
        The first thing in the tab order, and invisible until it is focused. Without it a
        keyboard or screen-reader user tabs through the whole header on every page before
        reaching anything they came for.
      */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-field focus:bg-accent focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-ink"
      >
        Skip to content
      </a>

      <header className="chrome-bar sticky top-0 z-50">
      <div className="page-shell flex items-center justify-between gap-3 py-3">
        <Link
          href={href}
          aria-label="Stub — home"
          className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-85"
        >
          <StubMark />
          <span className="min-w-0">
            <span className="block font-mono text-sm uppercase leading-tight tracking-[0.22em] text-fg">
              Stub
            </span>
            <span className="hidden text-[11px] leading-tight text-fg-faint sm:block">{subtitle}</span>
          </span>
        </Link>
        <nav aria-label="Primary" className="flex shrink-0 items-center gap-2">
          {actions}
        </nav>
      </div>
      </header>
    </>
  );
}

/** The shared page footer. Same disclosures on both pages — the terms do not change by route. */
export function Footer({ pool, yieldSource }: { pool: string; yieldSource: string }) {
  return (
    <footer className="page-shell mt-14 pb-14">
      <div className="hairline pt-6 text-xs text-fg-faint">
        <p className="max-w-2xl leading-relaxed">
          Sepolia. Yield is simulated by an admin-funded reserve — no real return is generated. The
          confidential token is Zama&apos;s own <span className="font-mono">cUSDCMock</span>; Stub
          deploys no token of its own.
        </p>
        <nav aria-label="Footer" className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono">
          <a
            className="transition-colors hover:text-fg"
            href={`https://sepolia.etherscan.io/address/${pool}#code`}
            target="_blank"
            rel="noreferrer"
          >
            pool ↗
          </a>
          <a
            className="transition-colors hover:text-fg"
            href={`https://sepolia.etherscan.io/address/${yieldSource}#code`}
            target="_blank"
            rel="noreferrer"
          >
            yield source ↗
          </a>
          <Link className="transition-colors hover:text-fg" href="/verify">
            check a draw
          </Link>
          <a
            className="transition-colors hover:text-fg"
            href="https://github.com/NueloSE/stub"
            target="_blank"
            rel="noreferrer"
          >
            source ↗
          </a>
        </nav>
      </div>
    </footer>
  );
}
