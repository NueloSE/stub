import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A floating surface. Panels do not touch — they sit over the ground with a gutter between
 * them, which is what lets a page of six sections read as six objects rather than one long
 * scroll of dividers.
 */
export function Panel({
  title,
  hint,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0">
            {title && <h2 className="stat-label">{title}</h2>}
            {hint && <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("flex-1 px-5 pb-5", !title && !action && "pt-5", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
