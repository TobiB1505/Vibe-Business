import { projectSectionHref, preparedChangeHref } from "@/components/layout/project-shell";
import { agentChangeHref, planMoveHref } from "@/modules/action-plans/source";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import type { NovaHomeEntry, NovaHomeSection } from "@/modules/nova/home-view";
import type { ProjectWorkspaceContext } from "@/modules/projects/workspace-context";

import { novaPresenceState, statusForCandidate } from "@/components/system/status-vocabulary";

import { ChangeGates } from "../agent/change-gates";
import { AgentWorkspaceChoice } from "../agent/agent-workspace-choice";
import { AgentWorkspaceChoiceAction } from "../agent/agent-workspace-choice-action";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import { resolveFounderInputAction } from "../founder-input-action";

import { NovaRise } from "./nova-rise";
import { NovaFocusThread } from "./nova-focus-thread";
import { NovaRail } from "./nova-rail";
import { ActionBlock } from "@/components/system/action-block";
import { BLOCK_FOR_MOMENT } from "@/modules/nova/blocks";
import { NovaClock } from "@/components/nova/nova-clock";
import { NovaHeaderLive } from "./nova-header-live";
import { AuditBlock } from "@/components/nova/blocks/audit";
import { MoveBlock } from "@/components/nova/blocks/move";
import { NovaLinkControl, NovaServerActionControl } from "./nova-control";
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
    repositoryFullName: project.repository?.fullName ?? null,
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

  /*
   * Nova's mark, derived rather than chosen. The tier the ranking produced and
   * the phase the operations view read — a caller passing `working` by hand
   * would be asserting activity the product has not observed.
   */
  const presence = novaPresenceState({
    tier: data.view.primary.tier,
    phase: data.view.working?.phase ?? "idle",
  });

  /* A repository, or none. The header says which, and says it as a fact about
     this project rather than about Vibe. */
  const connected = project.repository !== null;

  return (
    <div className="flex flex-col gap-6">
      {/*
        The status row, and the only piece of chrome on this page.

        Deliberately *not* wrapped in `NovaRise`. It is `sticky top-0`, and a
        sticky element can only stick within its own containing block — a
        wrapper that hugs the header is a wrapper with no room to stick in, so
        the header scrolled away with the thread instead of staying above it.
        An entrance is not worth a status row that leaves.
      */}
      <NovaHeaderLive
        projectId={project.id}
        working={data.view.working}
        /*
         * What the line says when nothing is running. The moment's own word,
         * from the same table the bubble below it reads, so the header cannot
         * describe a moment differently from the sentence under it.
         */
        resting={statusForCandidate(data.view.primary.kind)}
        tier={data.view.primary.tier}
        seed={project.id}
        subject={data.identity.name}
        connected={connected}
        now={<NovaClock />}
      />

      {/*
        Two halves: the work on the left, the conversation on the right.

        On a phone the rail goes second. A founder who opens this on a phone
        came for what Nova has to say, and putting the whole plan and the whole
        log above it means scrolling past everything to reach the one thing
        that speaks.
      */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
        <NovaRise className="max-lg:order-2" delay={0.03}>
          <NovaRail
            presence={presence}
            seed={project.id}
            working={data.view.working}
            checklist={data.checklist}
            activity={data.activity}
          />
        </NovaRise>

        {/*
          The thread, and nothing beside it.

          Everything that used to sit in this column was a second reading of
          something already said: a product identity card under a header
          carrying the product's name, a working strip under Nova saying what
          she was doing, a stack of secondary moments under the one moment the
          ranking chose, and a business score that has its own rail item. A
          conversation with four panels stapled under it is not a conversation.
        */}
        <NovaRise className="max-lg:order-1" delay={0.1}>
          <FocusSection data={data} projectId={project.id} sectionHref={sectionHref} />
        </NovaRise>
      </div>
    </div>
  );
}

/**
 * The Focus Card and its one control.
 *
 * Split out because choosing the control is the only branching on this page,
 * and it is worth reading on its own: a bound action, a plain link, the card
 * that answers a question, or — when the decision needs arguments Home does
 * not hold — a link to the surface that does, wearing its own honest label
 * rather than the catalog's verb.
 *
 * ## The one that used to be a link and is not any more
 *
 * "Answer in the Agent" and "Answer in the plan" sent a founder out of Home to
 * answer a question Home had just asked — and, for a runtime question, while
 * the run that asked it sat paused. `FounderInputCard` takes the request and
 * its resolution action as props, so it renders here, with the same options,
 * the same recommendation and the same submit the owning surface shows.
 *
 * It is *inside* the Focus Card rather than beside it, unlike every other
 * control on this page, and that is the difference between a control and an
 * answer: a button is one press on a card that explains it, while a question
 * is a thing to read and choose from. Splitting the question from its options
 * would put the two halves of one decision in two boxes.
 */
