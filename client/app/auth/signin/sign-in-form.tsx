"use client";

import { KeyRound, Mail } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { useFormState } from "react-dom";
import { Alert, Button, Field, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { passwordSignInAction, type AuthFormState } from "../actions";
import { FormMessage, SubmitButton } from "../_components/form-bits";
import { PasswordInput } from "../_components/password-input";

type Props = {
  callbackUrl: string;
  providers: { email: boolean; google: boolean };
  notice: string | null;
};

const NOTICES: Record<string, string> = {
  "password-reset": "Password updated. Sign in with your new password.",
  "email-verified": "Email verified. Sign in to continue.",
  "signed-out": "You've been signed out.",
};

const WARNINGS: Record<string, string> = {
  restricted: "This account can't be used right now. Contact support if you think this is a mistake.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.3 6.6 2.3 12s4.3 9.8 9.7 9.8c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

function PasswordForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action] = useFormState<AuthFormState, FormData>(passwordSignInAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <Field label="Email or username">
        <Input name="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <Field
        label="Password"
        labelAside={
          <Link href="/auth/forgot" className="text-xs text-muted hover:text-fg">
            Forgot password?
          </Link>
        }
      >
        <PasswordInput name="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton fullWidth>Sign in</SubmitButton>
    </form>
  );
}

function EmailLinkForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const result = await signIn("email", { email, callbackUrl, redirect: false });
    setStatus(result?.error ? "error" : "sent");
  }

  if (status === "sent") {
    return (
      <Alert tone="success" title="Check your inbox">
        If that address can sign in, a link is on its way. It expires in 30 minutes.
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Email" hint="We'll email you a one-time sign-in link. New here? This creates your account.">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>
      {status === "error" ? (
        <Alert tone="danger">We couldn&apos;t send a link right now. Try again in a few minutes.</Alert>
      ) : null}
      <Button type="submit" fullWidth loading={status === "sending"} leftIcon={<Mail />}>
        Email me a link
      </Button>
    </form>
  );
}

export function SignInForm({ callbackUrl, providers, notice }: Props) {
  const noticeText = notice ? NOTICES[notice] : null;
  const warningText = notice ? WARNINGS[notice] : null;

  return (
    <div className="space-y-5">
      {noticeText ? <Alert tone="success">{noticeText}</Alert> : null}
      {warningText ? <Alert tone="warning">{warningText}</Alert> : null}

      {providers.google ? (
        <>
          <Button
            variant="secondary"
            fullWidth
            leftIcon={<GoogleIcon />}
            onClick={() => signIn("google", { callbackUrl })}
          >
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}

      {providers.email ? (
        <Tabs defaultValue="password">
          <TabsList aria-label="Sign-in method">
            <TabsTrigger value="password">
              <KeyRound className="h-4 w-4" aria-hidden /> Password
            </TabsTrigger>
            <TabsTrigger value="email">
              <Mail className="h-4 w-4" aria-hidden /> Email link
            </TabsTrigger>
          </TabsList>
          <TabsContent value="password">
            <PasswordForm callbackUrl={callbackUrl} />
          </TabsContent>
          <TabsContent value="email">
            <EmailLinkForm callbackUrl={callbackUrl} />
          </TabsContent>
        </Tabs>
      ) : (
        <PasswordForm callbackUrl={callbackUrl} />
      )}
    </div>
  );
}
