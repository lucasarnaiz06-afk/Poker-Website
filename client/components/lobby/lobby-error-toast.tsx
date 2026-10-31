"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

/** Shows `?error=` (set by our own redirects, e.g. a table that couldn't open) once as a toast, then drops it from the URL. */
export function LobbyErrorToast({ message }: { message: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!message || shown.current === message) return;
    shown.current = message;
    toast({ title: message, tone: "error" });
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("error");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [message, pathname, router, searchParams]);

  return null;
}
