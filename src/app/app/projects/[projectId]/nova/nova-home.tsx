import { FindingCard } from "@/components/system/finding-card";
import { projectSectionHref, preparedChangeHref } from "@/components/layout/project-shell";
import { agentChangeHref, planMoveHref } from "@/modules/action-plans/source";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import type { NovaHomeEntry, NovaHomeSection } from "@/modules/nova/home-view";
import type { ProjectWorkspaceContext } from "@/modules/projects/workspace-context";

import { novaPresenceState } from "@/components/system/status-vocabulary";
import type { NovaPresenceState } from "@/components/nova/nova-presence";

import { AttentionStack } from "./attention-stack";
import { NovaRise } from "./nova-rise";
import { FocusCard } from "./focus-card";
import { HealthScore, HealthScoreAbsent } from "./health-score";
import { NovaLinkControl, NovaServerActionControl } from "./nova-control";
import { ProductIdentity } from "./product-identity";
import { WorkingStrip } from "./working-strip";
import { isDispatchableNovaAction } from "./nova-dispatch";
import { readNovaHomeData, type NovaHomeData } from "./nova-home-data";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nova Home (UI Sourcing Spec §15; audit E1, ADR 0085).
 *
 * ## What changed, and what did not
 *
 * The ranking that decides what a founder sees first has existed, tested, with
 * written sentences and bound controls, since the Nova slice — and had no
 * production caller. Home rendered the diagnosis instead, which answers "how
 * is the business doing" to somebody who came back to ask "what do I do now".
 *
 * This mounts the ranking. It does not re-decide it: `deriveNovaFocus` chooses
 * the primary, `buildNovaHomeView` projects it, and every sentence on the page
 * comes from the feed's own table.
 *
 * ## The hierarchy
 *
 * Product context, then the one thing that matters, then what is running, then
 * what else is true, then the business reading. Deliberately a column and not
 * a grid: a dashboard of equal tiles is the shape that made a founder choose
 * between six doors, and the point of the ranking is that they do not have to.
 */
export async function NovaHome({
  supabase,
  userId,
  project,
}: {
  supabase: SupabaseClient;
  userId: string;
  project: ProjectWorkspaceContext;
}) {
  const data = await readNovaHomeData(supabase, {
    projectId: project.id,
    userId,
    projectName: project.name,
  });

  const href = {
    agent: projectSectionHref(project.id, "agent"),
    plan: projectSectionHref(project.id, "action-plan"),
    health: projectSectionHref(project.id, "business-health"),
    product: projectSectionHref(project.id, "my-product"),
  };

  const sectionHref: Record<NovaHomeSection, string> = {
    agent: href.agent,
    "action-plan": href.plan,
    "business-health": href.health,
    "my-product": href.product,
  };

  /**
   * Where a row in the stack goes.
   *
   * The subject, when the candidate names one, so a founder lands on the thing
   * rather than on the page that lists things. Falling back to the section
   * keeps every row a real destination.
   */
  function entryHref(entry: NovaHomeEntry): string {
    const candidate = entry.candidate;
    if ("preparedChangeId" in candidate) {
      return preparedChangeHref(
        agentChangeHref(href.agent, candidate.preparedChangeId),
        candidate.preparedChangeId,
      );
    }
    if ("move" in candidate) return planMoveHref(href.plan, candidate.move.id);
    if (entry.control.kind === "elsewhere") return sectionHref[entry.control.section];
    if (entry.kind === "audit_outdated" || entry.kind === "audit_failed") return href.health;
    if (entry.kind === "scan_failed" || entry.kind === "repository_read_outdated") {
      return href.product;
    }
    return href.agent;
  }

  /*
   * Which of four things Nova is doing, from what the domain observed. The
   * mark on the Focus Card and the mark on the working strip are the same
   * instrument in the same state, because they are reading the same facts —
   * and neither is a prop a caller picked.
   */
  const presence = novaPresenceState({
    tier: data.view.primary.tier,
    phase: data.view.working?.phase ?? "idle",
  });

  return (
    <div className="flex flex-col gap-8">
      <NovaRise>
        <ProductIdentity
          name={data.identity.name}
          logoUrl={data.identity.logoUrl}
          category={data.identity.category}
          understood={data.identity.understood}
          productHref={href.product}
        />
      </NovaRise>

      {/*
        The primary settles first and the rest follows: the ranking drawn in
        time. Every delay below is the position `deriveNovaFocus` decided.
      */}
      <NovaRise delay={0.06}>
        <FocusSection
          data={data}
          projectId={project.id}
          sectionHref={sectionHref}
          presence={presence}
          seed={project.id}
        />
      </NovaRise>

      <NovaRise delay={0.18}>
        <WorkingStrip working={data.view.working} presence={presence} seed={project.id} />
      </NovaRise>

      <NovaRise delay={0.26}>
        <AttentionStack entries={data.view.secondary} hrefFor={entryHref} />
      </NovaRise>

      {data.health ? (
        /* `HealthScore` is itself a labelled region; wrapping it in a second
           one would put two landmarks with the same name around one panel. */
        <NovaRise delay={0.34} className="flex flex-col gap-4">
          <HealthScore
            score={data.health.score}
            stateLabel={data.health.stateLabel}
            scoredLenses={data.health.scoredLenses}
            eligibleLenses={data.health.eligibleLenses}
            insufficientCoverageReason={data.health.insufficientCoverageReason}
            healthHref={href.health}
          />
          {/*
            The audit's own first blocker, with the evidence behind it. This is
            the one place on Home where Vibe states a judgment, so it is the one
            place the trust ladder applies: the conclusion, why it matters, and
            a way into the citations that support it.
          */}
          {data.health.priority && (
            <FindingCard
              variant="priority"
              rank={1}
              title={data.health.priority.headline}
              explanation={data.health.priority.explanation}
              whyItMatters={data.health.priority.whyItMatters}
              severity={data.health.priority.severity}
              citations={data.health.priority.citations}
            />
          )}
        </NovaRise>
      ) : (
        <NovaRise delay={0.34}>
          <HealthScoreAbsent healthHref={href.health} />
        </NovaRise>
      )}
    </div>
  );
}

