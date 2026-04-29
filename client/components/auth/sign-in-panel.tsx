"use client";

import { isAllowedEmailDomain } from "@poker-platform/shared/auth";
import { LogIn, Mail, ShieldCheck } from "lucide-react";
import { signIn } from "next-auth/react";
import { FormEvent, useMemo, useState } from "react";
import type { EnabledAuthProviders } from "@/lib/auth/providers";

type SignInPanelProps = {
  allowedDomains: string[];
  callbackUrl: string;
  providers: EnabledAuthProviders;
};

export function SignInPanel({
  allowedDomains,
  callbackUrl,
  providers,
}: SignInPanelProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const domainLabel = useMemo(
    () =>
      allowedDomains
        .map((domain) => (domain.includes("@") ? domain : `@${domain}`))
        .join(", "),
    [allowedDomains],
  );

  async function handleEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (!isAllowedEmailDomain(email, allowedDomains)) {
      setMessage(`Use an approved email domain: ${domainLabel}.`);
      return;
    }

    setIsSubmitting(true);

    const result = await signIn("email", {
      email,
      callbackUrl,
      redirect: false,
    });

    setIsSubmitting(false);

    if (result?.error) {
      if (result.error === "AccessDenied") {
        setMessage(`Use an approved email domain: ${domainLabel}.`);
        return;
      }

      if (result.error === "EmailSignin") {
        setMessage("Email delivery failed. Check the SMTP settings and try again.");
        return;
      }

      setMessage("Sign-in could not be started. Check the auth configuration and try again.");
      return;
    }

    setMessage("Check your email for the sign-in link.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1fr_420px]">
        <div className="flex flex-col justify-center gap-6">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-700/20 bg-white px-3 py-1 text-sm font-medium text-emerald-800">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Domain restricted
          </div>
          <div className="space-y-4">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-normal text-zinc-950 md:text-5xl">
              Poker Platform
            </h1>
            <p className="max-w-xl text-base leading-7 text-zinc-600">
              Sign in with an approved account to enter the lobby shell.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-panel">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-zinc-950">Sign in</h2>
            <p className="mt-2 text-sm text-zinc-600">{domainLabel}</p>
          </div>

          <div className="space-y-3">
            {providers.email ? (
              <form className="space-y-3" onSubmit={handleEmailSignIn}>
                <label className="block text-sm font-medium text-zinc-700" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  placeholder={`name@${allowedDomains[0] ?? "university.edu"}`}
                  required
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting ? "Sending" : "Send sign-in link"}
                </button>
              </form>
            ) : null}

            {providers.google ? (
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl })}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Continue with Google
              </button>
            ) : null}

            {!providers.email && !providers.google ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Configure an email or Google provider in `.env` to enable sign-in.
              </div>
            ) : null}

            {message ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                {message}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
