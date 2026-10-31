import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPendingTwoFactorCookie } from "@/lib/auth/cookies";
import { safeCallbackUrl } from "@/lib/auth/session";
import { AuthCard } from "../_components/auth-card";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default function TwoFactorPage({ searchParams }: { searchParams?: { callbackUrl?: string | string[] } }) {
  if (!getPendingTwoFactorCookie()) {
    redirect("/auth/signin");
  }

  return (
    <AuthCard
      title="Two-factor authentication"
      description="Enter the code from your authenticator app to finish signing in."
      footer={
        <Link href="/auth/signin" className="hover:text-fg">
          Start over
        </Link>
      }
    >
      <TwoFactorForm callbackUrl={safeCallbackUrl(searchParams?.callbackUrl)} />
    </AuthCard>
  );
}
