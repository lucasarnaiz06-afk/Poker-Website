import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { requireUser } from "@/lib/auth/session";
import { AccountNav } from "./_components/account-nav";

export const metadata: Metadata = { title: { default: "Account", template: "%s · Account · Felt" } };

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await requireUser({ callbackUrl: "/account" });

  return (
    <PageContainer>
      <PageHeader title="Account" description="Profile, security, wallet and play limits." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <AccountNav />
        </aside>
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </PageContainer>
  );
}
