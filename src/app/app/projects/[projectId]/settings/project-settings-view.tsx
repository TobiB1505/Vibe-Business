import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { SettingsColumn } from "@/components/layout/settings-column";
import { DangerRow, DangerZone } from "@/components/system/danger-zone";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { proseLinkClasses, StandaloneLink } from "@/components/ui/text-link";
import type { FounderIntent } from "@/modules/projects/founder-intent";
import { DisconnectButton } from "../disconnect-button";
import { DeleteProjectButton } from "../delete-project-button";
import { FounderIntentForm } from "../founder-intent-form";
import { ProductionUrlForm } from "../production-url-form";

/**
 * Project settings, as a view (CORE-5; extracted UI-21).
 *
 * ## Why this is separate from the route
 *
 * Because the route needs a session and a project in Supabase to reach, and
 * the browser suite deliberately has neither — so this page, which the founder
 * named as one to get right, had **no browser coverage at all**. Every other
 * settings surface has a fixture (`ProductsIndex`, `RepositoriesIndex`,
 * `ProfileView`, `BillingView`); this one was the exception, and it holds the
 * two most consequential controls a project has.
 *
 * CLAUDE.md rule 69 asks four questions before shipping consequential
 * user-visible state, and *is the actual browser-visible state tested* was the
 * one this page answered "no" to.
 *
 * ## Why the two sharp controls are in one marked region
 *
 * They were three rows in one `Surface` headed *Repository* — what Vibe reads,
 * then disconnect, then delete — two about a repository and the third
 * destroying the project and everything Vibe learned about it, all the same
 * `InlineAction` with the same icon one border-top apart.
 *
 * UI-21 pulled deleting out to a plain section at the foot. That fixed the
 * flattening and left a different gap: position was the only signal, so a
 * reader learned a control was destructive by reaching the end of the page.
 * UI-24 groups both in a `DangerZone` where each row states its own
 * consequence and whether it can be undone — the region says *these are the
 * sharp ones*, the row says *and this is what this one does*.
 */
export type ProjectSettingsRepository = {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
};

export function ProjectSettingsView({
  projectId,
  projectName,
  repository,
  productionUrl,
  founderIntent,
  reconnectHref,
}: {
  projectId: string;
  /** Typed back before the product can be deleted. */
  projectName: string;
  /** `null` when no repository is connected — a state this page must render. */
  repository: ProjectSettingsRepository | null;
  productionUrl: string | null;
  founderIntent: FounderIntent;
  /** Where "connect a repository" goes; resolved by the route. */
  reconnectHref: string;
}) {
  return (
    <WorkspaceSection id="settings">
      <SettingsColumn>
        {/*
          CORE-2a.3 §32, §33: this influences every audit, so it cannot be
          invisible. The split in the heading is the one that matters — the
          Product Profile is what Vibe *worked out*, and this is what only the
          founder can say. Keeping them apart in the UI is what stops the two
          collapsing back into one "business context" blob.
        */}
        <Surface
          id="founder-intent"
          level="section"
          padding="lg"
          /* `gap-5`: the intro sat two lines above the first question with
             nothing between them, so the paragraph read as part of it. */
          className="scroll-mt-32 flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            <h2 className="text-fg text-title font-semibold">What you told Vibe</h2>
            {/*
              One line. It was three clauses saying what the three questions
              below now ask in their own words, which is how a section with
              eighteen visible options became a wall of text.
            */}
            <p className="text-fg-muted max-w-[65ch] text-body">
              Three things evidence cannot see. All optional, and they change which problems Vibe
              puts first.
            </p>
          </div>
          <FounderIntentForm projectId={projectId} intent={founderIntent} />
        </Surface>

        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <h2 className="text-fg text-title font-semibold">Production website</h2>
            <p className="text-fg-muted max-w-[65ch] text-body">
              The address a visitor reaches. Vibe checks what is actually served there, which is the
              only way to confirm what your code suggests.
            </p>
            {productionUrl === null && <p className="text-fg-muted text-body">Not configured</p>}
          </div>
          <ProductionUrlForm projectId={projectId} currentUrl={productionUrl} />
        </Surface>

        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <h2 className="text-fg text-title font-semibold">Repository</h2>
            {repository ? (
              <p className="text-fg-muted max-w-[65ch] text-body">
                Vibe reads{" "}
                <a
                  href={repository.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={proseLinkClasses()}
                >
                  {repository.fullName}
                </a>{" "}
                and writes prepared changes to isolated branches off{" "}
                <span className="font-mono text-caption">{repository.defaultBranch}</span>.
              </p>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <StatusPill tone="neutral">No repository connected</StatusPill>
                <p className="text-fg-muted max-w-[65ch] text-body">
                  Vibe is not reading any repository for this project. Connect one to resume
                  analysis and execution — everything the project already knows is kept.
                </p>
                <StandaloneLink href={reconnectHref}>Connect a repository</StandaloneLink>
              </div>
            )}
          </div>
        </Surface>

        {/*
          Two places this page points at rather than owns: neither is scoped to
          a single project. An account has one balance and one installation
          across every project, so owning either here would imply a per-project
          setting that does not exist.
        */}
        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <h2 className="text-fg text-title font-semibold">Elsewhere</h2>
          <ul className="flex flex-col gap-2">
            <li className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-fg-secondary text-body">
                Credits, your plan and what things cost
              </span>
              <StandaloneLink href="/app/settings/billing">Credits and billing</StandaloneLink>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-fg-secondary text-body">
                Everything Vibe has done on this project
              </span>
              <StandaloneLink href={projectSectionHref(projectId, "activity")}>
                Activity
              </StandaloneLink>
            </li>
          </ul>
        </Surface>

        {/*
          Both consequential controls, in one marked region (UI-24).

          Disconnect used to be a row inside the Repository card and deleting
          had a plain section of its own at the foot of the page. Position
          alone said which was which, which works exactly once — and it left a
          reader no way to know a control was destructive before scrolling to
          the end.

          They are grouped and **not** flattened: the row says which one can be
          had back. Deleting is offered whether or not a repository is
          connected, because a project that was disconnected is exactly the one
          somebody is most likely to want gone (ADR 0056 §1).
        */}
        <DangerZone
          data-testid="danger-zone"
          description="What Vibe stops doing, and what it destroys. Read the row before the button."
        >
          {repository && (
            <DangerRow
              title="Disconnect the repository"
              consequence={`Vibe stops reading ${repository.fullName}. The project, and everything it has already learned about your product, stay exactly as they are — reconnect and analysis resumes.`}
              reversible
              action={<DisconnectButton projectId={projectId} />}
            />
          )}
          <DangerRow
            title="Delete this product"
            consequence="Removes the project and everything Vibe has learned about it — every audit, every plan, every prepared change. Your repository and your code are untouched."
            reversible={false}
            action={<DeleteProjectButton projectId={projectId} projectName={projectName} />}
          />
        </DangerZone>
      </SettingsColumn>
    </WorkspaceSection>
  );
}
