import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { CodeIcon, LockIcon } from "@/components/ui/dashboard-icons";
import { StatusPill } from "@/components/ui/status-pill";
import { SettingsColumn } from "@/components/layout/settings-column";
import { Surface } from "@/components/ui/surface";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import { buildAccountIdentity } from "@/modules/auth/identity-view";
import type { GithubIdentity } from "@/modules/github/types";
import { FounderNameForm } from "./founder-name-form";

/**
 * Profile (CORE-6).
 *
 * ## Why it is short, and why that is still the honest length
 *
 * This product stores two things about a person: the address they signed up
 * with, and the GitHub identity they connected. There is no profile table, no
 * display name, no avatar of Vibe's own, no preference of any kind. A longer
 * page would have to be padded with controls that change nothing.
 *
 * That argument has not moved, and this rebuild does not add a field. What it
 * changes is that the page was *plain* rather than short — two label/value
 * pairs in a box and a grey sentence — and `DESIGN.md` names the profile page
 * specifically: quiet governs choreography, never craft, and a page that is
 * merely inoffensive has failed it.
 *
 * So the same two facts are composed instead of listed. The person is shown as
 * a person, the GitHub connection is shown as a connection with a state, and
 * the page's most distinctive claim — how little is kept — is stated as the
 * third object rather than buried as a footnote under the second.
 *
 * ## The name and the picture come from `buildAccountIdentity`
 *
 * The same resolver the rail uses, rather than a second one here: GitHub login,
 * else the whole email address, else "Your account" — and a session's email is
 * nullable, so that third case is reachable and this page must not crash on it.
 * Two derivations of "what to call this person" on one screen is exactly how a
 * founder ends up being called two things by one product.
 *
 * Vibe stores no picture. The URL is derived from the numeric id already on the
 * connection row, `Avatar` falls back to initials when the image fails, and the
 * "what Vibe does not keep" panel says where the picture comes from — so a
 * founder is never left thinking Vibe holds one.
 *
 * ## The name field, and why it is here now
 *
 * This docblock used to refuse one: "adding one is a real decision with real
 * consequences — a new column, a place it is validated, a place it is
 * displayed instead of the GitHub login — and it belongs in a change that
 * intends it, not smuggled in as page filler." That was right, and this is
 * that change. Nova is the reason a name is worth having: an assistant that
 * writes to a founder needs to know what to call them, and asking is the only
 * way to know without guessing.
 *
 * All three consequences are paid rather than skipped — `founder_profiles`
 * with its own ownership policy, `normalizeFounderName` plus a database CHECK,
 * and `buildAccountIdentity` preferring the chosen name over the GitHub login
 * everywhere at once.
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

      {/*
        The person, once, at the top. The email was a `label: value` pair
        beside the GitHub login, which gave the address a founder types once
        the same weight as the identity every other surface calls them by.
      */}
      <Surface level="card" padding="lg" className="flex flex-wrap items-center gap-5">
        <Avatar
          src={identity.avatarUrl}
          initials={identity.initials}
          label={identity.displayName}
          size={72}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-fg text-title font-bold tracking-[-0.025em]">
            {identity.displayName}
          </p>
          {/*
            Only when it is not already the name above. An address printed
            twice, once as a heading and once as its own caption, reads as two
            facts about a person Vibe has one fact about.
          */}
          {email && email !== identity.displayName && (
            <p className="text-fg-muted truncate text-body">{email}</p>
          )}
        </div>
      </Surface>

      {/*
        Directly under the person, because it is the one thing on this page
        that changes what the product calls them. Below the connections it
        would read as a setting; here it reads as the answer to the heading
        above it.
      */}
      <section aria-labelledby="name-heading" className="flex flex-col gap-3">
        <MonoLabel as="h2" id="name-heading">
          Your name
        </MonoLabel>
        <Surface level="card" padding="lg">
          <FounderNameForm current={identity.chosen ? identity.displayName : null} />
        </Surface>
      </section>

      <section aria-labelledby="connections-heading" className="flex flex-col gap-3">
        <MonoLabel as="h2" id="connections-heading">
          Connections
        </MonoLabel>

        {/*
          One row, with its state as a word. GitHub is the only connection this
          product has, and a "connections" section holding one row is honest in
          a way a grid of greyed-out placeholders would not be.
        */}
        <Surface
          level="panel"
          padding="md"
          className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4"
        >
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden
              className="bg-surface-hover text-fg-secondary flex size-10 shrink-0 items-center justify-center rounded-nav"
            >
              <CodeIcon size={20} />
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
              <span className="text-fg-muted max-w-[54ch] text-body leading-relaxed">
                {github ? (
                  <>
                    Signed in as <span className="text-fg-body font-mono">{github.githubLogin}</span>
                    . How Vibe reads a repository and prepares a change.
                  </>
                ) : (
                  "How Vibe reads a repository, prepares a change, and knows what to call you."
                )}
              </span>
            </div>
          </div>

          {!github && (
            <Link
              href="/app/connect/github"
              className={buttonClasses({ variant: "primary" })}
            >
              Connect GitHub
            </Link>
          )}
        </Surface>
      </section>

      {/*
        The page's actual claim, given an object of its own. It was the last
        sentence of the panel above, set in the muted ramp — the one thing here
        a founder might not expect, formatted as a footnote.
      */}
      <Surface
        level="section"
        padding="lg"
        className="flex flex-col gap-4"
        aria-labelledby="not-stored-heading"
        as="section"
      >
        <div className="flex items-center gap-2">
          <LockIcon size={16} className="text-fg-meta" />
          <MonoLabel as="h2" id="not-stored-heading">
            What Vibe does not keep
          </MonoLabel>
        </div>
        <ul className="flex flex-col gap-2">
          {notStored(identity.avatarUrl !== null, identity.chosen).map((line) => (
            <li key={line} className="text-fg-prose flex items-start gap-3 text-body leading-relaxed">
              <span aria-hidden className="bg-fg-faint mt-2 size-1 shrink-0 rounded-full" />
              {line}
            </li>
          ))}
        </ul>
      </Surface>
    </SettingsColumn>
  );
}
