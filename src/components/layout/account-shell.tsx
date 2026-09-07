import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { ArrowLeftIcon, type DashboardIconName } from "@/components/ui/dashboard-icons";
import { Wallet } from "@/components/system/wallet";
import type { CreditUnits } from "@/modules/credits/units";
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
 * The same brand, navigation rhythm and account disclosure as `ProjectShell`.
 * The account surface keeps its established document-scroll behavior while the
 * project surface owns an independent workspace scroller; entering a product
 * should still read as one object changing context, not as arriving in a
 * different application.
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
  /** The URL segment under `/app/settings`. Empty for the index itself. */
  segment: string;
};

/**
 * The Settings rail, in navigation order.
 *
 * ## Why this is Settings and not an account dashboard
 *
 * Because `/app` stopped being a screen. A founder lands in a product, and
 * everything that used to be account-level chrome — the product list, the
 * connected repositories, billing, the profile — is what you go *to Settings*
 * for. Four top-level rows for four settings pages made the account look like
 * a second application; it is one area with a rail, the way the rest of this
 * category does it.
 *
 * ## Why General is a row and also the parent
 *
 * `/app/settings` is the section a person lands on when they click Settings
 * from anywhere, so it has to be a page rather than a redirect. Listing it in
 * the rail is what makes it reachable again once they have moved off it.
 *
 * A row appears here only once its route exists. Nothing is listed "coming
 * soon" as a link — an item that 404s is worse than an item that is absent,
 * and `SOON_SECTIONS` below is how a planned area says so honestly.
 */
export const ACCOUNT_SECTIONS = [
  { id: "general", label: "General", icon: "settings", segment: "" },
  { id: "products", label: "Products", icon: "products", segment: "products" },
  {
    id: "repositories",
    label: "Repositories",
    icon: "repositories",
    segment: "repositories",
  },
  { id: "billing", label: "Billing", icon: "billing", segment: "billing" },
  { id: "profile", label: "Profile", icon: "profile", segment: "profile" },
] as const satisfies readonly AccountSection[];

/**
 * Named, visible, and not a link.
 *
 * A real product intention with nothing behind it yet is more honest as a
 * disabled label than as either a hidden feature or a page that apologises for
 * itself — as long as it is still true that there is nothing behind it.
 *
 * `Team` is the case that stays: ownership is single-user in every table
 * (`projects.user_id`, RLS on `auth.uid()`, one GitHub identity per user), and
 * `billing/catalog.ts` says in its own words "No Enterprise, no Team, no
 * annual, no seats". There is no sharing primitive to expose, so the label is
 * the whole of what is true.
 */
export const SOON_SECTIONS = [{ id: "team", label: "Team", icon: "team" }] as const;

export function accountSectionHref(sectionId: string): string {
  const section = ACCOUNT_SECTIONS.find((candidate) => candidate.id === sectionId);
  return section && section.segment ? `/app/settings/${section.segment}` : "/app/settings";
}

export function AccountSidebar({
  /**
   * Available Credits, in units.
   *
   * Units rather than a formatted string, because the rail draws the coin —
   * and `CreditAmount` is what owns the coin's optical centring against the
   * digits. Handing it a pre-formatted string would mean formatting here and
   * mis-centring there.
   *
   * Omitted rather than zeroed when unknown: "we did not look" and "you have
   * none" are different facts, and only one of them is a balance.
   */
  credits,
  footer,
}: {
  credits: CreditUnits | null;
  /** The account menu. Passed in so the shell stays a server component. */
  footer: ReactNode;
}) {
  return (
    <nav
      aria-label="Settings"
      className={cn(
        "vibe-chrome border-line-1 bg-surface-1 flex shrink-0 flex-col gap-7 border-b p-4",
        // Desktop: a full-height rail that stays put while content scrolls.
        // Below `lg` it becomes a strip at the top, for the same reason
        // `ProjectSidebar` does — a 248px rail on a 375px screen eats the page.
        // One rhythm with the column beside it. `--shell-top` is the same
        // variable `main` reads, so the rail cannot drift from the content
        // again — which it did, twice.
        "lg:sticky lg:top-0 lg:h-dvh lg:w-[17.5rem] lg:overflow-y-auto lg:border-r lg:border-b-0",
        "lg:px-6 lg:pt-[var(--shell-top)] lg:pb-7",
      )}
    >
      {/*
        Centred inside a box the height of the page heading's first line, so
        the lockup and "Welcome back." read as level. Top-aligning their boxes
        does not do that: a 15px lockup sits near the top of its short line box
        and a 34px heading sits far down its tall one. The height is computed
        from the type scale (`--shell-heading-line`), never nudged.
      */}
      <div className="flex items-center px-1 lg:min-h-[var(--shell-heading-line)]">
        {/* The way back into the product. `/app` resolves to whichever one
            the founder was last in, so this is "leave Settings" rather than a
            trip through an index. */}
        <Link href="/app" className="rounded-nav" aria-label="Vibe Business — back to your product">
          <VibeLockup />
        </Link>
      </div>

      {/*
        The way back, said out loud.
        Entering Settings swaps the whole rail, so the founder's own product
        disappears from the screen — and the only route back was the lockup,
        which is a logo and reads as "home page", not as "leave this area".
        This is the mirror of the project rail's `All products`, and it points
        at `/app`, which resolves to the product they were last in rather than
        to an index they have to pick from again.
      */}
      <div className="flex flex-col gap-4">
        <Link
          href="/app"
          className={cn(
            "text-fg-secondary hover:bg-surface-2 hover:text-fg-body rounded-nav",
            "flex items-center gap-2.5 px-3 py-2.5 text-body transition-interactive",
            "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          <ArrowLeftIcon size={17} className="shrink-0" />
          Back to your product
        </Link>

        <div className="border-line-1 border-t" />

        <AccountNav items={[...ACCOUNT_SECTIONS]} soon={[...SOON_SECTIONS]} />
      </div>

      {/* Pinned to the bottom of the rail on desktop; inline on the strip. */}
      <div className="flex flex-col gap-3 lg:mt-auto">
        {/*
          On the phone strip too. The rail's old credits link was `hidden
          lg:flex`, so on a phone the account shell showed no balance at all —
          on screens that offer priced actions. A price without a balance is
          half a disclosure, and that argument does not stop at 1024px.
        */}
        <Wallet credits={credits} href="/app/settings/billing" />
        {footer}
      </div>
    </nav>
  );
}

/** Rail + content column. */
export function AccountShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="text-fg-body flex min-h-dvh flex-col lg:flex-row">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Wider than `AppShell`'s 70rem and with more air above it. The rail
          already takes 248px, and this screen's job is to be calm rather than
          to fit more in.
        */}
        <main className="mx-auto w-full max-w-[78rem] px-5 py-[var(--shell-top)] sm:px-8 xl:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
