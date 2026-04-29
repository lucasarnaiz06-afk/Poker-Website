import Link from "next/link";

type AuthErrorPageProps = {
  searchParams?: {
    error?: string | string[];
  };
};

function getErrorMessage(error?: string | string[]) {
  const errorCode = Array.isArray(error) ? error[0] : error;

  if (errorCode === "AccessDenied") {
    return "That account is not allowed for this workspace.";
  }

  if (errorCode === "Verification") {
    return "The sign-in link is invalid or has expired.";
  }

  return "Authentication could not be completed.";
}

export default function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-panel">
        <h1 className="text-2xl font-semibold text-zinc-950">Sign-in blocked</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          {getErrorMessage(searchParams?.error)}
        </p>
        <Link
          href="/auth/signin"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
