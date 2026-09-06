import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { Providers } from "./providers";
import "./globals.css";

/**
 * The submission is announced with a link, so the unfurled card is the first thing most people
 * will see of this project. `metadataBase` has to be absolute for that card to resolve — set
 * NEXT_PUBLIC_SITE_URL on the deployment; the fallback only keeps local builds quiet.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Stub — confidential prize savings",
    template: "%s · Stub",
  },
  description:
    "Deposit, keep your principal, and the pooled yield is drawn as a prize. Everyone can check the draw; only you can read your stub.",
  applicationName: "Stub",
  openGraph: {
    type: "website",
    siteName: "Stub",
    title: "Everyone gets a stub. Only you can open yours.",
    description:
      "Confidential prize savings on Zama's fhEVM. The draw is public and recomputable by anyone; the result is readable by one person.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Everyone gets a stub. Only you can open yours.",
    description:
      "Confidential prize savings on Zama's fhEVM. The draw is public and recomputable by anyone; the result is readable by one person.",
  },
};

export const viewport: Viewport = {
  themeColor: "#07070b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
