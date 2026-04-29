import { resolvePublicAllowedEmailDomains } from "@poker-platform/shared/auth";
import { redirect } from "next/navigation";
import { SignInPanel } from "@/components/auth/sign-in-panel";
import { getCurrentSession } from "@/lib/auth/session";
import { getEnabledAuthProviders } from "@/lib/auth/providers";

type SignInPageProps = {
  searchParams?: {
    callbackUrl?: string | string[];
  };
};

function normalizeCallbackUrl(value?: string | string[]) {
  const callbackUrl = Array.isArray(value) ? value[0] : value;

  if (callbackUrl?.startsWith("/")) {
    return callbackUrl;
  }

  return "/lobby";
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const callbackUrl = normalizeCallbackUrl(searchParams?.callbackUrl);
  const session = await getCurrentSession();

  if (session) {
    redirect(callbackUrl);
  }

  return (
    <SignInPanel
      allowedDomains={resolvePublicAllowedEmailDomains()}
      callbackUrl={callbackUrl}
      providers={getEnabledAuthProviders()}
    />
  );
}
