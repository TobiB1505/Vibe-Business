import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import type { DashboardIconName } from "@/components/ui/dashboard-icons";
import { AccountNav } from "./account-nav";
import { cn } from "@/lib/utils/cn";

/**
 * The account shell (CORE-6).
 *
 * ## Why this exists, given `ProjectShell` already did
 *
 * Because until now it did not, and that absence is the whole defect. `/app`
 * had no chrome of its own: `src/app/app/layout.tsx` is an authorization gate
 * that renders nothing, and every account page supplied its own `AppShell` top
 * bar. So the only persistent navigation in the product lived *inside* a
 * project — a dashboard nested in a page that had never become one.
 *
 * ## One sidebar at a time
 *
 * This rail and `ProjectSidebar` are mutually exclusive by construction, not by
 * a conditional. The account pages live in the `(account)` route group and get
 * this layout; `projects/[projectId]` sits outside it and keeps its own. A
 * route group contributes no URL segment, so nothing about the addresses
 * changed to arrange that.
 *
 * Deliberately outside as well: `onboarding/` and `connect/github/`, which use
 * `OnboardingShell`. A focused setup flow with a navigation rail beside it is
 * an invitation to abandon the flow.
 *
 * ## Why it looks like `ProjectShell`
 *
 * Same sticky behaviour and the same collapse to a scrollable strip below
 * `lg`. The account rail is slightly wider because its account disclosure can
 * carry the full destination labels from the supplied dashboard reference. Entering a
 * product should still read as one object changing context, not as arriving in
 * a different application.
 *
 * ## No top bar
 *
 * `AppShell`'s bar carried the credits, the signed-in email and sign-out.
 * All three moved into the rail's footer. That is one row of chrome removed
 * from every account screen, and the density rule this sprint works under
 * spends the space on content instead.
 */

export type AccountSection = {
  id: string;
  label: string;
  icon: DashboardIconName;
  /** The URL segment under `/app`. Empty for Home, which is `/app` itself. */
  segment: string;
};

/**
 * The rail, in navigation order.
 *
 * A row appears here only once its route exists. Nothing is listed "coming
 * soon" as a link — an item that 404s is worse than an item that is absent,
 * and `SOON_SECTIONS` below is how a planned area says so honestly.
 */
export const ACCOUNT_SECTIONS = [
  { id: "home", label: "Home", icon: "home", segment: "" },
  { id: "products", label: "My Products", icon: "products", segment: "products" },
  {
    id: "repositories",
    label: "Repositories",
    icon: "repositories",
    segment: "repositories",
  },
] as const satisfies readonly AccountSection[];

/**
 * Named, visible, and not a link.
 *
 * Both are real product intentions with nothing behind them yet, and both are
 * more honest as a disabled label than as either a hidden feature or a page
 * that apologises for itself.
 *
 * `Team` in particular cannot be quietly shipped: ownership is single-user in
 * every table (`projects.user_id`, RLS on `auth.uid()`, one GitHub identity per
 * user), and `billing/catalog.ts` says in its own words "No Enterprise, no
 * Team, no annual, no seats". There is no sharing primitive to expose.
 */
export const SOON_SECTIONS = [
  { id: "experiments", label: "Experiments", icon: "experiments" },
  { id: "team", label: "Team", icon: "team" },
] as const;

export function accountSectionHref(sectionId: string): string {
  const section = ACCOUNT_SECTIONS.find((candidate) => candidate.id === sectionId);
  return section && section.segment ? `/app/${section.segment}` : "/app";
}

export function AccountSidebar({
  /**
   * Available Credits, already formatted (e.g. `"2,480"`).
   *
   * Omitted rather than zeroed when unknown: "we did not look" and "you have
   * none" are different facts, and only one of them is a balance.
   */
  credits,
  footer,
}: {
  credits: string | null;
  /** The account menu. Passed in so the shell stays a server component. */
  footer: ReactNode;
}) {
  return (
    <nav
      aria-label="Account"
      className={cn(
        "border-line-1 bg-surface-1 flex shrink-0 flex-col gap-7 border-b p-4",
        // Desktop: a full-height rail that stays put while content scrolls.
        // Below `lg` it becomes a strip at the top, for the same reason
        // `ProjectSidebar` does — a 248px rail on a 375px screen eats the page.
        "lg:sticky lg:top-0 lg:h-dvh lg:w-[17.5rem] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-6 lg:py-7",
      )}
    >
      <div className="px-1">
        <Link href="/app" className="rounded-nav" aria-label="Vibe Business — home">
          <VibeLockup />
        </Link>
      </div>

      <AccountNav items={[...ACCOUNT_SECTIONS]} soon={[...SOON_SECTIONS]} />

      {/* Pinned to the bottom of the rail on desktop; inline on the strip. */}
      <div className="flex flex-col gap-3 lg:mt-auto">
        {credits !== null && (
          <Link
            href="/app/billing"
            className={cn(
              "rounded-nav text-fg-muted hover:text-fg-body hover:bg-surface-2 hidden px-3 py-2.5",
              "items-baseline gap-1.5 text-sm transition-interactive lg:flex",
            )}
          >
            <span className="text-fg-body font-semibold tabular-nums">{credits}</span>
            <span>Credits</span>
          </Link>
        )}
        {footer}
      </div>
    </nav>
  );
}

/** Rail + content column. */
export function AccountShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-app text-fg-body flex min-h-dvh flex-col lg:flex-row">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Wider than `AppShell`'s 70rem and with more air above it. The rail
          already takes 248px, and this screen's job is to be calm rather than
          to fit more in.
        */}
        <main className="mx-auto w-full max-w-[78rem] px-5 py-9 sm:px-8 sm:py-11 xl:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
