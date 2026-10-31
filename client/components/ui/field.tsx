"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "./cn";

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Inputs inside a <Field> pick up id, aria-describedby and aria-invalid automatically. */
export function useFieldControl(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
}) {
  const field = useContext(FieldContext);
  const describedBy = [props["aria-describedby"], field?.describedBy].filter(Boolean).join(" ") || undefined;
  const invalid = props["aria-invalid"] === true || props["aria-invalid"] === "true" || field?.invalid === true;

  return {
    id: props.id ?? field?.id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
  };
}

export function Label({
  htmlFor,
  children,
  className,
  optional,
}: {
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("text-[13px] font-medium text-fg", className)}>
      {children}
      {optional ? <span className="ml-1 font-normal text-subtle">(optional)</span> : null}
    </label>
  );
}

export type FieldProps = {
  label?: ReactNode;
  /** Extra element shown at the right of the label row (e.g. an InfoTip). */
  labelAside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, labelAside, hint, error, optional, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        {label || labelAside ? (
          <div className="flex min-h-5 items-center justify-between gap-2">
            {label ? (
              <Label htmlFor={controlId} optional={optional}>
                {label}
              </Label>
            ) : (
              <span />
            )}
            {labelAside}
          </div>
        ) : null}
        {children}
        {hint && !error ? (
          <p id={hintId} className="text-xs leading-5 text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-xs leading-5 text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {hint && error ? (
          <p id={hintId} className="sr-only">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
