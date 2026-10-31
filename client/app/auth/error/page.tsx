import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Button } from "@/components/ui";
import { AuthCard } from "../_components/auth-card";

export const metadata: Metadata = { title: "Sign-in problem" };

const MESSAGES: Record<string, string> = {
  AccessDenied: "This account can't sign in here.",
  Verification: "The sign-in link is invalid, expired, or was already used.",
  OAuthAccountNotLinked:
    "An account with this email already exists. Sign in with your original method (password or email link) first.",
  EmailSignin: "We couldn't send the sign-in email. Try again in a few minutes.",
  Configuration: "Sign-in is misconfigured on the server.",
};

export default function AuthErrorPage({ searchParams }: { searchParams?: { error?: string | string[] } }) {
  const code = Array.isArray(searchParams?.error) ? searchParams?.error[0] : searchParams?.error;
  const message = (code && MESSAGES[code]) || "Sign-in could not be completed.";

  return (
    <AuthCard title="Couldn't sign you in">
      <div className="space-y-4">
        <Alert tone="danger">{message}</Alert>
        <Button asChild fullWidth variant="secondary">
          <Link href="/auth/signin">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
