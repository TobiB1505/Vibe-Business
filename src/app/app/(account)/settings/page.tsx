import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { RepositoriesIcon } from "@/components/ui/dashboard-icons";
import { Metric } from "@/components/ui/metric";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getGithubIdentity } from "@/modules/github/identity";
import { findLatestErasure } from "@/modules/operations/account-erasure/service";
import { erasureViewState } from "@/modules/operations/account-erasure/view";
import { DeleteAccountSection } from "./delete-account";

export const metadata = { title: "General" };

/**
 * Settings → General.
 *
 * ## Why this stopped being a grid of three cards
 *
 * Because those three cards were navigation — Profile, GitHub access, Billing
 * — and two of them are rows in the rail beside this page now. A card that
 * duplicates the nav item next to it is not a shortcut; it is the same link
 * twice, and it made the landing page of Settings a menu to a menu.
 *
 * What is left is what belongs on a General page and nowhere else: who this
 * account is, the one destination that is genuinely outside Vibe, and the one
 * control that cannot be undone.
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
    <div className="flex flex-col gap-7">
      <SectionHeader
        level={1}
        title="General"
        description="Who this account is, and the things only you can change."
      />

      <Surface level="panel" padding="md" className="flex flex-col gap-4">
        <Metric label="Signed in as" value={session.email} />
        <Metric
          label="GitHub"
          value={github?.githubLogin ? `@${github.githubLogin}` : "Not connected"}
        />
      </Surface>

      <Surface
        level="panel"
        padding="md"
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4"
      >
        <div className="flex min-w-0 items-center gap-4">
          <span className="bg-mint-tint-soft text-mint rounded-nav flex size-11 shrink-0 items-center justify-center">
            <RepositoriesIcon size={21} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-fg text-ui font-semibold">GitHub access</h2>
            <p className="text-fg-muted max-w-[52ch] text-caption leading-relaxed">
              Which repositories and organisations Vibe can see. Only GitHub can change this, so
              this one leaves the product.
            </p>
          </div>
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

      {/*
        Last, and on its own. Everything above is a fact or a destination; this
        is the one control on the page that does something irreversible when
        pressed, and a row above it that looked the same would be a trap.
      */}
      <DeleteAccountSection state={erasure} />
    </div>
  );
}
