import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
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
    <PageShell>
      <header>
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a repository</h1>
          <p className="text-sm text-zinc-400">
            From <span className="text-zinc-300">{installation.accountLogin}</span>. You can connect one
            repository per project.
          </p>
        </div>

        {accessUnavailable && (
          <div className="space-y-2">
            <p className="text-sm text-amber-400">
              GitHub access unavailable. The installation may have been suspended or revoked.
            </p>
            <Link
              href="/app/connect/github?new=1"
              className="inline-block text-sm text-zinc-300 underline underline-offset-2 hover:text-zinc-50"
            >
              Reconnect GitHub
            </Link>
          </div>
        )}

        {!accessUnavailable && repositories.length === 0 && (
          <p className="text-sm text-zinc-400">
            No repositories are available through this installation. Grant Vibe Business access to a
            repository on GitHub, then refresh this page.
          </p>
        )}

        {!accessUnavailable && repositories.length > 0 && !canSelect && (
          <p className="text-sm text-zinc-400">
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
        <p className="text-sm text-zinc-500">
          Don&apos;t see your repository?{" "}
          <a
            href={manageAccessUrl}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline underline-offset-2 hover:text-zinc-50"
          >
            Manage GitHub repository access
          </a>
        </p>
      </main>
    </PageShell>
  );
}
