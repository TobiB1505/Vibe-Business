import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { TextAction } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { signOut } from "@/modules/auth/actions";
import { ACCOUNT_SECTIONS } from "./account-sections";
import { NavList } from "./nav-list";

/**
 * The signed-in application shell (UI-8).
 *
 * ## What it replaces
 *
 * `AppShell`: a sticky top bar with the lockup on the left and Credits, the
 * email and Sign out on the right. It said who you were and nothing about
 * where you were. Standing on `/app/billing` there was no indication that the
 * dashboard existed, that Credits was one of several places, or how to get
 * back other than by clicking the logo — while the project workspace next door
 * had had a full rail since UI-2.
 *
 * So this is the account level catching up with the project level: the same
 * frame, the same rail, the same `NavList`. Two halves of one product rather
 * than two products.
 *
 * ## What it deliberately does not have
 *
 * **A project list in the rail.** The obvious move — projects as sidebar
 * switchers — needs the project list on every screen the shell renders,
 * including `loading.tsx` and `not-found.tsx`, which have no session to read
 * it with. The alternatives were a query per screen (the N+1 that
 * `dashboard-contract.test.ts` exists to prevent) or a rail whose contents
 * change from page to page, which is worse than no rail. Projects live on the
 * dashboard, as cards.
 *
 * **Any read of its own.** The shell fetches nothing — not the session, not
 * the balance. Pages that have those values pass them down; `getHeaderCredit-
 * Balance` renders on every signed-in navigation and a component that queried
 * for itself would put a round trip behind each one (BILLING CORE-2 §100).
 */


/**
 * The Credit balance, restrained by design (BILLING CORE-2 §54).
 *
 * A plain number and a word, linking to billing. Credits are how the product is
 * paid for, not what the product is about, so this gets no pill, no colour, no
 * icon and no progress bar.
 *
 * Rendered only when the caller passes a balance: "we did not look" and "you
 * have none" are different facts, and only one of them is a zero.
 */
function CreditBalance({ credits }: { credits: string }) {
  return (
    <Link
      href="/app/billing"
      className="text-fg-body hover:text-fg rounded-nav text-ui tabular-nums transition-interactive"
    >
      <span className="font-semibold">{credits}</span> <span className="text-fg-meta">Credits</span>
    </Link>
  );
}

function SignOutButton() {
  return (
    <form action={signOut}>
      <TextAction type="submit" className="text-ui">
        Sign out
      </TextAction>
    </form>
  );
}

/**
 * The rail, and below `lg` the bar.
 *
 * Same two-mode behaviour as `ProjectSidebar`: a full-height sticky column on
 * desktop, a horizontal strip at the top on a phone, because a 240px rail on a
 * 375px screen would eat the content.
 *
 * The account controls move with it. On the rail they sit at the bottom, under
 * `mt-auto`; on the bar they sit inline beside the lockup, where the strip
 * below them is only a row tall. Both are rendered and one is always
 * `display: none`, so exactly one Sign out exists in the accessibility tree at
 * any width.
 */
function AccountSidebar({ email, credits }: { email?: string | null; credits?: string | null }) {
  return (
    <nav
      aria-label="Account sections"
      className={cn(
        "border-line-1 bg-surface-1 flex shrink-0 flex-col gap-4 border-b p-4",
        "lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:gap-7 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-5",
      )}
    >
      <div className="flex items-center gap-4 px-1">
        {/* The ring used to be switched off here with nothing put in its
            place, so the first Tab stop on every signed-in page was invisible.
            The global `:focus-visible` rule is the right one; it only needed
            the rounding to follow. */}
        <Link href="/app" className="rounded-nav" aria-label="Vibe Business — your projects">
          <VibeLockup />
        </Link>

        <div className="ml-auto flex items-center gap-4 lg:hidden">
          {credits != null && <CreditBalance credits={credits} />}
          <SignOutButton />
        </div>
      </div>

      <NavList items={ACCOUNT_SECTIONS} />

      <div className="mt-auto hidden flex-col items-start gap-3 px-1 pt-4 lg:flex">
        {credits != null && <CreditBalance credits={credits} />}
        {email && (
          // Truncated rather than wrapped: a long address must not push the
          // account controls off a 240px rail.
          <span className="text-fg-meta w-full truncate text-ui" title={email}>
            {email}
          </span>
        )}
        <SignOutButton />
      </div>
    </nav>
  );
}

export function AccountShell({
  children,
  /** The signed-in address, shown so it is obvious which account is acting. */
  email,
  /**
   * Available Credits, already formatted for display (e.g. `"2,480"`).
   *
   * Omitted rather than zeroed when unknown.
   */
  credits,
}: {
  children: ReactNode;
  email?: string | null;
  credits?: string | null;
}) {
  return (
    <div className="bg-app text-fg-body flex min-h-dvh flex-col lg:flex-row">
      <AccountSidebar email={email} credits={credits} />
      <main className="mx-auto w-full min-w-0 max-w-[70rem] flex-1 px-5 py-10 sm:px-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}
