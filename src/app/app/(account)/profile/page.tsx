import Link from "next/link";
import { Metric } from "@/components/ui/metric";
import { EmptyState } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { buttonClasses } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getGithubIdentity } from "@/modules/github/identity";

export const metadata = { title: "Profile" };

/**
 * Profile (CORE-6).
 *
 * ## Why it is short, and why that is the honest length
 *
 * This product stores two things about a person: the address they signed up
 * with, and the GitHub identity they connected. There is no profile table, no
 * display name, no avatar, no preference of any kind. A longer page would have
 * to be padded with controls that change nothing.
 *
 * So it shows those two, says plainly where the name in the rail comes from,
 * and offers the one action that exists — connecting GitHub, for an account
 * that has not.
 *
 * ## What it deliberately does not offer
 *
 * A name field. Adding one is a real decision with real consequences — a new
 * column or `user_metadata`, a place it is validated, a place it is displayed
 * instead of the GitHub login — and it belongs in a change that intends it,
 * not smuggled in as page filler.
 */
export default async function ProfilePage() {
  const session = await requireSession("/app/profile");
  const supabase = await createClient();

  const github = await getGithubIdentity(supabase, session.userId);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title="Profile"
        description="What Vibe knows about you — which is deliberately very little."
      />

      <Surface level="panel" padding="lg" className="flex flex-col gap-5">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Metric label="Email" value={session.email} />
          <Metric label="GitHub" value={github?.githubLogin} mono />
        </dl>

        <p className="text-fg-muted border-line-1 max-w-[62ch] border-t pt-4 text-sm">
          {github
            ? "Your GitHub login is the name Vibe shows you by. Nothing else about you is stored — no display name, no picture of our own."
            : "Vibe has your email address and nothing else. Connecting GitHub gives it a name to show you by, and is how a repository gets analysed."}
        </p>
      </Surface>

      {!github && (
        <EmptyState
          title="No GitHub account connected"
          description="Connecting GitHub is how Vibe reads a repository, prepares a change, and knows what to call you."
          action={
            <Link
              href="/app/connect/github"
              className={buttonClasses({ variant: "primary", size: "sm" })}
            >
              Connect GitHub
            </Link>
          }
        />
      )}
    </div>
  );
}
