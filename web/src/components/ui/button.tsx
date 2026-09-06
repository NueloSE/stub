"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * Every variant except `ghost` is built from a surface class rather than a flat colour: a fill
 * gradient, a separate stroke gradient, and a shadow stack. That is what makes a button read as
 * a raised object under a light source instead of a coloured rectangle, and it is worth the
 * extra CSS on a page whose primary actions cost real money to press.
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-field font-medium " +
    "transition-[opacity,transform,box-shadow] duration-150 " +
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
  {
    variants: {
      variant: {
        primary: "btn-primary-surface hover:opacity-90",
        secondary: "btn-secondary-surface hover:opacity-90",
        ghost:
          "border border-white/[0.14] text-fg-muted hover:border-white/25 hover:bg-white/[0.07] hover:text-fg",
        paper: "btn-paper-surface hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** Shows a spinner and blocks input. Every on-chain action here is slow enough to need it. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

/**
 * A link that looks like a button.
 *
 * Wrapping a `<button>` in an `<a>` is invalid HTML and genuinely confusing to assistive
 * technology — the nesting produces two overlapping interactive elements with one obvious
 * affordance. Something that navigates should be an anchor and carry the button's styling,
 * not contain a button.
 */
export interface ButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof button> {
  href: string;
}

export function ButtonLink({ className, variant, size, href, children, ...props }: ButtonLinkProps) {
  const styles = cn(button({ variant, size }), className);

  if (/^https?:/.test(href)) {
    return (
      <a href={href} className={styles} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={styles} {...props}>
      {children}
    </Link>
  );
}
