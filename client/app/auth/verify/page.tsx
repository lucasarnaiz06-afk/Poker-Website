import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { AuthCard } from "../_components/auth-card";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify email", referrer: "no-referrer" };

export default function VerifyEmailPage({ searchParams }: { searchParams?: { token?: string | string[] } }) {
  const token = Array.isArray(searchParams?.token) ? searchParams?.token[0] : searchParams?.token;

  return (
    <AuthCard
      title="Verify your email"
      description="One click and you're in."
      footer={
        <Link href="/auth/signin" className="hover:text-fg">
          Back to sign in
        </Link>
      }
    >
      {token ? <VerifyForm token={token} /> : <Alert tone="warning">This link is missing its token.</Alert>}
    </AuthCard>
  );
}
