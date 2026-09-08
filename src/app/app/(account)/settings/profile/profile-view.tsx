import Link from "next/link";
import { GithubMark } from "@/components/brand/provider-marks";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { LockIcon } from "@/components/ui/dashboard-icons";
import { StatusPill } from "@/components/ui/status-pill";
import { SettingsColumn } from "@/components/layout/settings-column";
import { Surface } from "@/components/ui/surface";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import { buildAccountIdentity } from "@/modules/auth/identity-view";
import type { GithubIdentity } from "@/modules/github/types";
import { FounderNameForm } from "./founder-name-form";

/**
 * Profile (CORE-6, redrawn UI-32).
 *
 * ## Why it is short, and why that is still the honest length
 *
 * This product stores two things about a person: the address they signed up
 * with, and the GitHub identity they connected — plus, since Nova had to know
 * what to call somebody, the name they chose to be called. There is no title,
 * no company, no bio, no avatar of Vibe's own, no preference of any kind. A
 * longer page would have to be padded with controls that change nothing.
 *
 * ## Why it is one card and not four objects
 *
 * The rebuild before this one composed the facts instead of listing them, and
 * that was right. What it produced was four *different kinds* of object for
 * those facts — a 138px card holding a name, a 248px card holding one input, a
 * 153px panel holding one row and a 183px section holding three bullets, on a
 * page 1001px tall. Nothing was wrong with any one of them; together they said
 * the page had four subjects when it has one.
 *
 * So there is one surface at level 3, and everything inside it is a row
 * divided by a hairline: the person, the name, the connection, and what Vibe
 * does not keep. Nothing is nested, and a founder reads down a single object
 * rather than across four.
 *
 * ## One primary, and it is the connection
 *
 * `Save` on the name and `Connect GitHub` were both `variant="primary"`, so
 * the page spent its emphasis twice — and the field that decides what Nova
 * calls you outranked the connection the whole product runs on. Save is
 * secondary now (`founder-name-form.tsx` carries that argument); connecting is
 * the one mint control here, and only in the state that offers it.
 *
 * ## The name and the picture come from `buildAccountIdentity`
 *
 * The same resolver the rail uses, rather than a second one here: the chosen
 * name, else the GitHub login, else the whole email address, else "Your
 * account" — and a session's email is nullable, so that last case is reachable
 * and this page must not crash on it. Two derivations of "what to call this
 * person" on one screen is exactly how a founder ends up being called two
 * things by one product.
 *
 * Vibe stores no picture. The URL is derived from the numeric id already on
 * the connection row, `Avatar` falls back to initials when the image fails,
 * and the footer says where the picture comes from — so a founder is never
 * left thinking Vibe holds one.
 */

/**
 * Everything Vibe has no row for. Each line is a claim, so each is checked —
 * including against the state of the very page it is printed on.
 *
 * The picture line was fixed text saying "the one above is served by GitHub",
 * which is true with a connection and false without one: that state renders
 * initials, and there is no picture above at all. A panel whose subject is
 * what Vibe does *not* hold is the last place that may describe something that
 * is not on screen.
 */
function notStored(hasGithubAvatar: boolean, hasChosenName: boolean): string[] {
  return [
    hasChosenName
      ? "Nothing about you beyond the name you gave — no title, no company, no bio"
      : "No name yet — Vibe calls you by your GitHub login, or by your email address",
    hasGithubAvatar
      ? "No picture of Vibe's own — the one above is served by GitHub"
      : "No picture of any kind — the circle above is your initials, drawn from the name beside it",
    "No preferences, no settings, no analytics profile",
  ];
}

/** One row of the card. The hairline belongs to the row, not to what it holds. */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="border-line-2 border-t px-6 py-5 max-sm:px-4">{children}</div>;
}

