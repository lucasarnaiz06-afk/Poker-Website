import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "../_components/auth-card";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we'll send you a link to choose a new password."
      footer={
        <Link href="/auth/signin" className="hover:text-fg">
          Back to sign in
        </Link>
      }
    >
      <ForgotForm />
    </AuthCard>
  );
}
