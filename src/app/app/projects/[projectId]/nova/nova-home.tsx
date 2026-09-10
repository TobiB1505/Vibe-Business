import { projectSectionHref, preparedChangeHref } from "@/components/layout/project-shell";
import { agentChangeHref, planMoveHref } from "@/modules/action-plans/source";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import type { NovaHomeEntry, NovaHomeSection } from "@/modules/nova/home-view";
import type { ProjectWorkspaceContext } from "@/modules/projects/workspace-context";

import { novaPresenceState, statusForCandidate } from "@/components/system/status-vocabulary";

import { AgentWorkspaceChoiceAction } from "../agent/agent-workspace-choice-action";
import { formatElapsedShort } from "@/lib/utils/format-datetime";
import { resolveFounderInputAction } from "../founder-input-action";

import { NovaRise } from "./nova-rise";
import { NovaFocusThread } from "./nova-focus-thread";
import { NovaRail } from "./nova-rail";
import { NovaRoom } from "@/components/nova/nova-room";
import { ActionBlock } from "@/components/system/action-block";
import { BLOCK_FOR_MOMENT, BLOCK_FOR_OPERATION, type BlockKind } from "@/modules/nova/blocks";
import { NovaClock } from "@/components/nova/nova-clock";
import { NovaHeaderLive } from "./nova-header-live";
/*
 * Through the barrel, by the kind the registry names.
 *
 * These used to be mounted a level lower — `ChangeGates` with `chrome={false}`
 * written out here, `FounderInputCard` with its presentation and context
 * written out here — while `blocks/` held wrappers that made the same
 * decisions and nothing imported them. Two answers to "what does a founder see
 * for this kind", one of them in a directory whose purpose is to hold the
 * other. The lab drew the wrappers; production drew its own copy.
 */
