import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fontVariables } from "./fonts";
import "./globals.css";

/**
 * The two product typefaces are declared in `./fonts.ts` and exposed to the
 * design tokens as CSS variables (`--font-sans` / `--font-mono` in
 * globals.css).
 *
 * They are self-hosted from files in this repository, so a build needs no
 * network access for them and a page makes no third-party font request.
 * Components must reach them through `font-sans` / `font-mono`; a
 * `font-family` declaration anywhere else in the codebase is a bug.
 */

/**
 * The canonical origin every page's `alternates.canonical` resolves against.
 *
 * Kept identical to the origin hardcoded in `robots.ts` and `sitemap.ts` —
 * all three describe the same deployed site and must not drift apart.
 */
const ORIGIN = "https://vibe-business-fawn.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: "Vibe Business",
  description: "The business layer for AI-built products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${fontVariables}`}>
      <body className="bg-app text-fg-body h-full font-sans">{children}</body>
    </html>
  );
}
