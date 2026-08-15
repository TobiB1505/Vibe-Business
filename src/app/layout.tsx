import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

/**
 * The two product typefaces, loaded once here and exposed to the design
 * tokens as CSS variables (`--font-sans` / `--font-mono` in globals.css).
 *
 * `next/font` self-hosts the files at build time, so there is no Google Fonts
 * request at runtime and no third-party origin in the page. Components must
 * reach these through `font-sans` / `font-mono`; a `font-family` declaration
 * anywhere else in the codebase is a bug.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vibe Business",
  description: "The business layer for AI-built products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}
    >
      <body className="bg-app text-fg-body h-full font-sans">{children}</body>
    </html>
  );
}
