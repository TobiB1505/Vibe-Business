import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { SettingsColumn } from "@/components/layout/settings-column";
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
 * ## Why deleting is not in the repository card
 *
 * It was: three rows in one `Surface` headed *Repository* — what Vibe reads,
 * then disconnect, then delete. Two of those are about a repository and the
 * third destroys the project and everything Vibe has learned about it.
 *
 * Both are `InlineAction`s carrying the same icon, one border-top apart. The
 * account's General page states the rule and follows it — *"a row above it
 * that looked the same would be a trap"* — and this page did the opposite.
 * Deleting has its own section now, last, after the links.
 */
export type ProjectSettingsRepository = {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
};

export function ProjectSettingsView({
  projectId,
  repository,
  productionUrl,
  founderIntent,
  reconnectHref,
}: {
  projectId: string;
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
          className="scroll-mt-32 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-2">
            <h2 className="text-fg text-title font-semibold">What you told Vibe</h2>
            <p className="text-fg-muted max-w-[65ch] text-body">
              Vibe works out what your product is on its own. This is the part only you know — it
              changes which problems Vibe puts first, and every field is optional.
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
          {repository && (
            <div className="border-line-1 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
              <p className="text-fg-muted max-w-[65ch] text-caption">
                Disconnecting stops Vibe reading this repository. The project and everything it has
                learned stay.
              </p>
              <DisconnectButton projectId={projectId} />
            </div>
          )}
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
          Last, and on its own — the same treatment the account's own delete
          section gets, and for the same reason it gives: everything above is a
          fact, a destination or a reversible action, and a row that looked the
          same beside it would be a trap. Not a coloured card: nothing else in
          this product marks destruction that way, and the button carries its
          own danger tone.

          Deleting is offered whether or not a repository is connected — a
          project that was disconnected is exactly the one somebody is most
          likely to want gone (ADR 0056 §1) — which is the other reason it
          cannot live inside a card that disappears with the repository.
        */}
        <Surface
          level="section"
          padding="lg"
          data-testid="delete-project"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-2">
            <h2 className="text-fg text-title font-semibold">Delete this product</h2>
            <p className="text-fg-muted max-w-[65ch] text-body">
              Removes the project and everything Vibe has learned about it — every audit, every
              plan, every prepared change. Your repository and your code are untouched. This cannot
              be undone.
            </p>
          </div>
          <div>
            <DeleteProjectButton projectId={projectId} />
          </div>
        </Surface>
      </SettingsColumn>
    </WorkspaceSection>
  );
}
