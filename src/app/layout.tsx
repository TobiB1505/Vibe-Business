import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vibe Business",
  description: "The business layer for AI-built products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-zinc-950 text-zinc-50">{children}</body>
    </html>
  );
}
