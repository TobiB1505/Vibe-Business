import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { listInstallationRepositories } from "@/modules/github/repositories";
import { getVerifiedInstallation } from "@/modules/github/connections";
import { buildInstallationSettingsUrl } from "@/modules/github/urls";
import {
  hasSelectableRepository,
  listConnectedRepositoryIds,
  markConnectedRepositories,
  type PickableRepository,
} from "@/modules/projects/connected-repositories";
import { RepositoryPicker } from "./repository-picker";
import { OnboardingShell } from "../../../onboarding/onboarding-shell";

/**
 * Repository selection. Reached either straight from "Connect a project"
 * (single installation) or via the account chooser.
 *
 * The installation row id arrives as a query parameter but is never
 * trusted: `getVerifiedInstallation` re-checks it belongs to the session
 * user, so another user's id resolves to nothing.
 */
export default async function ConnectGithubRepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await requireSession();
  const { installation: installationRowId } = await searchParams;

  if (!installationRowId) {
    notFound();
  }

  const supabase = await createClient();
  const installation = await getVerifiedInstallation(supabase, session.userId, installationRowId);

  if (!installation) {
    notFound();
  }

  let repositories: PickableRepository[] = [];
  let accessUnavailable = false;
  try {
    const [available, connectedIds] = await Promise.all([
      listInstallationRepositories(installation.installationId),
      listConnectedRepositoryIds(supabase),
    ]);
    repositories = markConnectedRepositories(available, connectedIds);
  } catch {
    accessUnavailable = true;
  }

  const manageAccessUrl = buildInstallationSettingsUrl(installation);
  const canSelect = hasSelectableRepository(repositories);

  return (
    <OnboardingShell email={session.email} state="connect_source">
      <section className="flex max-w-[52rem] flex-col gap-5 py-4 sm:py-10">
        <div className="space-y-2">
          <p className="text-mint font-mono text-xs tracking-[0.12em] uppercase">Connect · Choose product</p>
          <h1 className="text-fg text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[3rem]">Which product should Vibe get to know?</h1>
          <p className="text-fg-muted text-sm">
            From <span className="text-fg-body">{installation.accountLogin}</span>. You can connect one
            repository per project.
          </p>
        </div>

        {accessUnavailable && (
          <div className="space-y-2">
            <p className="text-amber text-sm">
              GitHub access unavailable. The installation may have been suspended or revoked.
            </p>
            <Link
              href="/app/connect/github?new=1"
              className="text-fg-body hover:text-fg inline-block text-sm underline underline-offset-2"
            >
              Reconnect GitHub
            </Link>
          </div>
        )}

        {!accessUnavailable && repositories.length === 0 && (
          <p className="text-fg-muted text-sm">
            No repositories are available through this installation. Grant Vibe Business access to a
            repository on GitHub, then refresh this page.
          </p>
        )}

        {!accessUnavailable && repositories.length > 0 && !canSelect && (
          <p className="text-fg-muted text-sm">
            Every repository from this account is already connected to a project.
          </p>
        )}

        {!accessUnavailable && repositories.length > 0 && (
          <RepositoryPicker
            repositories={repositories}
            installationRowId={installation.id}
            canSelect={canSelect}
          />
        )}

        {/* Distinct from connecting a project: this changes which
            repositories GitHub grants the App, rather than picking from
            what Vibe Business can already see. */}
        <p className="text-fg-meta text-sm">
          Don&apos;t see your repository?{" "}
          <a
            href={manageAccessUrl}
            target="_blank"
            rel="noreferrer"
            className="text-fg-body hover:text-fg underline underline-offset-2"
          >
            Manage GitHub repository access
          </a>
        </p>
      </section>
    </OnboardingShell>
  );
}
