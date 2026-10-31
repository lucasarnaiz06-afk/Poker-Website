import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      emailDomain?: string | null;
      /** Public handle; null until onboarding. */
      username?: string | null;
      /** Preset avatar id. */
      avatar?: string | null;
      role?: "USER" | "MOD" | "ADMIN";
    };
  }
}
