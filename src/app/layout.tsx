import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import { isMetaPixelEnabled } from "@/lib/analytics/meta-pixel";
import { getAppUrl } from "@/lib/env/app-url";
import { fontVariables } from "./fonts";
import "./globals.css";

/**
 * The technical typeface is declared in `./fonts.ts` and exposed to the
 * design tokens as `--font-mono`. The product UI uses the native interface
 * stack declared as `--font-sans` in globals.css.
 *
 * The bundled face is self-hosted, so a build needs no network access and a
 * page makes no third-party font request.
 * Components must reach them through `font-sans` / `font-mono`; a
 * `font-family` declaration anywhere else in the codebase is a bug.
 */
export const metadata: Metadata = {
  // Resolves any relative URL a page's own metadata provides (Open Graph
  // images, alternates, ...) against this deployment's own origin, so a
  // Preview build never resolves one against Production's domain. No page
  // currently sets a relative metadata URL — this establishes the base
  // before one needs it, rather than after a wrong resolution ships.
  metadataBase: new URL(getAppUrl()),
  title: "Vibe Business",
  description: "The business layer for AI-built products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${fontVariables}`}>
      <body className="bg-app text-fg-body h-full font-sans">
        {children}
        <Analytics />
        <SpeedInsights />
        {/*
          Advertising attribution, and the only third-party tag here that is
          conditional. It is evaluated on the server, so a deployment that is
          not Production ships no Meta script at all rather than shipping one
          that decides at runtime not to fire. The component itself excludes
          the authenticated surface — see src/lib/analytics/meta-pixel.ts.
        */}
        {isMetaPixelEnabled() && <MetaPixel />}
      </body>
    </html>
  );
}
