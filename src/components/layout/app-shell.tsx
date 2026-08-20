import Link from "next/link";
import type { ReactNode } from "react";
import { TextAction } from "@/components/ui/button";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { cn } from "@/lib/utils/cn";
import { signOut } from "@/modules/auth/actions";

/**
 * The signed-in application shell (UI-0).
 *
 * A sticky, blurred top bar over the app frame, then the content well. This is
 * the chrome for account-level screens — the project list, the connect flow —
 * as opposed to `ProjectShell`, which adds a project's own sidebar.
 *
 * ## The Credit balance
 *
 * The slot the mockups reserved, filled now that there is something real to
 * read (BILLING CORE-2 §54). It stayed empty through Core-1 on purpose — the
 * ledger existed but no customer balance did, and a number here would have
 * been invented.
 *
 * Restrained by design: a plain number and a word, linking to billing. Credits
 * are how the product is paid for, not what the product is about, so this does
 * not get a pill, a colour, an icon or a progress bar (§54).
 *
 * Rendered only when the caller passes a balance. The shell does not fetch it
 * — a component that queried on every signed-in page render would put a
 * database round trip behind every navigation (§100), so the pages that want
 * it read it and pass it down.
 */
export function AppShell({
  children,
  /** The signed-in address, shown so it is obvious which account is acting. */
  email,
  /**
   * Available Credits, already formatted for display (e.g. `"2,480"`).
   *
   * Omitted rather than zeroed when unknown: "we did not look" and "you have
   * none" are different facts, and only one of them should be shown as a
   * balance.
   */
  credits,
  /** Full-bleed content, e.g. a shell that supplies its own inner layout. */
  bleed = false,
}: {
  children: ReactNode;
  email?: string | null;
  credits?: string | null;
  bleed?: boolean;
}) {
  return (
    <div className="bg-app text-fg-body flex min-h-dvh flex-col">
      <header className="border-line-1 bg-app/70 sticky top-0 z-30 border-b backdrop-blur-xl">
        <div className="flex items-center gap-4 px-5 py-4 sm:px-8">
          {/* The ring used to be switched off here with nothing put in its
              place, so the first Tab stop on every signed-in page was
              invisible. The global `:focus-visible` rule is the right one; it
              only needed the rounding to follow. */}
          <Link
            href="/app"
            className="rounded-nav"
            aria-label="Vibe Business — your projects"
          >
            <VibeLockup />
          </Link>

          <div className="ml-auto flex items-center gap-4">
            {credits != null && (
              <Link
                href="/app/billing"
                className="text-fg-body hover:text-fg rounded-nav text-[0.8125rem] tabular-nums transition-interactive"
              >
                <span className="font-semibold">{credits}</span>{" "}
                <span className="text-fg-meta">Credits</span>
              </Link>
            )}
            {email && (
              <span className="text-fg-meta hidden text-[0.8125rem] sm:inline" title={email}>
                {email}
              </span>
            )}
            <form action={signOut}>
              <TextAction type="submit" className="text-[0.8125rem]">
                Sign out
              </TextAction>
            </form>
          </div>
        </div>
      </header>

      <main
        className={cn(
          "flex-1",
          bleed ? "" : "mx-auto w-full max-w-[70rem] px-5 py-10 sm:px-8 sm:py-12",
        )}
      >
        {children}
      </main>
    </div>
  );
}
