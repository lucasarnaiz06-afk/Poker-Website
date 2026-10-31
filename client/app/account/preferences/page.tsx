import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const { account } = await requireUser({ callbackUrl: "/account/preferences" });
  return <PreferencesForm initial={account.preferences} />;
}
