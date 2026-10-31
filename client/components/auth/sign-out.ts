"use client";

import { signOut } from "next-auth/react";

/**
 * Signs out and goes to `path` on the current origin. NextAuth's own redirect resolves callbackUrl against
 * NEXTAUTH_URL, which in development may be a tunnel that is offline; a relative navigation always works.
 */
export async function signOutTo(path = "/") {
  try {
    await signOut({ redirect: false });
  } finally {
    window.location.assign(path.startsWith("/") && !path.startsWith("//") ? path : "/");
  }
}
