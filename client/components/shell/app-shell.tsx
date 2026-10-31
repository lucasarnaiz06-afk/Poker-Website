"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Footer } from "./footer";
import { isFullScreenRoute } from "./nav-items";
import { TopNav } from "./top-nav";
import type { ShellViewer } from "./viewer";

/** Top nav + footer around every page except full-screen table routes. */
export function AppShell({ viewer, children }: { viewer: ShellViewer | null; children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  if (isFullScreenRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <TopNav viewer={viewer} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
