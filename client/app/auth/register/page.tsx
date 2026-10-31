import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEnabledAuthProviders } from "@/lib/auth/providers";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthCard } from "../_components/auth-card";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

/** Mentions only the sign-in methods that are actually enabled (same set the sign-in page shows). */
function passwordlessHint(providers: { email: boolean; google: boolean }) {
  if (providers.email && providers.google) return "Prefer no password? Use an email link or Google on the sign-in page.";
  if (providers.email) return "Prefer no password? Get an email sign-in link on the sign-in page.";
  if (providers.google) return "Prefer no password? Continue with Google on the sign-in page.";
  return undefined;
}

export default async function RegisterPage() {
  if (await getCurrentUser()) {
    redirect("/lobby");
  }

  const providers = getEnabledAuthProviders();

  return (
    <AuthCard
      title="Create your account"
      description={passwordlessHint(providers)}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/auth/signin" className="font-medium text-fg hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
