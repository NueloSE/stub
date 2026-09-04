import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Panel({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-ink-line bg-ink-raised p-5", className)}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && (
              <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-fg-muted">
                {title}
              </h2>
            )}
            {hint && <p className="mt-1 text-sm text-fg-faint">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
