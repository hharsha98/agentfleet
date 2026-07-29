import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

import { Agentation } from "agentation";

import { CommandPalette } from "@/components/command-palette";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The one display face. Declaring it here only publishes --font-display as a
// CSS variable on <html>; nothing inherits it. It is opted into by exactly
// two landing-page callers via the `font-display` utility registered in
// globals.css (app/page.tsx's hero h1, components/landing/section-header.tsx's
// h2). The twelve dense in-app screens stay on Geist on purpose.
//
// `weight` is required rather than optional here: Instrument Serif is not a
// variable font and ships 400 only, which is why both callers set
// font-normal — asking for 500 would synthesise a fake bold.
const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

// metadataBase is what turns the file-convention images (app/icon.svg,
// app/apple-icon.png, app/opengraph-image.tsx) into absolute URLs — Open
// Graph consumers reject relative ones, so without it the OG card silently
// renders blank. Falls back to the port package.json's dev/start scripts pin.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

const DESCRIPTION =
  "Run a team of AI agents that research, build, and ship for you. Seventeen specialist agents, a mission board that turns goals into tasks, and the evals, guardrails and tracing to trust what they do — open source and self-hosted.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AgentFleet",
  description: DESCRIPTION,
  applicationName: "AgentFleet",
  openGraph: {
    type: "website",
    siteName: "AgentFleet",
    title: "AgentFleet — run a team of AI agents",
    description: DESCRIPTION,
    url: siteUrl,
    locale: "en_US",
    // No `images` key: app/opengraph-image.tsx is a file convention, so
    // Next injects og:image (plus type/width/height/alt) itself. Listing it
    // here as well would emit the tag twice.
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentFleet — run a team of AI agents",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <CommandPalette />
        {/* Dev-only visual feedback toolbar; never render in production.
            endpoint points at the local agentation-mcp server (registered
            separately, `claude mcp add agentation`) so annotations sync to
            Claude Code instead of just going to the clipboard. */}
        {process.env.NODE_ENV === "development" && (
          <Agentation endpoint="http://localhost:4747" />
        )}
      </body>
    </html>
  );
}
