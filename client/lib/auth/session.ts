import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./options";

export async function getCurrentSession() {
  return getServerSession(authOptions);
}

export async function requireCurrentSession() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/auth/signin?callbackUrl=/lobby");
  }

  return session;
}
