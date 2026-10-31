import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getPendingVerifyEmail } from "@/lib/auth/cookies";
import { AuthCard } from "../_components/auth-card";
import { ResendForm } from "./resend-form";

export const metadata: Metadata = { title: "Check your email" };
export const dynamic = "force-dynamic";

export default function CheckEmailPage({ searchParams }: { searchParams?: { type?: string } }) {
  const isVerify = searchParams?.type === "verify";
  const email = isVerify ? getPendingVerifyEmail() : null;

  return (
    <AuthCard
      title="Check your email"
      footer={
        <Link href="/auth/signin" className="hover:text-fg">
          Back to sign in
        </Link>
      }
    >
      <div className="flex items-start gap-3 text-sm text-muted">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
        <div className="space-y-2">
          {isVerify ? (
            <p>
              We sent a verification link to{" "}
              {email ? <span className="break-all font-medium text-fg">{email}</span> : "your email"}. Open it within 30
              minutes to activate your account and collect your 10,000 welcome chips.
            </p>
          ) : (
            <p>A sign-in link is on its way. It expires in 30 minutes and can be used once.</p>
          )}
          <p>Didn&apos;t get it? Check your spam folder{email ? ", or send it again" : " or wait a minute and try again"}.</p>
        </div>
      </div>
      {email ? (
        <div className="mt-5">
          <ResendForm />
        </div>
      ) : null}
    </AuthCard>
  );
}
