import { redirect } from "next/navigation";

/** Alias used by the app shell's "Sign up" button. */
export default function SignUpAlias() {
  redirect("/auth/register");
}
