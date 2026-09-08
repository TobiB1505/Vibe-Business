import Link from "next/link";
import { CookieSettings } from "@/components/consent/cookie-settings";
import { SettingsColumn } from "@/components/layout/settings-column";
import { buttonClasses } from "@/components/ui/button";
import { SignOutIcon } from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/modules/auth/actions";
import { requireSession } from "@/modules/auth/session";
import { getGithubIdentity } from "@/modules/github/identity";
import { findLatestErasure } from "@/modules/operations/account-erasure/service";
import { erasureViewState } from "@/modules/operations/account-erasure/view";
import { DeleteAccountSection } from "./delete-account";

export const metadata = { title: "General" };

/**
 * Settings → General (rebuilt UI-23).
 *
 * ## Why this stopped being a grid of three cards
 *
 * Because those three cards were navigation — Profile, GitHub access, Billing
 * — and two of them are rows in the rail beside this page now. A card that
 * duplicates the nav item next to it is not a shortcut; it is the same link
 * twice, and it made the landing page of Settings a menu to a menu.
 *
 * ## Why it is grouped now
 *
 * It was five panels of identical weight in one column: who you are, what
 * GitHub allows, signing out, deleting the account. Every one of those is a
 * different kind of thing, and drawing them the same way makes a reader read
 * all five to find the one they came for. Each group is labelled by what it is
 * about, which also gives the page somewhere to put cookies without it
 * becoming a sixth identical box.
 *
 * ## Why cookies live here
 *
 * Because it is the account-level page about this person rather than about a
 * product, and because withdrawal has to be as easy as consent — which means
 * a page somebody can find, not a link in a footer that reopens a banner. The
 * panel is the same component the banner opens; there is one category list in
 * this repository and both surfaces render it.
 *
 * ## Why sign out is here
 *
 * Because it was in the account menu, and the menu is gone — it held four
 * things and three of them are rows in the rail beside this page. Sign out was
 * the one with no other home. It sits above the delete section and looks
 * nothing like it: leaving is reversible, and a control that reads as
 * destructive when it is not is its own kind of lie.
 *
 * ## Why GitHub access is still here
 *
 * It is not a Vibe screen. It opens GitHub's own installations page, and a
 * rail row that leaves the product is a rail row that lies about where it
 * goes. Settings → Repositories manages what Vibe knows; this manages what
 * GitHub allows, and only GitHub can.
 */
export default async function SettingsPage() {
  const session = await requireSession("/app/settings");
  const supabase = await createClient();

  const [erasure, github] = await Promise.all([
    findLatestErasure(supabase, session.userId).then(erasureViewState),
    getGithubIdentity(supabase, session.userId),
  ]);

  return (
    <SettingsColumn className="gap-8">
      <SectionHeader
        level={1}
        title="General"
        description="Who this account is, what it shares, and the things only you can change."
      />

      <Group label="Account">
        <Surface level="panel" padding="md" className="flex flex-col gap-3">
          {/* A session always has one, but the type allows null; a blank line is
              a worse answer than saying which field is missing. */}
          <Fact term="Signed in as" value={session.email ?? "Not available"} />
          <Fact
            term="GitHub"
            value={github?.githubLogin ? `@${github.githubLogin}` : "Not connected"}
          />
        </Surface>
      </Group>

      {/*
        The privacy group leads with the one thing on this page that is a live
        decision rather than a fact or a destination.
      */}
      <Group
        label="Privacy"
        description="What is stored in this browser, and who else sees the pages you open. Necessary cookies keep you signed in; everything else is off until you switch it on."
      >
        <Surface level="panel" padding="md">
          <CookieSettings />
        </Surface>
      </Group>

      <Group label="Access">
        <Surface
          level="panel"
          padding="md"
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-fg text-ui font-semibold">GitHub access</h3>
            <p className="text-fg-muted max-w-[52ch] text-caption leading-relaxed">
              Which repositories and organisations Vibe can see. Only GitHub can change this, so
              this one leaves the product.
            </p>
          </div>
          <Link
            href="https://github.com/settings/installations"
            target="_blank"
            rel="noreferrer noopener"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Manage on GitHub
          </Link>
        </Surface>
      </Group>

      <Group label="This device">
        <Surface
          level="panel"
          padding="md"
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-fg text-ui font-semibold">Sign out</h3>
            <p className="text-fg-muted max-w-[52ch] text-caption leading-relaxed">
              Ends this session on this device. Nothing is deleted and you can sign back in.
            </p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className={cn(
                buttonClasses({ variant: "secondary", size: "sm" }),
                "vibe-control shrink-0",
              )}
            >
              <SignOutIcon size={16} />
              Sign out
            </button>
          </form>
        </Surface>
      </Group>

      {/*
        Last, and on its own. Everything above is a fact, a destination or a
        reversible action; this is the one control on the page that does
        something irreversible when pressed, and a row above it that looked the
        same would be a trap.
      */}
      <DeleteAccountSection state={erasure} />
    </SettingsColumn>
  );
}

/**
 * One labelled group.
 *
 * The label is a `MonoLabel`, which is how the rest of the product marks a
 * section that is a kind of thing rather than a thing. The heading level below
 * it stays `h3` under the page's `h1`… and there is no `h2` for the group
 * itself on purpose: a group of one panel does not need two headings, and the
 * label is not a destination.
 */
function Group({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <MonoLabel>{label}</MonoLabel>
        {description && (
          <p className="text-fg-muted max-w-[70ch] text-caption leading-relaxed">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A labelled fact.
 *
 * `Metric` was here and is built for a number with a unit; these are an email
 * address and a GitHub handle, which want to sit on one line beside their
 * label rather than under it in figure type.
 */
function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <span className="text-fg-muted text-caption">{term}</span>
      <span className="text-fg-body min-w-0 truncate text-body font-medium">{value}</span>
    </div>
  );
}
