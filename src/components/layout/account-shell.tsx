import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon, type DashboardIconName } from "@/components/ui/dashboard-icons";
import { AccountNav } from "./account-nav";
import { RailNav, RailScroll } from "./app-frame";
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
 * ## One sidebar, not two
 *
 * This used to be a second rail: a whole `<aside>` of its own, 280px wide,
 * mounted by the `(account)` layout while the project's 256px one was
 * unmounted. Entering Settings therefore rebuilt every pixel of the chrome and
 * changed its width, which a founder reads as the page reloading — because at
 * the level of what is on screen, it was.
 *
 * There is one `<aside>` now and it is rendered by `AppFrame`, from the layout
 * both areas share. What this file contributes is the navigation that goes
 * inside it. See `app-frame.tsx` for why that is the shape.
 *
 * Deliberately without a rail at all: `onboarding/` and `connect/github/`,
 * which use `OnboardingShell`. A focused setup flow with a navigation rail
 * beside it is an invitation to abandon the flow.
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

/**
 * Where the rail goes back to when Settings is closed.
 *
 * A product, by name, rather than `/app` — which is a redirect, and a redirect
 * is a round trip a founder experiences as the whole page reloading. The slot
 * resolves the founder's last product and hands it here; when there is nothing
 * to resolve (a first session, a cleared cookie) the generic destination is
 * still correct and still a link.
 */
export type SettingsRailBack = { href: string; label: string };

/**
 * The navigation the rail holds while a founder is in Settings.
 *
 * The middle of the rail and nothing else. The `<aside>` around it belongs to
 * `AppFrame` and is the same object the product's own navigation was sitting
 * in a moment ago; the lockup above and the identity below are the same DOM
 * nodes too. This is the fold, not a second rail.
 */
export function SettingsRail({ back }: { back: SettingsRailBack }) {
  return (
    <RailNav direction="forward" label="Settings">
      {/*
          The way back, said out loud and pointing at something specific.

          Opening Settings replaces the product's navigation, so the founder's
          own product leaves the screen — and a logo is not a way out of an
          area, it is a way to a home page. This is the mirror of the project
          rail's `Settings` row, and it names the product it returns to.
        */}
      <Link
        href={back.href}
        /* The one link that swaps the whole rail back. An unwarmed swap is the
           difference between a fold and a wait. */
        prefetch
        className={cn(
          "text-fg-secondary hover:bg-surface-2 hover:text-fg-body rounded-nav",
          "flex items-center gap-2.5 px-3 py-2.5 text-body transition-interactive",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <ArrowLeftIcon size={17} className="shrink-0" />
        <span className="truncate">{back.label}</span>
      </Link>

      <div className="border-line-1 my-2 border-t" />

      <RailScroll>
        <AccountNav items={[...ACCOUNT_SECTIONS]} soon={[...SOON_SECTIONS]} />
      </RailScroll>
    </RailNav>
  );
}

/**
 * The Settings column. The rail beside it belongs to `AppFrame`.
 *
 * Wider than `AppShell`'s 70rem and with more air above it: the rail already
 * takes 256px, and this screen's job is to be calm rather than to fit more in.
 * `--shell-top` is the same padding the workspace column and the rail use, so
 * nothing shifts vertically when the fold happens.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[78rem] min-w-0 flex-1 px-5 py-[var(--shell-top)] sm:px-8 xl:px-10">
      {children}
    </main>
  );
}
