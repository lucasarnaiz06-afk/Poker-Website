"use client";

import { useFormStatus } from "react-dom";
import { Alert, Button, type ButtonProps } from "@/components/ui";

/** Submit button that shows a spinner while its parent <form action> is pending. */
export function SubmitButton({ children, ...props }: Omit<ButtonProps, "type" | "loading">) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}

export function FormMessage({ state }: { state: { error?: string; message?: string } | null }) {
  if (state?.error) {
    return <Alert tone="danger">{state.error}</Alert>;
  }

  if (state?.message) {
    return <Alert tone="success">{state.message}</Alert>;
  }

  return null;
}
