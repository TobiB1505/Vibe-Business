import Link from "next/link";
import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { DisconnectButton } from "../disconnect-button";
import { FounderIntentForm } from "../founder-intent-form";
import { ProductionUrlForm } from "../production-url-form";

/**
 * Settings (CORE-5).
 *
 * ## Why this route exists
 *
 * Because these three controls were on Overview, and Overview is now Home.
 *
 * That was never a deliberate placement. The production URL, what the founder
 * told Vibe, and disconnecting the repository accumulated on the index page
 * because it was the only page a project had, and they stayed there through the
 * UI-2 split because nothing moved them. The cost was that the first screen
 * after opening a project asked a founder to configure it — three forms below
 * the summary — rather than telling them where their product stands.
 *
 * They are configuration. They belong together, in the one place a person looks
 * when they want to change something rather than find something out.
 *
 * ## What it deliberately does not own
 *
 * Credits and billing (`/app/billing`) and the GitHub App installation both stay
 * where they are and are linked from here. Neither is scoped to one project —
 * an account has one balance and one installation across every project — so
 * putting either behind a project's Settings would imply a per-project setting
 * that does not exist.
 *
 * ## Cost
 *
 * The founder intent read, and the project context the access gate already
 * resolved. Nothing else — no audit, no opportunities, no prepared changes.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Re-checked here, not inherited from the layout: an App Router layout does
  // not gate the routes beneath it.
  const { supabase, project } = await requireProjectAccess(projectId);

  const founderIntent = await getFounderIntent(supabase, projectId);

  return (
    <WorkspaceSection
      id="settings"
      title="Settings"
      description="What Vibe is connected to, what you have told it, and how to disconnect."
    >
      <div className="flex flex-col gap-5">
        {/*
          CORE-2a.3 §32, §33: this influences every audit, so it cannot be
          invisible. The split in the heading is the one that matters — the
          Product Profile is what Vibe *worked out*, and this is what only the
          founder can say. Keeping them apart in the UI is what stops the two
          collapsing back into one "business context" blob.
        */}
        <Surface id="founder-intent" level="section" padding="lg" className="scroll-mt-32 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <h3 className="text-fg text-base font-semibold">What you told Vibe</h3>
            <p className="text-fg-muted max-w-[65ch] text-sm">
              Vibe works out what your product is on its own. This is the part only you know — and
              it changes which problems Vibe puts first.
            </p>
          </div>
          <FounderIntentForm projectId={project.id} intent={founderIntent.intent} />
        </Surface>

        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <h3 className="text-fg text-base font-semibold">Production website</h3>
            <p className="text-fg-muted max-w-[65ch] text-sm">
              The address a visitor reaches. Vibe checks what is actually served there, which is
              the only way to confirm what your code suggests.
            </p>
            {project.productionUrl === null && (
              <p className="text-fg-muted text-sm">Not configured</p>
            )}
          </div>
          <ProductionUrlForm projectId={project.id} currentUrl={project.productionUrl} />
        </Surface>

        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <h3 className="text-fg text-base font-semibold">Repository</h3>
            {project.repository ? (
              <p className="text-fg-muted max-w-[65ch] text-sm">
                Vibe reads{" "}
                <a
                  href={project.repository.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg-body hover:text-fg rounded-sm font-mono text-xs underline underline-offset-4 transition-interactive"
                >
                  {project.repository.fullName}
                </a>{" "}
                and writes prepared changes to isolated branches off{" "}
                <span className="font-mono text-xs">{project.repository.defaultBranch}</span>.
              </p>
            ) : (
              <StatusPill tone="neutral">No repository connected</StatusPill>
            )}
          </div>
          {project.repository && (
            <div className="border-line-1 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
              <p className="text-fg-muted text-xs">
                Disconnecting removes Vibe&apos;s access to this repository.
              </p>
              <DisconnectButton projectId={project.id} />
            </div>
          )}
        </Surface>

        {/*
          Two places this page points at rather than owns, for the reason in the
          docblock: neither is scoped to a single project.
        */}
        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <h3 className="text-fg text-base font-semibold">Elsewhere</h3>
          <ul className="flex flex-col gap-2">
            <li className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-fg-secondary text-sm">
                Credits, your plan and what things cost
              </span>
              <Link
                href="/app/billing"
                className="text-fg-muted hover:text-fg-body rounded-sm text-xs underline underline-offset-4 transition-interactive"
              >
                Credits and billing
              </Link>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-fg-secondary text-sm">
                Everything Vibe has done on this project
              </span>
              <Link
                href={projectSectionHref(project.id, "activity")}
                className="text-fg-muted hover:text-fg-body rounded-sm text-xs underline underline-offset-4 transition-interactive"
              >
                Activity
              </Link>
            </li>
          </ul>
        </Surface>
      </div>
    </WorkspaceSection>
  );
}
