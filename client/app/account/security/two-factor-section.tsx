"use client";

import { Copy, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { Alert, Badge, Button, Field, Input, toast } from "@/components/ui";
import { FormMessage, SubmitButton } from "../../auth/_components/form-bits";
import { PasswordInput } from "../../auth/_components/password-input";
import {
  beginTotpSetupAction,
  confirmTotpAction,
  disableTotpAction,
  regenerateRecoveryCodesAction,
  type AccountFormState,
  type RecoveryCodesState,
} from "../actions";

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <Alert tone="warning" title="Save your recovery codes">
        Each code signs you in once if you lose your device. They won&apos;t be shown again.
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2 p-3 font-mono text-sm tabular">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<Copy />}
        onClick={() => {
          void navigator.clipboard?.writeText(codes.join("\n")).then(() => toast({ title: "Copied", tone: "success" }));
        }}
      >
        Copy codes
      </Button>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            onDone();
            router.refresh();
          }}
        >
          I saved them
        </Button>
      </div>
    </div>
  );
}

function CodeAndPasswordFields({ hasPassword }: { hasPassword: boolean }) {
  return (
    <>
      {hasPassword ? (
        <Field label="Password">
          <PasswordInput name="password" autoComplete="current-password" required />
        </Field>
      ) : null}
      <Field label="Authentication or recovery code">
        <Input name="code" autoComplete="one-time-code" autoCapitalize="none" required />
      </Field>
    </>
  );
}

function EnabledView({ hasPassword, unusedCodes }: { hasPassword: boolean; unusedCodes: number }) {
  const [disableState, disable] = useFormState<AccountFormState, FormData>(disableTotpAction, null);
  const [codesState, regenerate] = useFormState<RecoveryCodesState, FormData>(regenerateRecoveryCodesAction, null);
  const [mode, setMode] = useState<"idle" | "disable" | "regenerate">("idle");
  const [dismissed, setDismissed] = useState<string[] | null>(null);

  if (codesState?.recoveryCodes && codesState.recoveryCodes !== dismissed) {
    return (
      <RecoveryCodes
        codes={codesState.recoveryCodes}
        onDone={() => {
          setDismissed(codesState.recoveryCodes ?? null);
          setMode("idle");
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="accent" icon={<ShieldCheck />}>On</Badge>
        Codes are required when you sign in with your password. {unusedCodes} recovery codes left.
      </div>
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setMode("regenerate")}>
            New recovery codes
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode("disable")}>
            Turn off
          </Button>
        </div>
      ) : (
        <form action={mode === "disable" ? disable : regenerate} className="space-y-4" noValidate>
          <CodeAndPasswordFields hasPassword={hasPassword} />
          <FormMessage state={mode === "disable" ? disableState : codesState} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
            <SubmitButton variant={mode === "disable" ? "danger" : "secondary"}>
              {mode === "disable" ? "Turn off 2FA" : "Generate new codes"}
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

function SetupView() {
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [state, confirm] = useFormState<RecoveryCodesState, FormData>(confirmTotpAction, null);

  if (state?.recoveryCodes) {
    // onDone: the parent re-renders as "enabled" after router.refresh().
    return <RecoveryCodes codes={state.recoveryCodes} onDone={() => undefined} />;
  }

  if (!setup) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Add a second step to password sign-in with an authenticator app (1Password, Google Authenticator, Authy...).
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button
          variant="secondary"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await beginTotpSetupAction();
              if (result.ok) {
                setSetup({ secret: result.secret, qrSvg: result.qrSvg });
              } else {
                setError(result.error);
              }
            })
          }
        >
          Set up two-factor
        </Button>
      </div>
    );
  }

  return (
    <form action={confirm} className="space-y-4" noValidate>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* QR SVG is generated server-side by the qrcode library from our own otpauth URI. */}
        <div
          className="h-40 w-40 shrink-0 rounded-lg bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
          aria-label="QR code for your authenticator app"
          role="img"
          dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
        />
        <div className="min-w-0 space-y-2 text-sm text-muted">
          <p>Scan the QR code with your authenticator app, or enter this key manually:</p>
          <code className="block break-all rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[13px] text-fg">
            {setup.secret.match(/.{1,4}/g)?.join(" ")}
          </code>
        </div>
      </div>
      <Field label="6-digit code from the app">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required className="tabular tracking-widest" />
      </Field>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton>Turn on</SubmitButton>
      </div>
    </form>
  );
}

export function TwoFactorSection({
  enabled,
  hasPassword,
  unusedCodes,
}: {
  enabled: boolean;
  hasPassword: boolean;
  unusedCodes: number;
}) {
  return enabled ? <EnabledView hasPassword={hasPassword} unusedCodes={unusedCodes} /> : <SetupView />;
}
