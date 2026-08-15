import Link from "next/link";
import type { ReactNode } from "react";
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
 * ## What is deliberately not here
 *
 * The mockups put a credits balance in this bar. There is no Vibe Credit
 * ledger in the system yet (ARCHITECTURE.md §3.11 — the internal provider-cost
 * half exists, the customer-facing balance does not), so there is nothing to
 * read and a number here would be invented. The slot is not stubbed, not
 * greyed out, and not filled with a zero; it simply does not exist until the
 * ledger does.
 */
export function AppShell({
  children,
  /** The signed-in address, shown so it is obvious which account is acting. */
  email,
  /** Full-bleed content, e.g. a shell that supplies its own inner layout. */
  bleed = false,
}: {
  children: ReactNode;
  email?: string | null;
  bleed?: boolean;
}) {
  return (
    <div className="bg-app text-fg-body flex min-h-dvh flex-col">
      <header className="border-line-1 bg-app/70 sticky top-0 z-30 border-b backdrop-blur-xl">
        <div className="flex items-center gap-4 px-5 py-4 sm:px-8">
          <Link
            href="/app"
            className="rounded-nav focus-visible:outline-none"
            aria-label="Vibe Business — your projects"
          >
            <VibeLockup />
          </Link>

          <div className="ml-auto flex items-center gap-4">
            {email && (
              <span className="text-fg-meta hidden text-[0.8125rem] sm:inline" title={email}>
                {email}
              </span>
            )}
            <form action={signOut}>
              <button
                type="submit"
                className="text-fg-muted hover:text-fg-body rounded-sm text-[0.8125rem] underline underline-offset-4 transition-colors duration-150"
              >
                Sign out
              </button>
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
