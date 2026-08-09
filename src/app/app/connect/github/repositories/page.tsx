import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { listInstallationRepositories } from "@/modules/github/repositories";
import { RepositoryPicker } from "./repository-picker";

/** Step 8 of the connect flow (Sprint 1 §8). */
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
  const { data: installationRow } = await supabase
    .from("github_installations")
    .select("id, installation_id, github_account_login")
    .eq("id", installationRowId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!installationRow) {
    notFound();
  }

  let repositories: Awaited<ReturnType<typeof listInstallationRepositories>> = [];
  let accessUnavailable = false;
  try {
    repositories = await listInstallationRepositories(installationRow.installation_id);
  } catch {
    accessUnavailable = true;
  }

  return (
    <PageShell>
      <header>
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a repository</h1>
          <p className="text-sm text-zinc-400">
            From <span className="text-zinc-300">{installationRow.github_account_login}</span>. You can connect
            one repository per project.
          </p>
        </div>

        {accessUnavailable && (
          <p className="text-sm text-red-400">
            GitHub access unavailable. The installation may have been revoked — reconnect GitHub and try again.
          </p>
        )}

        {!accessUnavailable && repositories.length === 0 && (
          <p className="text-sm text-zinc-400">
            No repositories are available through this installation. Grant Vibe Business access to a repository
            in GitHub, then refresh this page.
          </p>
        )}

        {!accessUnavailable && repositories.length > 0 && (
          <RepositoryPicker repositories={repositories} installationRowId={installationRow.id} />
        )}
      </main>
    </PageShell>
  );
}
