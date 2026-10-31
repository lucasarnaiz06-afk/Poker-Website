"use client";

import { LogOut, Monitor, Smartphone } from "lucide-react";
import { useTransition } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  toast,
} from "@/components/ui";
import { revokeSessionAction, signOutEverywhereAction } from "../actions";

export type SessionRow = {
  id: string;
  createdAt: string;
  expires: string;
  userAgent: string | null;
  current: boolean;
};

function describeAgent(userAgent: string | null) {
  if (!userAgent) {
    return { label: "Browser session", mobile: false };
  }

  const mobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
  const browser =
    /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os =
    /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) && !mobile ? "macOS" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Linux/.test(userAgent) ? "Linux" : "";

  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {sessions.map((session) => {
          const agent = describeAgent(session.userAgent);
          const Icon = agent.mobile ? Smartphone : Monitor;

          return (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3">
              <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                  {agent.label}
                  {session.current ? <Badge tone="accent">This device</Badge> : null}
                </p>
                <p className="text-xs text-muted">Signed in {new Date(session.createdAt).toLocaleString()}</p>
              </div>
              {!session.current ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await revokeSessionAction(session.id);
                      toast({ title: result.ok ? "Session signed out" : result.error ?? "Couldn't sign out", tone: result.ok ? "success" : "error" });
                    })
                  }
                >
                  Sign out
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" leftIcon={<LogOut />}>
            Sign out everywhere
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Sign out everywhere?"
          description="Every device, including this one, will need to sign in again."
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <form action={signOutEverywhereAction}>
                <Button type="submit" variant="danger">
                  Sign out everywhere
                </Button>
              </form>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
