"use client";

import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Input,
  toast,
} from "@/components/ui";
import { FormMessage, SubmitButton } from "../../auth/_components/form-bits";
import { coolOffAction, selfExcludeAction, updateLimitsAction, type AccountFormState } from "../actions";

export function LimitsForm({
  dailyLossLimit,
  sessionReminderMinutes,
}: {
  dailyLossLimit: number | null;
  sessionReminderMinutes: number | null;
}) {
  const [state, action] = useFormState<AccountFormState, FormData>(updateLimitsAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="Daily loss limit"
        optional
        hint="Max net chips you can lose per day (00:00 UTC). Lowering applies now; raising or clearing waits 24 hours."
        error={state?.fieldErrors?.dailyLossLimit}
      >
        <Input name="dailyLossLimit" inputMode="numeric" defaultValue={dailyLossLimit ?? ""} placeholder="No limit" trailing="chips" />
      </Field>
      <Field
        label="Session reminder"
        optional
        hint="We'll remind you how long you've been playing (10-1440 minutes)."
        error={state?.fieldErrors?.sessionReminderMinutes}
      >
        <Input name="sessionReminderMinutes" inputMode="numeric" defaultValue={sessionReminderMinutes ?? ""} placeholder="Off" trailing="min" />
      </Field>
      <FormMessage state={state?.fieldErrors ? { error: state.error } : state} />
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Save limits</SubmitButton>
      </div>
    </form>
  );
}

type Choice<T extends string> = { value: T; label: string };

function ConfirmChoice<T extends string>({
  title,
  description,
  choices,
  run,
  variant,
}: {
  title: string;
  description: string;
  choices: Choice<T>[];
  run: (value: T) => Promise<{ ok: boolean; message: string }>;
  variant: "secondary" | "danger";
}) {
  const [selected, setSelected] = useState<Choice<T> | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <DialogTrigger key={choice.value} asChild>
            <Button variant={variant === "danger" ? "outline" : "secondary"} onClick={() => setSelected(choice)}>
              {choice.label}
            </Button>
          </DialogTrigger>
        ))}
      </div>
      <DialogContent
        title={`${title}: ${selected?.label ?? ""}`}
        description={description}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                selected &&
                startTransition(async () => {
                  const result = await run(selected.value);
                  toast({ title: result.message, tone: result.ok ? "success" : "error" });
                  setSelected(null);
                })
              }
            >
              Confirm
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

export function CoolOffButtons() {
  return (
    <ConfirmChoice
      title="Take a break"
      description="You won't be able to sit at tables or claim bonuses until it ends. It can't be cancelled early."
      choices={[
        { value: "24h", label: "24 hours" },
        { value: "7d", label: "7 days" },
      ]}
      run={coolOffAction}
      variant="secondary"
    />
  );
}

export function SelfExclusionButtons() {
  return (
    <ConfirmChoice
      title="Self-exclude"
      description="You'll be blocked from all play for the whole period. It can't be shortened or undone."
      choices={[
        { value: "30d", label: "30 days" },
        { value: "90d", label: "90 days" },
        { value: "permanent", label: "Permanently" },
      ]}
      run={selfExcludeAction}
      variant="danger"
    />
  );
}
