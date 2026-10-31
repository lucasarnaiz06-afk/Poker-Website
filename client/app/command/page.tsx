import { Shield, Skull, Telescope } from "lucide-react";
import { CommandCenterDashboard } from "@/components/command/command-center-dashboard";
import {
  hasCommandCenterSession,
  isCommandCenterEnabled,
} from "@/lib/command-center-auth";

export const dynamic = "force-dynamic";

type CommandCenterPageProps = {
  searchParams?: {
    error?: string | string[];
    game?: string | string[];
  };
};

function readSingleValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function getErrorMessage(value?: string | string[]) {
  const error = readSingleValue(value);

  if (error === "invalid_password") {
    return "Incorrect password.";
  }

  if (error === "disabled") {
    return "Command center is not configured.";
  }

  if (error === "rate_limited") {
    return "Too many failed attempts. Try again later.";
  }

  return null;
}

export default function CommandCenterPage({
  searchParams,
}: CommandCenterPageProps) {
  const isEnabled = isCommandCenterEnabled();
  const isAuthorized = hasCommandCenterSession();
  const selectedGameId = readSingleValue(searchParams?.game) ?? null;
  const errorMessage = getErrorMessage(searchParams?.error);

  if (!isEnabled) {
    return (
      <main className="min-h-screen bg-[#0b1020] px-4 py-6 text-[#f8f8f2]">
        <div className="mx-auto max-w-4xl border-4 border-[#f8f8f2] bg-[#111827] p-6">
          <div className="flex items-center gap-3 text-[#ffd166]">
            <Skull className="h-6 w-6" aria-hidden="true" />
            <h1 className="text-lg font-semibold">Command Center Disabled</h1>
          </div>
          <p className="mt-4 text-sm leading-6 text-[#d1d5db]">
            Add `COMMAND_CENTER_PASSWORD` to `.env`, then restart the client
            and server dev processes to enable the live testing console.
          </p>
        </div>
      </main>
    );
  }

  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-[#0b1020] px-4 py-6 text-[#f8f8f2]">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_420px]">
          <section className="flex flex-col justify-center gap-5 border-4 border-[#f8f8f2] bg-[#111827] p-6">
            <div className="inline-flex w-fit items-center gap-2 border-2 border-[#a3e635] bg-[#173f1f] px-3 py-2 text-[10px] text-[#a3e635]">
              <Telescope className="h-4 w-4" aria-hidden="true" />
              Testing Surface
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[#f8f8f2] md:text-3xl">
                Command Center
              </h1>
            </div>
          </section>

          <section className="border-4 border-[#f8f8f2] bg-[#f8f8f2] p-6 text-[#0b1020]">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Enter Password</h2>
            </div>
            <form action="/command/login" method="post" className="mt-6 space-y-4">
              <label className="block text-sm font-medium" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="h-12 w-full border-4 border-[#0b1020] bg-white px-3 text-sm outline-none"
              />
              {errorMessage ? (
                <div className="border-2 border-[#ff3864] bg-[#451a1a] px-3 py-2 text-[10px] text-[#ffd6e8]">
                  {errorMessage}
                </div>
              ) : null}
              <button
                type="submit"
                className="inline-flex h-12 w-full items-center justify-center border-4 border-[#0b1020] bg-[#111827] px-4 text-sm font-semibold text-[#f8f8f2]"
              >
                Open Command Center
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  return <CommandCenterDashboard initialGameId={selectedGameId} />;
}
