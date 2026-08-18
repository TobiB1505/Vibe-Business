"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

import { VibeLockup } from "@/components/brand/vibe-mark";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The error boundary for every signed-in page.
 *
 * ## What it replaces
 *
 * A black screen reading *"Application error: a client-side exception has
 * occurred (see the browser console for more information)."* — no header, no
 * navigation, no retry, no way back. That is Next.js's own last-resort screen
 * from `global-error.tsx`, and until this file existed it was the *only*
 * boundary in the router: one failed Supabase read anywhere under `/app` took
 * the whole page down to that sentence.
 *
 * It was not hypothetical. Six separate incidents in seven days reached it —
 * three missing-table errors while a migration was mid-deploy, two RLS
 * refusals, and one `JWT issued at future`, a clock skew between Supabase Auth
 * and PostgREST that appeared one second after a login and had cleared two
 * seconds later. Every one of them was transient or narrow. All six looked
 * identical to a founder: the product was gone.
 *
 * ## What it deliberately does not do
 *
 * **It reads nothing.** No session, no Credits, no project list, not even the
 * header's balance. This screen renders precisely when reading data is what
 * failed, so a boundary that needed a query to draw itself would be a boundary
 * that fails to draw. That is why it does not reuse `AppShell`.
 *
 * **It does not diagnose.** We know something threw; we do not know whether it
 * was momentary. So the copy says a retry is worth trying and stops short of
 * promising it will work — the alternative is a product that tells people
 * "temporary" about an outage.
 *
 * **It does not show the error.** A raw PostgREST message is not a sentence
 * anyone outside this codebase should read, and it can carry column and table
 * names. The digest is shown instead: it is the one string that ties this
 * screen to the exact server log line, which is what a support conversation
 * actually needs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next.js catches boundary errors before the global handlers observe them,
    // so a boundary that does not report is a boundary that hides.
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="bg-app text-fg-body flex min-h-dvh flex-col">
      <header className="border-line-1 border-b px-5 py-4 sm:px-8">
        {/* Not a link to `/app`: that is the route that just failed, and a
            header that navigates straight back into it invites a loop. */}
        <VibeLockup />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-5 py-16 sm:px-8">
        <Surface level="card" padding="lg" className="flex w-full flex-col gap-5">
          <div className="flex flex-col gap-3">
            <MonoLabel>Something went wrong</MonoLabel>
            <h1 className="text-fg text-title max-w-[28ch] font-bold text-balance">
              Vibe couldn&rsquo;t load this page.
            </h1>
            <p className="text-fg-prose max-w-[60ch] text-sm leading-relaxed">
              Your work is safe — nothing was changed by this. Some of these failures clear on
              their own within a few seconds, so trying again is usually worth it.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={reset} className={buttonClasses()}>
              Try again
            </button>
            <Link href="/app" className={buttonClasses({ variant: "secondary" })}>
              Back to your projects
            </Link>
          </div>

          {error.digest && (
            <p className="text-fg-meta text-xs">
              If it keeps happening, this reference identifies what failed:{" "}
              <span className="font-mono">{error.digest}</span>
            </p>
          )}
        </Surface>
      </main>
    </div>
  );
}
