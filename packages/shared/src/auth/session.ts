import { prisma } from "../db/prisma";
import { getSessionTokenFromCookieHeader } from "./cookies";

export type AuthenticatedUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

export type AuthenticatedSession = {
  sessionToken: string;
  expires: Date;
  user: AuthenticatedUser;
};

export async function getAuthenticatedSessionFromToken(
  sessionToken?: string | null,
): Promise<AuthenticatedSession | null> {
  if (!sessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken },
    include: { user: true },
  });

  if (!session || session.expires <= new Date()) {
    return null;
  }

  return {
    sessionToken: session.sessionToken,
    expires: session.expires,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    },
  };
}

export async function getAuthenticatedSessionFromCookieHeader(
  cookieHeader?: string | null,
): Promise<AuthenticatedSession | null> {
  const sessionToken = getSessionTokenFromCookieHeader(cookieHeader);

  return getAuthenticatedSessionFromToken(sessionToken);
}