export function ProfileView({
  email,
  github,
  founderName,
}: {
  email: string | null;
  github: GithubIdentity | null;
  /** What the founder asked to be called, when they have said. */
  founderName?: string | null;
}) {
  const identity = buildAccountIdentity({ email, github, founderName });

  return (
    <SettingsColumn className="gap-8">
      <SectionHeader
        level={1}
        title="Profile"
        description="What Vibe knows about you — which is deliberately very little."
      />

      <Surface level="card" padding="none" className="overflow-hidden">
        {/*
          The person, as the card's own header rather than a card of their
          own. The email was a `label: value` pair beside the GitHub login,
          which gave the address a founder types once the same weight as the
          identity every other surface calls them by.
        */}
        <div className="flex flex-wrap items-center gap-4 px-6 py-5 max-sm:px-4">
          <Avatar
            src={identity.avatarUrl}
            initials={identity.initials}
            label={identity.displayName}
            size={52}
          />
          <div className="flex min-w-0 flex-col">
            <p className="text-fg text-title font-bold tracking-[-0.025em]">
              {identity.displayName}
            </p>
            {/*
              Only when it is not already the name above. An address printed
              twice, once as a heading and once as its own caption, reads as
              two facts about a person Vibe has one fact about.
            */}
            {email && email !== identity.displayName && (
              <p className="text-fg-muted truncate text-body">{email}</p>
            )}
          </div>
        </div>

        {/*
          Directly under the person, because it is the one thing on this page
          that changes what the product calls them. Below the connection it
          would read as a setting; here it reads as the answer to the line
          above it.
        */}
        <Row>
          <FounderNameForm current={identity.chosen ? identity.displayName : null} />
        </Row>

        {/*
          One row, with its state as a word. GitHub is the only connection
          this product has, and a "connections" section holding one row is
          honest in a way a grid of greyed-out placeholders would not be.

          The mark is GitHub's own, the same one the repositories page draws.
          A generic `</>` glyph for the single named provider on the page was
          a drawing standing in for a logo the product is allowed to show.
        */}
        <Row>
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4">
            {/*
              Aligned to the first line rather than centred. The sentence
              underneath runs to two lines at some widths and one at others, so
              a centred mark sits at a different height on the same row
              depending on the viewport.
            */}
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <span
                aria-hidden
                className="bg-surface-3 text-fg-secondary flex size-10 shrink-0 items-center justify-center rounded-nav"
              >
                <GithubMark size={20} />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-fg text-ui font-semibold">GitHub</span>
                  {github ? (
                    <StatusPill tone="success">Connected</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Not connected</StatusPill>
                  )}
                </span>
                {/*
                  `text-balance` so the two lines are even. Without it the
                  sentence broke after "a", leaving "change." alone on a line
                  under a control that is otherwise two tidy rows.
                */}
                <span className="text-fg-muted max-w-[58ch] text-balance text-caption leading-relaxed">
                  {github ? (
                    <>
                      Signed in as{" "}
                      <span className="text-fg-body font-mono">{github.githubLogin}</span>. How Vibe
                      reads a repository and prepares a change.
                    </>
                  ) : (
                    "How Vibe reads a repository, prepares a change, and knows what to call you."
                  )}
                </span>
              </div>
            </div>

            {!github && (
              <Link href="/app/connect/github" className={buttonClasses({ variant: "primary" })}>
                Connect GitHub
              </Link>
            )}
          </div>
        </Row>

        {/*
          The page's actual claim, as the card's footer.

          It was the last sentence of the connections panel, set in the muted
          ramp — the one thing here a founder might not expect, formatted as a
          footnote. It is the card's closing statement now, on the quieter
          fill, and the marker beside each line is a hairline rather than the
          hand-drawn dot nothing else in the product draws.
        */}
        <section
          aria-labelledby="not-stored-heading"
          className="border-line-2 bg-surface-2 flex flex-col gap-3 border-t px-6 py-5 max-sm:px-4"
        >
          <div className="text-fg-meta flex items-center gap-2">
            <LockIcon size={14} />
            <MonoLabel as="h2" id="not-stored-heading">
              What Vibe does not keep
            </MonoLabel>
          </div>
          <ul className="flex flex-col gap-2">
            {notStored(identity.avatarUrl !== null, identity.chosen).map((line) => (
              <li
                key={line}
                className="border-line-3 text-fg-prose max-w-[70ch] border-l pl-3 text-caption leading-relaxed"
              >
                {line}
              </li>
            ))}
          </ul>
        </section>
      </Surface>
    </SettingsColumn>
  );
}
