import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getProjectWithRepository } from "@/modules/projects/queries";
import { checkInstallationStillAccessible } from "@/modules/github/repositories";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { DisconnectButton } from "./disconnect-button";
import { InspectButton } from "./inspect-button";
import { InspectLiveButton } from "./inspect-live-button";
import { IntelligenceSummary } from "./intelligence-summary";
import { LiveIntelligenceSummary } from "./live-intelligence-summary";
import { ProductionUrlForm } from "./production-url-form";

/**
 * Project screen: connection status (Sprint 1), repository intelligence
 * (Sprint 2), and live product intelligence (Sprint 3).
 *
 * The two intelligence sources are shown side by side and stay
 * independent — one describes what the code contains, the other what a
 * visitor actually sees (Sprint 3 §24).
 */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await requireSession();
  const { projectId } = await params;

  const supabase = await createClient();
  const project = await getProjectWithRepository(supabase, projectId);

  if (!project || project.userId !== session.userId) {
    notFound();
  }

  const repository = project.repository;
  // Live probe (Sprint 1 §11): degrade gracefully — never crash — if the
  // installation was revoked/suspended on GitHub's side since connection.
  const accessible = repository ? await checkInstallationStillAccessible(repository.installationId) : false;
  const [latestSnapshot, latestLiveSnapshot] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
  ]);

  return (
    <PageShell>
      <header>
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>

        {repository ? (
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-zinc-500">Connected repository</dt>
              <dd>
                <a
                  href={repository.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-200 underline underline-offset-2 hover:text-zinc-50"
                >
                  {repository.fullName}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-zinc-500">Default branch</dt>
              <dd className="text-zinc-200">{repository.defaultBranch}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-zinc-500">Connection status</dt>
              <dd className={accessible ? "text-emerald-400" : "text-amber-400"}>
                {accessible ? "Connected" : "GitHub access unavailable"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-zinc-400">No repository connected.</p>
        )}

        {/* Project context (Sprint 3 §31) — what evidence exists so far. */}
        <section className="space-y-2 rounded-md border border-zinc-800 p-4">
          <h2 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Project context</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Repository intelligence</dt>
              <dd className={latestSnapshot?.result ? "text-emerald-400" : "text-zinc-600"}>
                {latestSnapshot?.result ? "Ready" : "Not analyzed yet"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Live product intelligence</dt>
              <dd className={latestLiveSnapshot?.result ? "text-emerald-400" : "text-zinc-600"}>
                {latestLiveSnapshot?.result ? "Ready" : "Not inspected yet"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Business analysis</dt>
              <dd className="text-zinc-600">Not available yet</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-200">Production website</h2>
          {project.productionUrl === null && (
            <p className="text-sm text-zinc-500">Not configured</p>
          )}
          <ProductionUrlForm projectId={project.id} currentUrl={project.productionUrl} />
        </section>

        {project.productionUrl && (
          <section className="space-y-3">
            {latestLiveSnapshot?.result ? (
              <LiveIntelligenceSummary
                snapshot={latestLiveSnapshot.result}
                analyzedAt={latestLiveSnapshot.completedAt ?? latestLiveSnapshot.createdAt}
              />
            ) : (
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-zinc-200">Live product intelligence</h2>
                <p className="text-sm text-zinc-500">Not inspected yet</p>
              </div>
            )}
            <InspectLiveButton
              projectId={project.id}
              hasSnapshot={Boolean(latestLiveSnapshot?.result)}
            />
          </section>
        )}

        {repository && (
          <section className="space-y-3">
            {latestSnapshot?.result ? (
              <IntelligenceSummary snapshot={latestSnapshot.result} analyzedAt={latestSnapshot.createdAt} />
            ) : (
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-zinc-200">Repository intelligence</h2>
                <p className="text-sm text-zinc-500">Not analyzed yet</p>
              </div>
            )}
            <InspectButton projectId={project.id} hasSnapshot={Boolean(latestSnapshot?.result)} />
          </section>
        )}

        <div>
          <Button disabled title="Not implemented yet — see docs/sprints/0003-live-product-intelligence.md">
            Analyze business
          </Button>
          <p className="mt-2 text-xs text-zinc-500">
            Business analysis will use your repository and live product intelligence in a later step.
          </p>
        </div>

        <div>
          <DisconnectButton projectId={project.id} />
        </div>
      </main>
    </PageShell>
  );
}
