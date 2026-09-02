import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { listVerifiedInstallations } from "@/modules/github/connections";
import { hasCompletedAnyOnboarding } from "@/modules/onboarding/store";
import { OnboardingShell } from "../../../onboarding/onboarding-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Choose a GitHub account",
  description: "Pick the account whose repository Vibe should read.",
};

/**
 * Shown only when a user has more than one verified installation — for
 * example a personal account plus one or more organizations. Vibe
 * Business never picks one on the user's behalf.
 *
 * With zero or one installation there is nothing to choose, so the
 * request goes back through the connect route, which resolves the right
 * destination.
 */
export default async function ChooseGithubAccountPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const installations = await listVerifiedInstallations(supabase, session.userId);

  if (installations.length <= 1) {
    redirect("/app/connect/github");
  }

  /*
   * Whether leaving leads anywhere (UI-S1 §16).
   *
   * This screen wears the onboarding shell, and the shell only draws an exit
   * when one exists. A founder with finished projects connecting a second
   * GitHub account is not onboarding — they took a detour, and until now the
   * detour had no way back.
   */
  const canLeave = await hasCompletedAnyOnboarding(supabase, session.userId);

  return (
    <OnboardingShell email={session.email} state="connect_source" canLeave={canLeave}>
      <section className="flex max-w-[48rem] flex-col gap-5 py-4 sm:py-10">
        <div className="space-y-2">
          <p className="text-mint font-mono text-xs tracking-[0.12em] uppercase">Connect · Product source</p>
          <h1 className="text-fg text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[3rem]">Where is the product you built?</h1>
          <p className="text-fg-muted text-sm">
            You have connected more than one GitHub account or organization.
          </p>
        </div>

        <ul className="border-line-2 divide-line-2 overflow-hidden rounded-xl border divide-y">
          {installations.map((installation) => (
            <li key={installation.id}>
              <Link
                href={`/app/connect/github/repositories?installation=${installation.id}`}
                className="hover:bg-surface-hover flex items-center justify-between gap-4 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="text-fg-body block truncate text-sm font-medium">
                    {installation.accountLogin}
                  </span>
                  <span className="text-fg-meta block text-xs">
                    {installation.accountType === "Organization" ? "Organization" : "Personal account"}
                  </span>
                </span>
                <span className="text-fg-meta shrink-0 text-xs">Choose</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-fg-meta text-sm">
          <Link
            href="/app/connect/github?new=1"
            className="text-fg-body hover:text-fg underline underline-offset-2"
          >
            Connect a different GitHub account or organization
          </Link>
        </p>
      </section>
    </OnboardingShell>
  );
}