function FocusSection({
  data,
  projectId,
  sectionHref,
}: {
  data: NovaHomeData;
  projectId: string;
  sectionHref: Record<NovaHomeSection, string>;
}) {
  const entry = data.view.primary;
  const control = entry.control;

  if (control.kind === "none") {
    return (
      <NovaFocusThread entry={entry} working={data.view.working} block={blockFor(data, entry)} />
    );
  }

  if (control.kind === "answer") {
    /*
     * The ranking saw an open request; this reads it again to render it. If it
     * has been answered in between — in the Agent, in the plan, in another tab
     * — there is nothing to ask, and a form for a settled question would be
     * worse than a card with none. The sentence above it still stands.
     */
    if (!data.question) {
      return <NovaFocusThread entry={entry} working={data.view.working} />;
    }

    return (
      <NovaFocusThread
        entry={entry}
        working={data.view.working}
        block={
          <FounderInputCard
            projectId={projectId}
            request={data.question}
            /*
             * Which flow this question came from. A runtime question has a
             * paused run behind it and the card says so; a planner question
             * does not. The candidate's kind is what knows, and it is the same
             * distinction `focus.ts` used to raise two candidates instead of
             * one.
             */
            context={entry.kind === "agent_question" ? "runtime_execution" : "action_plan"}
            presentation="workspace"
            resolveAction={resolveFounderInputAction}
          />
        }
      />
    );
  }

  if (control.kind === "gate") {
    /*
     * The ranking saw a prepared change; this reads the card for it. If it has
     * merged, been superseded or stopped being `prepared` in between, the
     * sentence above still stands and there is nothing to decide — gates for a
     * change that is not there would be worse than none.
     */
    if (!data.change) {
      return <NovaFocusThread entry={entry} working={data.view.working} />;
    }

    return (
      <NovaFocusThread
        entry={entry}
        working={data.view.working}
        block={
          <ChangeGates
            projectId={projectId}
            change={data.change}
            planHref={sectionHref["action-plan"]}
            stage={control.stage}
            /*
             * The thread says it above the block. `chrome` draws the change's
             * status sentence, which is the sentence Nova has just said — the
             * duplication this surface keeps removing.
             */
            chrome={false}
          />
        }
      />
    );
  }

  if (control.kind === "choose") {
    /*
     * The ranking saw a repository with more than one application; this reads
     * the list to render it. Empty means the question has been settled since —
     * answered in the Agent, or the analysis re-read and resolved — and a
     * choice with nothing to choose from would be worse than none.
     */
    if (data.workspaceCandidates.length === 0) {
      return <NovaFocusThread entry={entry} working={data.view.working} />;
    }

    return (
      <NovaFocusThread
        entry={entry}
        working={data.view.working}
        block={
          <AgentWorkspaceChoice
            candidates={data.workspaceCandidates}
            /*
             * The panel asks; the control answers. Splitting them is what lets
             * the same question be posed on two surfaces without either of
             * them restating the options — and it is why choosing here and
             * choosing in the Agent cannot come to mean different things.
             */
            action={(candidate) => (
              <AgentWorkspaceChoiceAction
                projectId={projectId}
                candidate={candidate}
                chosen={false}
              />
            )}
          />
        }
      />
    );
  }

  if (control.kind === "elsewhere") {
    return (
      <NovaFocusThread
        entry={entry}
        working={data.view.working}
        controlLabel={control.label}
        control={<NovaLinkControl href={sectionHref[control.section]} label={control.label} />}
      />
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
      <NovaFocusThread
        entry={entry}
        working={data.view.working}
        block={blockFor(data, entry)}
        controlLabel={control.option.label}
        control={<NovaLinkControl href={target} label={control.option.label} />}
      />
    );
  }

  // A server action Home can supply arguments for. Anything else was routed to
  // `elsewhere` by the view model and never reaches here.
  if (!isDispatchableNovaAction(control.option.actionId)) {
    return (
      <NovaFocusThread entry={entry} working={data.view.working} block={blockFor(data, entry)} />
    );
  }

  const subject = control.option.subject;
  const subjectId =
    subject.kind === "prepared_change"
      ? subject.preparedChangeId
      : subject.kind === "move"
        ? subject.opportunityId
        : null;

  return (
    <NovaFocusThread
      entry={entry}
      working={data.view.working}
      block={blockFor(data, entry)}
      controlLabel={control.option.label}
      /*
       * `ActionBlock` rather than the bare control, because the price is not
       * optional: it goes above the button and never inside the consequence
       * disclosure. The card used to supply this and the thread has no
       * equivalent, so the control slot carries it.
       */
      control={
        <ActionBlock
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
      }
    />
  );
}

/**
 * The block for a moment, when the read behind it landed.
 *
 * `BLOCK_FOR_MOMENT` decides which kind; this supplies the one the data is in
 * hand for. A kind whose subject was not read draws nothing — a frame around
 * an absence is worse than no frame, and the sentence above it still stands.
 *
 * The two branches with their own control paths — a question's card, a
 * change's gates, the workspace choice — are built where their arguments are,
 * beside the control that answers them. These two are pure views.
 */
function blockFor(data: NovaHomeData, entry: NovaHomeEntry) {
  switch (BLOCK_FOR_MOMENT[entry.kind]) {
    case "audit":
      return data.audit ? <AuditBlock view={data.audit} /> : undefined;
    case "move":
      return data.move ? (
        <MoveBlock opportunity={data.move.opportunity} execution={data.move.execution} />
      ) : undefined;
    default:
      return undefined;
  }
}
