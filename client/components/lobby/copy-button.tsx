"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** Copies `text` (absolute URL when it starts with "/") and confirms with a toast. */
export function CopyButton({
  text,
  label = "Copy link",
  copiedLabel = "Copied",
  ...props
}: Omit<ButtonProps, "onClick" | "children"> & { text: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const value = text.startsWith("/") ? `${window.location.origin}${text}` : text;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: "Invite link copied", tone: "success", duration: 2500 });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: value, tone: "error" });
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      onClick={() => void copy()}
      {...props}
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}