import {
  AskBlock,
  AuditBlock,
  MoveBlock,
  ProgressBlock,
  ReviewBlock,
  ScanBlock,
  WorkspaceAskBlock,
} from "@/components/nova/blocks";
import { NovaAgentStage } from "./nova-agent-stage";
import { NovaLinkControl, NovaServerActionControl } from "./nova-control";
import { isDispatchableNovaAction } from "./nova-dispatch";
import { readNovaHomeData, type NovaHomeData } from "./nova-home-data";
import type { ReactNode } from "react";
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
 *
 * There is no briefing panel here, and its absence is a decision rather than a
 * gap. One was built — the whole evidence chain with its dates, and a read
 * beneath it — screenshotted, and removed: that chain is what Nova reads
 * *before she speaks*, not a table a founder should have to read themselves.
 * It travels with her sentences now, as `briefing/situation.ts`.
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
    <NovaRoom
      /*
        The status row, and the only piece of chrome on this page.

        Deliberately *not* wrapped in `NovaRise`. It is `sticky top-0`, and a
        sticky element can only stick within its own containing block — a
        wrapper that hugs the header is a wrapper with no room to stick in, so
        the header scrolled away with the thread instead of staying above it.
        An entrance is not worth a status row that leaves.
      */
      header={
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
      }
      /*
        The work column — the same one setup builds. `NovaRoom` owns the grid
        so a founder crossing the seam out of onboarding lands in the room she
        was already in, rather than one whose track happened to be written
        `[300px_1fr]` here and `[300px_minmax(0,1fr)]` there.
      */
      rail={
        <NovaRise delay={0.03}>
          <NovaRail
            presence={presence}
            seed={project.id}
            working={data.view.working}
            checklist={data.checklist}
            activity={data.activity}
          />
        </NovaRise>
      }
    >
      {/*
          The thread, and nothing beside it.

          Everything that used to sit in this column was a second reading of
          something already said: a product identity card under a header
          carrying the product's name, a working strip under Nova saying what
          she was doing, a stack of secondary moments under the one moment the
          ranking chose, and a business score that has its own rail item. A
          conversation with four panels stapled under it is not a conversation.
        */}
      <NovaRise delay={0.1}>
        <FocusSection
          data={data}
          projectId={project.id}
          sectionHref={sectionHref}
          running={runningBlockFor(data, { projectId: project.id, canStart: connected })}
        />
      </NovaRise>
    </NovaRoom>
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
  running,
}: {
  data: NovaHomeData;
  projectId: string;
  sectionHref: Record<NovaHomeSection, string>;
  /** What is in flight, already resolved to a block. Built once, above. */
  running?: { kind: BlockKind; node: ReactNode };
}) {
  const entry = data.view.primary;
  const control = entry.control;

  /*
   * The other moments, as sentences. `buildNovaHomeView` has ranked and capped
   * them since this route existed and nothing rendered them — so a founder
   * with three things pending saw one. The thread says them in the quiet
   * register with no controls, which is what makes them a second true thing
   * rather than a second wall of buttons.
   */
  const asides = [
    /*
     * Vibe's own line about the evidence under this moment, first, because it
     * is about the sentence above it rather than about something else pending.
     *
     * It rides in `asides` rather than in a prop of its own: it is the same
     * kind of thing — a quiet line with no control — and two nearly identical
     * prop names on one component is a defect waiting for somebody to pass the
     * wrong one. `speechBubbles` groups the run, so a situation line and one
     * other pending thing read as one remark rather than two grey blocks.
     */
    ...(data.situationAside === null ? [] : [data.situationAside]),
    /*
     * The other moments, as sentences. `buildNovaHomeView` has ranked and
     * capped them since this route existed and nothing rendered them — so a
     * founder with three things pending saw one.
     *
     * Each carries its own subject where it has one, because it rendered the
     * message alone and two moments of the same kind then read identically.
     * Two open questions both said *"The agent stopped and needs an answer
     * from you."* and neither said which question — while `detail` held the
     * question text the whole time.
     *
     * A change's `detail` is deliberately not expected to distinguish
     * anything: its `headline` names the *stage* ("This change did not pass
     * its safety checks"), not the change. Two of those would still read
     * alike, which is why the ranking now raises one change rather than
     * every change, and this line is not the thing that fixed it.
     */
    ...data.view.secondary.map((moment) =>
      moment.detail === null ? moment.message : `${moment.message} ${moment.detail}`,
    ),
    /*
     * And the queue behind the one change on screen.
     *
     * A founder with nine unfinished changes used to read five sentences about
     * them and could not tell any apart; now they read one and would otherwise
     * have no way to know the other eight exist. The count is composed here
     * rather than written into a table because this is the only place it
     * appears — there is no second copy for it to drift from — and the route
     * to them is the Agent's run history, which lists every run and links to
     * the change it produced.
     */
    ...(data.view.changesWaiting === 0
      ? []
      : [
          data.view.changesWaiting === 1
            ? "One more change is waiting behind this one. Both are listed under Agent, with every run this product has had."
            : `${data.view.changesWaiting} more changes are waiting behind this one. They are listed under Agent, with every run this product has had.`,
        ]),
  ];

  if (control.kind === "none") {
    return (
      <NovaFocusThread
        entry={entry}
        voice={data.momentVoice}
        running={running}
        asides={asides}
        block={blockFor(data, entry)}
      />
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
      return (
        <NovaFocusThread entry={entry} voice={data.momentVoice} running={running} asides={asides} />
      );
    }

    return (
      <NovaFocusThread
        entry={entry}
        voice={data.momentVoice}
        running={running}
        asides={asides}
        block={
          <AskBlock
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
            /*
             * How long a run has been stopped waiting, which is the one thing
             * this surface could not say. It costs no read — the request has
             * been in hand since the ranking put it first — and it is computed
             * on the server, because a relative time read on the client would
             * disagree with the markup around it.
             */
            waitingSince={formatElapsedShort(data.question.createdAt, new Date())}
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
      return (
        <NovaFocusThread entry={entry} voice={data.momentVoice} running={running} asides={asides} />
      );
    }

    return (
      <NovaFocusThread
        entry={entry}
        voice={data.momentVoice}
        running={running}
        asides={asides}
        block={
          /*
            No `stage` prop any more. It carried `GATE_STAGE`'s answer, which
            was derived from the candidate *kind* — and `review_required` and
            `awaiting_approval` are both `review_change` to the ranking while
            being opposite states: one needs a preview started, the other is
            the decision itself. The block reads `change.progress.stage`, which
            never lost the difference.
          */
          <ReviewBlock
            projectId={projectId}
            change={data.change}
            planHref={sectionHref["action-plan"]}
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
      return (
        <NovaFocusThread entry={entry} voice={data.momentVoice} running={running} asides={asides} />
      );
    }

    return (
      <NovaFocusThread
        entry={entry}
        voice={data.momentVoice}
        running={running}
        asides={asides}
        block={
          <WorkspaceAskBlock
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
        voice={data.momentVoice}
        running={running}
        asides={asides}
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
        voice={data.momentVoice}
        running={running}
        asides={asides}
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
      <NovaFocusThread
        entry={entry}
        voice={data.momentVoice}
        running={running}
        asides={asides}
        block={blockFor(data, entry)}
      />
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
      voice={data.momentVoice}
      running={running}
      asides={asides}
      block={blockFor(data, entry)}
      controlLabel={control.option.label}
      /*
       * `ActionBlock` for the consequence, and no longer for the price.
       *
       * The rule it enforces is that a price is never behind the disclosure,
       * and the Move satisfies it more strongly than a line above the button
       * did: the cost is a child of the control, so the two cannot come apart.
       * Passing `operation` here as well would print the same figure twice for
       * one commitment.
       */
      control={
        <ActionBlock
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
              operation={meta.price}
              balance={data.balance}
            />
          }
        />
      }
    />
  );
}

/**
 * The block for the run in flight, when one is.
 *
 * ## Why this exists beside `blockFor`
 *
 * They answer different questions. `blockFor` draws the *moment* — the thing
 * that needs deciding — and this draws what is *happening* while it waits. A
 * project can be in both states at once, which is why the thread has two slots
 * rather than one that switches.
 *
 * ## What it must not do
 *
 * Choose. `BLOCK_FOR_OPERATION` is total over every operation type, so a new
 * one fails the build until somebody decides what a founder watches; this
 * asks it and supplies the block the data is in hand for. Before, the thread
 * asked nothing and drew the progress checklist alone — so twelve of the
 * fifteen types ran behind a blank column, the Product Scan among them.
 *
 * ## The two kinds it answers `undefined` for, and why that is not a gap
 *
 * `review` and `audit` both name blocks that exist and both draw nothing here,
 * because in each case the honest content is already on screen or does not
 * exist yet.
 *
 * A **change** operation runs while the moment leading the thread is about
 * that same change, so `blockFor` has already drawn its gates. A second copy
 * under it would be the same panel twice, which is the duplication this
 * surface keeps removing.
 *
 * A running **audit** has produced no reading. The only one in hand is the
 * previous audit's, and putting last month's score under a live progress line
 * is the same false-freshness the Product Scan block refuses when it passes a
 * null presentation. When the audit is stale, `audit_outdated` is the moment
 * and `blockFor` draws that reading with the framing that says so.
 */
function runningBlockFor(
  data: NovaHomeData,
  context: { projectId: string; canStart: boolean },
): { kind: BlockKind; node: ReactNode } | undefined {
  const working = data.view.working;
  if (!working) return undefined;

  const kind = BLOCK_FOR_OPERATION[working.type];

  switch (kind) {
    case "progress":
      /*
       * The sequence is `progressSequenceFor`'s, derived from the type by the
       * same record that answered `kind` — the two agree by construction, and
       * the check is here because a total record cannot prove that to the
       * compiler.
       */
      return working.sequence
        ? {
            kind,
            node: <ProgressBlock sequence={working.sequence} operation={working.operation} />,
          }
        : undefined;

    case "scan":
      return {
        kind,
        node: (
          <ScanBlock
            projectId={context.projectId}
            operation={working.operation}
            events={data.scanEvents}
            /*
             * A reading exists only once the run has written a profile, and
             * this run has not finished. The component's own poll supplies it
             * the moment it does.
             */
            presentation={null}
            productName={data.identity.name}
            /*
             * Whether an earlier scan ever landed — which changes what the
             * component says it is about to do, not whether it may. A project
             * that has never been read says so.
             */
            hasProfile={data.identity.understood !== "not_read"}
            canStart={context.canStart}
          />
        ),
      };

    case "agent":
      return {
        kind,
        node: (
          /*
            The Agent's own build stage, streamed. `NovaAgentLive` is still
            here — as this component's fallback and as its activity column, so
            the file list is on screen immediately and the run assembles
            around it. See `nova-agent-stage.tsx` for why the read behind it
            does not reverse Home's no-network-call reading.
          */
          <NovaAgentStage
            projectId={context.projectId}
            operationId={working.operationId}
            initialEvents={data.agentEvents}
            /* The one stage the server can honestly supply. `novaWorkingEntry`
               already resolved it through `OPERATION_STAGE_LABELS`, which is
               the same table the poll reads. */
            initialStage={working.stageLabel}
            /*
             * The operations view's own answer, never a guess from the status
             * string. It is already false for a stalled run — a run presumed
             * lost is not worth pressing the database about every 2.5 seconds.
             */
            shouldPoll={working.shouldPoll}
          />
        ),
      };

    default:
      return undefined;
  }
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
