import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { getShellViewer } from "@/components/shell/get-shell-viewer";
import { themeInitScript } from "@/components/ui/theme";
import { getCurrentSession } from "@/lib/auth/session";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Felt — play-money poker with friends", template: "%s · Felt" },
  description: "Live Texas Hold'em tables with bomb pots, nit games and 7-2 bounties. Play-money chips only.",
};

export const viewport: Viewport = {
  themeColor: "#0a0c10",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentSession();
  const viewer = await getShellViewer(session);

  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers session={session}>
          <AppShell viewer={viewer}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
