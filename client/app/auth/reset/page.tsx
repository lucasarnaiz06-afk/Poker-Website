import { isPasswordResetTokenValid } from "@poker-platform/shared/accounts";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Button } from "@/components/ui";
import { AuthCard } from "../_components/auth-card";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams?: { token?: string | string[] } }) {
  const token = Array.isArray(searchParams?.token) ? searchParams?.token[0] : searchParams?.token;
  const valid = token ? await isPasswordResetTokenValid(token) : false;

  return (
    <AuthCard title="Choose a new password">
      {valid && token ? (
        <ResetForm token={token} />
      ) : (
        <div className="space-y-4">
          <Alert tone="warning">This reset link is invalid or has expired.</Alert>
          <Button asChild fullWidth variant="secondary">
            <Link href="/auth/forgot">Request a new link</Link>
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
