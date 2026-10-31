import type { ReactNode } from "react";

/** Centered, narrow card used by every /auth page. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-[calc(100vh-8rem)] items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-line bg-surface p-6 shadow-panel">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </main>
  );
}
