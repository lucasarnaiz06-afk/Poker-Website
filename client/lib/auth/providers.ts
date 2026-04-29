import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions } from "next-auth";

type EmailServerConfig = {
  host: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
};

export type EnabledAuthProviders = {
  email: boolean;
  google: boolean;
};

function readOptionalPort(rawPort?: string) {
  if (!rawPort) {
    return undefined;
  }

  const port = Number(rawPort);

  return Number.isInteger(port) && port > 0 ? port : undefined;
}

function decodeCredential(rawCredential: string) {
  try {
    return decodeURIComponent(rawCredential);
  } catch {
    return rawCredential;
  }
}

function createStructuredEmailServerConfig(): EmailServerConfig | null {
  if (!process.env.EMAIL_SERVER_HOST) {
    return null;
  }

  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;

  return {
    host: process.env.EMAIL_SERVER_HOST,
    port: readOptionalPort(process.env.EMAIL_SERVER_PORT),
    secure: process.env.EMAIL_SERVER_SECURE === "true",
    auth: user && pass ? { user, pass } : undefined,
  };
}

function createLenientEmailServerConfig(
  rawServer: string,
): string | EmailServerConfig {
  let standardUrl: URL;

  try {
    standardUrl = new URL(rawServer);
  } catch {
    return rawServer;
  }

  const atSignCount = (rawServer.match(/@/g) ?? []).length;

  if (standardUrl.password || atSignCount <= 1) {
    return rawServer;
  }

  const serverMatch = rawServer.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);

  if (!serverMatch) {
    return rawServer;
  }

  const [, protocol, rest] = serverMatch;
  const authSeparatorIndex = rest.lastIndexOf("@");

  if (authSeparatorIndex < 0) {
    return rawServer;
  }

  const authPart = rest.slice(0, authSeparatorIndex);
  const hostPart = rest.slice(authSeparatorIndex + 1);
  const passwordSeparatorIndex = authPart.indexOf(":");

  if (passwordSeparatorIndex < 0) {
    return rawServer;
  }

  const hostUrl = new URL(`${protocol}://${hostPart}`);
  const user = decodeCredential(authPart.slice(0, passwordSeparatorIndex));
  const pass = decodeCredential(authPart.slice(passwordSeparatorIndex + 1));

  return {
    host: hostUrl.hostname,
    port: readOptionalPort(hostUrl.port),
    secure: protocol.toLowerCase() === "smtps",
    auth: { user, pass },
  };
}

function createEmailServerConfig() {
  const structuredServer = createStructuredEmailServerConfig();

  if (structuredServer) {
    return structuredServer;
  }

  if (!process.env.EMAIL_SERVER) {
    return undefined;
  }

  return createLenientEmailServerConfig(process.env.EMAIL_SERVER);
}

export function getEnabledAuthProviders(): EnabledAuthProviders {
  return {
    email: Boolean(
      process.env.EMAIL_FROM &&
        (process.env.EMAIL_SERVER || process.env.EMAIL_SERVER_HOST),
    ),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}

export function createAuthProviders(): NextAuthOptions["providers"] {
  const enabledProviders = getEnabledAuthProviders();
  const providers: NextAuthOptions["providers"] = [];

  if (enabledProviders.email) {
    providers.push(
      EmailProvider({
        server: createEmailServerConfig(),
        from: process.env.EMAIL_FROM,
      }),
    );
  }

  if (enabledProviders.google) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      }),
    );
  }

  return providers;
}
