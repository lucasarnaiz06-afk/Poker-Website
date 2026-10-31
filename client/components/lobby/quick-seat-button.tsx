"use client";

import { Zap } from "lucide-react";
import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { quickSeatAction, type QuickSeatState } from "@/app/lobby/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

function Submit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" leftIcon={<Zap aria-hidden />} loading={pending} className="w-full sm:w-auto">
      Play now
    </Button>
  );
}

/** One click to a seat: the server picks a table, the table opens its buy-in dialog. */
export function QuickSeatButton() {
  const [state, action] = useFormState<QuickSeatState, FormData>(quickSeatAction, { error: null });

  useEffect(() => {
    if (state.error) toast({ title: "No seat found", description: state.error, tone: "warning" });
  }, [state]);

  return (
    // Phones: first and full width (the page's primary action); desktop: rightmost.
    <form
      action={action}
      title="Finds a public table with a free seat at your usual stakes"
      className="order-first w-full sm:order-none sm:w-auto"
    >
      <Submit />
    </form>
  );
}
