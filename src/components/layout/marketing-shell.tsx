import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { buttonClasses } from "@/components/ui/button";

/**
 * The public marketing shell (UI-0).
 *
 * Sticky blurred nav, an ambient mint wash and a faint grid behind the content,
 * a quiet footer. The wash and grid are decorative and `aria-hidden`; the grid
 * is drawn with a gradient rather than an asset so it costs no request.
 *
 * The nav carries the two ways in. The footer carries the legal surfaces, which
 * exist as real routes as of UI-S1 — a product that asks for access to
 * someone's repository has to say what it does with it somewhere reachable.
 * Nothing here links to a route that does not exist; pricing and the trust page
 * are still mockup-only and still absent.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-app text-fg-body relative isolate min-h-dvh overflow-clip">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-64 left-1/2 -z-10 h-[56rem] w-[68rem] -translate-x-1/2 rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgb(0 229 160 / 0.16), rgb(0 229 160 / 0))",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / 0.018) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.018) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <header className="border-line-1 bg-app/60 sticky top-0 z-30 border-b backdrop-blur-xl">
        <nav className="mx-auto flex w-full max-w-[80rem] items-center gap-4 px-5 py-4 sm:px-10">
          <Link href="/" className="rounded-nav" aria-label="Vibe Business — home">
            <VibeLockup size={22} />
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <Link
              href="/login"
              className="text-fg-secondary hover:text-fg-body rounded-sm px-2 text-sm transition-interactive"
            >
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses({ size: "sm" })}>
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[80rem] px-5 sm:px-10">{children}</main>

      <footer className="border-line-1 mt-20 border-t">
        {/*
          One row of links, one line of identity, in that order at every width.
          The tagline had an `ml-auto` variant for phones, which on a 390px
          screen pushed itself between "Vibe Business" and "Privacy" and left
          the links wrapping around it.
        */}
        <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 px-5 py-8 sm:px-10">
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
            <span className="text-fg-muted font-mono">Vibe Business</span>
            {[
              ["Privacy", "/privacy"],
              ["Terms", "/terms"],
              ["Sign in", "/login"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="text-fg-muted hover:text-fg-body rounded-sm transition-interactive"
              >
                {label}
              </Link>
            ))}
          </nav>
          <p className="text-fg-muted text-xs">The business layer for AI-built products.</p>
        </div>
      </footer>
    </div>
  );
}