/**
 * The Focus Card and its one control.
 *
 * Split out because choosing the control is the only branching on this page,
 * and it is worth reading on its own: a bound action, a plain link, or — when
 * the decision needs arguments Home does not hold — a link to the surface that
 * does, wearing its own honest label rather than the catalog's verb.
 */
function FocusSection({
  data,
  projectId,
  sectionHref,
  presence,
  seed,
}: {
  data: NovaHomeData;
  projectId: string;
  sectionHref: Record<NovaHomeSection, string>;
  presence: NovaPresenceState;
  seed: string;
}) {
  const entry = data.view.primary;
  const control = entry.control;

  if (control.kind === "none") {
    return <FocusCard entry={entry} presence={presence} seed={seed} />;
  }

  if (control.kind === "elsewhere") {
    return (
      <FocusCard entry={entry} presence={presence} seed={seed}>
        <NovaLinkControl href={sectionHref[control.section]} label={control.label} />
      </FocusCard>
    );
  }

  const meta = NOVA_ACTION_META[control.option.actionId];

  if (control.kind === "navigation") {
    const subject = control.option.subject;
    const target =
      subject.kind === "prepared_change"
        ? preparedChangeHref(
            agentChangeHref(sectionHref.agent, subject.preparedChangeId),
            subject.preparedChangeId,
          )
        : subject.kind === "move"
          ? planMoveHref(sectionHref["action-plan"], subject.opportunityId)
          : /*
             * Reconnecting is the GitHub App install flow, which leaves the
             * product entirely — the catalog's own reason for making this a
             * place to go rather than a button.
             */
            "/app/connect/github";

    return (
      <FocusCard entry={entry} presence={presence} seed={seed}>
        <NovaLinkControl href={target} label={control.option.label} />
      </FocusCard>
    );
  }

  // A server action Home can supply arguments for. Anything else was routed to
  // `elsewhere` by the view model and never reaches here.
  if (!isDispatchableNovaAction(control.option.actionId)) {
    return <FocusCard entry={entry} presence={presence} seed={seed} />;
  }

  const subject = control.option.subject;
  const subjectId =
    subject.kind === "prepared_change"
      ? subject.preparedChangeId
      : subject.kind === "move"
        ? subject.opportunityId
        : null;

  return (
    <FocusCard
      entry={entry}
      presence={presence}
      seed={seed}
      operation={meta.price}
      balance={data.balance}
      consequence={control.option.confirmationNote}
      control={
        <NovaServerActionControl
          projectId={projectId}
          actionId={control.option.actionId}
          subjectId={subjectId}
          label={control.option.label}
          consequential={control.option.consequential}
          requiresConfirmation={control.option.requiresConfirmation}
          confirmationNote={control.option.confirmationNote}
        />
      }
    />
  );
}
