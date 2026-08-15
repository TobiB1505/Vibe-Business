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
 * The nav carries the sign-in route only. Marketing pages beyond the landing
 * page — pricing, legal, the trust page — exist in the mockups but not in the
 * application, and this shell does not link to routes that would 404.
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
              className="text-fg-secondary hover:text-fg-body rounded-sm px-2 text-sm transition-colors duration-150"
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
        <div className="text-fg-meta mx-auto flex w-full max-w-[80rem] flex-wrap items-center gap-4 px-5 py-8 text-xs sm:px-10">
          <span className="font-mono">Vibe Business</span>
          <span className="ml-auto">The business layer for AI-built products.</span>
        </div>
      </footer>
    </div>
  );
}
