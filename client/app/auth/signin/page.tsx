import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEnabledAuthProviders } from "@/lib/auth/providers";
import { getCurrentSession, getCurrentUser, safeCallbackUrl } from "@/lib/auth/session";
import { AuthCard } from "../_components/auth-card";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

type Props = { searchParams?: { callbackUrl?: string | string[]; notice?: string | string[] } };

export default async function SignInPage({ searchParams }: Props) {
  const callbackUrl = safeCallbackUrl(searchParams?.callbackUrl);
  // Only active accounts are bounced onward; a session for a suspended/banned account would otherwise loop
  // between here and the protected page.
  if (await getCurrentUser()) {
    redirect(callbackUrl);
  }

  const restricted = Boolean(await getCurrentSession());
  const providers = getEnabledAuthProviders();
  const rawNotice = Array.isArray(searchParams?.notice) ? searchParams?.notice[0] : searchParams?.notice;
  const notice = restricted ? "restricted" : rawNotice;

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Play-money poker with friends."
      footer={
        <>
          New here?{" "}
          <Link href={`/auth/register?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="font-medium text-fg hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <SignInForm callbackUrl={callbackUrl} providers={providers} notice={notice ?? null} />
    </AuthCard>
  );
}
