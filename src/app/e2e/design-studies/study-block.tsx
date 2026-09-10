import type { ReactNode } from "react";
import { creditsToUnits } from "@/modules/credits/units";
import {
  buildBusinessBrainView,
  type BusinessBrainView,
} from "@/modules/projects/business-brain-view";
import { buildOperationView, OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { AgentChecks, AgentWorking } from "@/components/nova/blocks/agent";
import { AskBlock } from "@/components/nova/blocks/ask";
import { WorkspaceAskBlock } from "@/components/nova/blocks/workspace";
import { MoveBlock } from "@/components/nova/blocks/move";
import { ProgressBlock } from "@/components/nova/blocks/progress";
import { ReviewBlock } from "@/components/nova/blocks/review";
import { AgentBuildStage } from "@/app/app/projects/[projectId]/agent/agent-build-stage";
import { AgentReadyStage } from "@/app/app/projects/[projectId]/agent/agent-ready-stage";
import { AgentCore } from "@/app/app/projects/[projectId]/agent/agent-core";
import { AgentFileActivity } from "@/app/app/projects/[projectId]/agent/agent-file-activity";
import { labResolveAction } from "./lab-resolve-action";
import { AuditBlock } from "@/components/nova/blocks/audit";
import { ScanBlock } from "@/components/nova/blocks/scan";
import { agentReadyForecastNotes, E2E_AGENT_STAGE_SCENARIOS } from "../agent-stage-scenarios";
import { E2E_MOVES_SCENARIOS } from "../moves-scenarios";
import { E2E_SCENARIOS } from "../scenarios";
import { E2E_PRODUCT_SCAN_SCENARIOS } from "../product-scan-scenarios";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { Bubble, Context, Dissolving, Line, Move, Moves, RenderBlock } from "./elements";
import { E2E_AUDIT_SCENARIOS } from "../audit-scenarios";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import type { WorkspaceCandidate } from "@/modules/validation/profile";
import type { Study } from "./studies";

/**
 * The Render Block (S0, element track) — the third kind of object in a thread.
 *
 * ## What it is for
 *
 * A bubble means Nova is **saying** something. A Move means the founder can
 * **do** something. A block means Vibe **made** something, and this is where
 * it appears: an audit reading, a scan, a change, a map.
 *
 * Three kinds and none of them nests inside another. That is the same rule
 * that took the Move out of the bubble, applied one object further.
 *
 * ## The two states are one object
 *
 * A block in flight is not a placeholder standing in for a block. It is the
 * same frame, showing the work instead of the outcome, which is what lets a
 * founder watch something happen without a spinner pretending to be a screen
 * nobody can see yet.
 *
 * ## The lines that dissolve
 *
 * They are the run's own stages — `OPERATION_STAGE_LABELS[stage]`, the value
 * the executor wrote. That they may vanish is not a liberty: the event log
 * records that a run started and that it finished, and the stages between were
 * true for a moment and were never written down. A surface that kept them
 * would be inventing a history the product does not have.
 *
 * This is also the only place on the surface where anything dissolves, and it
 * holds no controls at all — not by convention, by construction.
 */

const STUDY_BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

/**
 * The audit, through the product's own fixture and view builder.
 *
 * `E2E_AUDIT_SCENARIOS` is what the audit-synthesis screen renders from, and
 * `buildBusinessBrainView` is what the Business Brain page renders from. A
 * sheet that assembled its own nine lenses would be drawing a business the
 * product never produced.
 */
function auditView(scenario: "audit-synthesis" | "audit-unscored"): BusinessBrainView {
  const audit = E2E_AUDIT_SCENARIOS[scenario]();
  const view = buildBusinessBrainView({
    audit,
    lastScanAt: audit.generatedAt,
    auditReadings: [],
    movesByConclusion: {},
    moveByConclusion: {},
    usedSignedInEvidence: true,
  });
  /* `buildBusinessBrainView` returns null for an audit it cannot read at all.
     A fixture that produced one would be a broken fixture, not a state to
     design for — so it fails loudly here rather than rendering an empty block. */
  if (!view) throw new Error(`fixture ${scenario} produced no business brain view`);
  return view;
}

/**
 * A paused run, and the question that paused it.
 *
 * Written here because no fixture carried one: the agent stage scenarios cover
 * building, validating, preview and merge, and the interrupt is the state
 * nobody had built a fixture for — which is some of why it kept being routed
 * away from rather than designed.
 */
const ASK_REQUEST: FounderInputRequest = {
  id: "request_e2e",
  projectId: "project_e2e",
  actionPlanId: "plan_e2e",
  actionPlanStepKey: "checkout-flow",
  executionInterruptId: "interrupt_e2e",
  origin: "execution_blocker",
  kind: "decision",
  subjectKey: "checkout.flow",
  question: "Which of the two checkout flows should stay?",
  whyNeeded: "Both are wired up, and the change cannot land while either could be the live one.",
  responseType: "single_select",
  recommendation: {
    id: "hosted",
    label: "The hosted checkout",
    value: "Keep the hosted checkout and remove the embedded one.",
    explanation: "It is the one your pricing page already links to.",
  },
  alternatives: [
    {
      id: "embedded",
      label: "The embedded checkout",
      value: "Keep the embedded checkout and remove the hosted one.",
      explanation: null,
    },
  ],
  allowCustom: true,
  contextHash: "e".repeat(64),
  status: "open",
  createdAt: "2026-09-06T08:58:00.000Z",
  resolvedAt: null,
};

/** The same question, asked by the plan rather than by a paused run. */
const PLAN_REQUEST: FounderInputRequest = {
  ...ASK_REQUEST,
  id: "request_plan_e2e",
  executionInterruptId: null,
  origin: "planner",
  subjectKey: "pricing.model",
  question: "Who is the pricing page for?",
  whyNeeded: "The page cannot be written until it knows who it is talking to.",
  recommendation: {
    id: "solo",
    label: "Solo developers shipping side projects",
    value: "Write the pricing page for solo developers shipping side projects.",
    explanation: "It is who your README and your examples already speak to.",
  },
  alternatives: [
    {
      id: "teams",
      label: "Small engineering teams",
      value: "Write the pricing page for small engineering teams.",
      explanation: null,
    },
  ],
};

/** Two applications in one repository, which is the state that raises the choice. */
const WORKSPACES: WorkspaceCandidate[] = [
  {
    workspaceRoot: "apps/web",
    installRoot: ".",
    packageManager: "pnpm",
    frameworks: ["next"],
    moduleLinker: null,
  },
  {
    workspaceRoot: "apps/docs",
    installRoot: ".",
    packageManager: "pnpm",
    frameworks: ["astro"],
    moduleLinker: null,
  },
];

/** The top-ranked Move, from the fixture the plan's own route renders. */
const MOVES_FIXTURE = E2E_MOVES_SCENARIOS.moves_ranked();
const MOVE = MOVES_FIXTURE.opportunities[0]!;
const MOVE_EXECUTION = MOVES_FIXTURE.executionStates[MOVE.id] ?? null;

/**
 * The planning run, at a chosen point in its own stages.
 *
 * Built through `buildOperationView` rather than written as a literal, so the study draws the same
 * object the route draws — `stalled`, `shouldPoll` and `retryAllowed` are derived here exactly as
 * they are in production, and a change to that derivation shows up in the lab rather than only in
 * the app.
 */
function planningRun(startedMsAgo: number, stage: "preparing" | "planning" | "validating") {
  const started = new Date(Date.now() - startedMsAgo);
  return buildOperationView({
    operationId: "study-action-planning",
    status: "running",
    stage,
    failureCode: null,
    resultId: null,
    startedAt: started.toISOString(),
    completedAt: null,
    createdAt: started.toISOString(),
  });
}

/** The same run, past the point where a wait is still believable. */
const PLANNING_STALLED = planningRun(12 * 60 * 1000, "planning");

/** The agent fixture the workspace's own stage routes render from. */
const AGENT = E2E_AGENT_STAGE_SCENARIOS["agent-stages-building"]();

/**
 * The run's earlier stages, newest first.
 *
 * `OPERATION_STAGE_LABELS` values, in the order an agent run passes through
 * them. These are the lines that go: the stage column is overwritten as the
 * run moves, and nothing writes the ones before it down.
 */
const AGENT_STAGES = [
  OPERATION_STAGE_LABELS.generating_change,
  OPERATION_STAGE_LABELS.planning,
  OPERATION_STAGE_LABELS.preflight,
];

/** The scan fixture the product's own reveal route renders from. */
const SCAN = E2E_PRODUCT_SCAN_SCENARIOS.product_scan_complete;

/** A run part-way through, newest stage first. Real labels, real order. */
const STAGES = [
  OPERATION_STAGE_LABELS.running_ai,
  OPERATION_STAGE_LABELS.preparing,
  OPERATION_STAGE_LABELS.preflight,
];

/**
 * The moves this moment actually offers, so the four arrangements are compared
 * on real controls rather than on three copies of one button.
 *
 * One navigation with no price, one priced action, and one that leaves the
 * product for somewhere else. That mixture is the case a stack hides: three
 * identical rows make a free look, a 20-Credit spend and a trip to GitHub
 * read as the same size of decision.
 */
const MOVES = [
  { label: "Look at the change", operation: null, leavesTo: undefined },
  { label: "Plan this move", operation: "action_plan" as const, leavesTo: undefined },
  { label: "Open the business map", operation: null, leavesTo: "Business health" },
];

const CTA_VARIANTS: { id: string; what: string }[] = [
  {
    id: "A · stacked",
    what: "What the thread does today. Every option the same weight, the column taller with each one, and nothing saying which is the thing to do.",
  },
  {
    id: "B · one leads",
    what: "The first move keeps the full control; the rest become quiet text links under it. The ranking is the domain's — deriveNovaFocus already put them in order — so this renders a decision that was already made rather than making one.",
  },
  {
    id: "C · side by side — chosen",
    what: "Equal shape, one row, capped at three. The first attempt used rows and a priced control broke onto two lines beside a free one, which made a spend and a navigation read as two different sizes of thing. Stacked into tiles they are one shape at one height, and three of them fill the width of the block above. Nothing is hidden by the cap: the rail lists everything open, which is the surface built for the full set.",
  },
  {
    id: "D · one, and a menu",
    what: "One control and a disclosure holding the rest. Keeps the thread short at any number of options, and hides a price behind a click — which is the one thing a cost disclosure exists to prevent.",
  },
];

function CtaVariant({ id }: { id: string }) {
  const [lead, ...rest] = MOVES;
  if (!lead) return null;

  if (id.startsWith("A")) {
    return (
      <div className="flex max-w-[24rem] flex-col gap-2.5">
        {MOVES.map((move) => (
          <Move
            key={move.label}
            label={move.label}
            operation={move.operation}
            leavesTo={move.leavesTo}
            balance={STUDY_BALANCE}
          />
        ))}
      </div>
    );
  }

  if (id.startsWith("B")) {
    return (
      <div className="flex max-w-[24rem] flex-col gap-3">
        <Move
          label={lead.label}
          operation={lead.operation}
          leavesTo={lead.leavesTo}
          balance={STUDY_BALANCE}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {rest.map((move) => (
            <span key={move.label} className="flex items-baseline gap-2">
              <span className="text-caption font-medium text-mint underline decoration-mint-line underline-offset-4">
                {move.label}
              </span>
              {/*
                The price still shows. A secondary option that hid its cost
                would be the cheapest way to make a spend look like a link.
              */}
              <span className="text-caption text-fg-meta">
                <CostDisclosure operation={move.operation} balance={STUDY_BALANCE} />
              </span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (id.startsWith("C")) {
    return <Moves moves={MOVES} balance={STUDY_BALANCE} />;
  }

  return (
    <div className="flex max-w-[24rem] flex-col gap-2.5">
      <Move
        label={lead.label}
        operation={lead.operation}
        leavesTo={lead.leavesTo}
        balance={STUDY_BALANCE}
      />
      <details className="rounded-nav border border-line-2 bg-surface-1">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-caption text-fg-secondary">
          {rest.length} more {rest.length === 1 ? "thing" : "things"} I can do
        </summary>
        <div className="flex flex-col gap-2 border-t border-line-1 p-2.5">
          {rest.map((move) => (
            <Move
              key={move.label}
              label={move.label}
              operation={move.operation}
              leavesTo={move.leavesTo}
              balance={STUDY_BALANCE}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

/** A run mid-flight, from the Agent stages' own fixtures. */
const BUILDING = E2E_AGENT_STAGE_SCENARIOS["agent-stages-building"]();

/** The offer, with two steps in the chain and both prices on it. */
const OFFERED = E2E_AGENT_STAGE_SCENARIOS["agent-stages-chain-offered"]();

export function StudyBlock({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Eyebrow>Element</Eyebrow>
          <p className="text-title font-semibold text-fg">The Render Block</p>
        </div>
        <Context>
          The third kind of object a thread holds. A bubble means Nova is saying something, a Move
          means you can do something, a block means Vibe made something. None of them nests inside
          another — the same rule that took the control out of the bubble, one object further.
        </Context>
        <Context>
          Square where the bubble is round, and not for decoration: the bubble is round because that
          shape already means <em>speech</em> to anybody who has used a phone. A block is not
          speech, so it takes the system&rsquo;s own panel geometry instead.
        </Context>
      </div>

      {/* ── In flight ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>While it runs</Eyebrow>
        <Context>
          The same frame, showing the work instead of the outcome. The bright line is the stage the
          executor wrote; the two behind it are the stages before it, on their way out. They may go
          because the log never kept them — it records that a run started and that it finished, and
          everything between was true for a moment and was never written down.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>I am reading your business now.</Line>
          </Bubble>
          <RenderBlock label="Business audit" index={1}>
            <Dissolving stages={STAGES} />
          </RenderBlock>
        </div>
        <Context>
          No control is inside it, and that is structural rather than a convention: the dissolving
          surface renders text and nothing else, so a button that goes away under a cursor is not
          something this design can express.
        </Context>
      </section>

      {/* ── Settled ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>When it has finished</Eyebrow>
        <Context>
          Two shipped components and no geometry of its own. The map is BusinessMap with a block
          variant, which renders the compact layout that file already had for a phone; the blocker
          is FindingCard, which already knows that a priority leads with what it costs.
        </Context>
        <Context>
          This is the block that was wrong for longest. It used to be a hand-drawn SVG laid out from
          the domain&rsquo;s ring and angle — and the shipped map does not use those at all, it
          places the nine areas from a table of its own. Two maps of one business, in two different
          arrangements, and nothing would have caught it. Change the map now and this changes with
          it; there is nothing left here to keep in step.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>I finished reading your business.</Line>
          </Bubble>
          <RenderBlock label="Business audit" at="32m" index={1}>
            <AuditBlock view={auditView("audit-synthesis")} />
          </RenderBlock>
          <div className="max-w-[24rem]">
            <Move label="Open the business map" leavesTo="Business health" />
          </div>
        </div>
      </section>

      {/* ── Nothing could be scored ──────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>When it could not be scored</Eyebrow>
        <Context>
          The state a block would most like to fake. A null score is an em dash, never a zero and
          never a red ring — an audit that could not be scored has not scored badly (rule 44). The
          reason is rendered rather than left in the view model, which is how the Business Brain
          used to lose it.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <RenderBlock label="Business audit" at="2h" index={0}>
            <AuditBlock view={auditView("audit-unscored")} />
          </RenderBlock>
        </div>
      </section>

      {/* ── A shipped surface, composed ──────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The Product Scan, not redrawn</Eyebrow>
        <Context>
          This one is the block&rsquo;s actual argument. The scan is a shipped component with its
          own animation and its own reading of the event stream, so the block mounts it rather than
          reproducing it — a compressed copy would be a second scan UI to keep in step with the
          first, and it would be out of step the first time anybody touched either.
        </Context>
        <Context>
          The variant drops exactly two things and nothing else: the panel frame, because the block
          already is one, and the component&rsquo;s own buttons, because a thread carries its
          controls beside a block. Change the scan and this changes with it.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>I read your product.</Line>
          </Bubble>
          <RenderBlock label="Product scan" at="1h" namesItself index={1}>
            <ScanBlock
              projectId="project_e2e"
              operation={SCAN.operation}
              events={[...SCAN.events]}
              presentation={SCAN.presentation}
              productName="Payflow"
              hasProfile
              canStart={false}
            />
          </RenderBlock>
          <div className="max-w-[24rem]">
            <Move label="Open the product scan" leavesTo="My product" />
          </div>
        </div>
      </section>

      {/* ── The Agent, and the two kinds of record ───────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The Agent at work, and what survives it</Eyebrow>
        <Context>
          The block where the dissolving lines earn their argument, because both kinds of record are
          on screen at once. The lines at the top are the run&rsquo;s stages — a column that is
          overwritten as the run moves, with nothing writing down the ones before it. The files
          under them are stored rows, so they are rendered by the shipped component that already
          knows how to show them, disclosure and pulse included.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>I am building it now.</Line>
          </Bubble>
          <RenderBlock label="Building" index={1}>
            <div className="flex flex-col gap-5">
              <Dissolving stages={AGENT_STAGES} />
              {/* The sheet draws a run in flight, and the pulse is a prop now
                  rather than a constant — so it has to be asked for here, and
                  the block beside a settled run will not claim activity. */}
              <AgentWorking events={AGENT.fileEvents} live />
            </div>
          </RenderBlock>
        </div>
        <Context>
          One dissolves because it was never written down; the other does not, because it was. That
          is the whole rule, and it is visible here rather than argued for.
        </Context>
      </section>

      {/* ── What the checks found ────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>And what Vibe checked afterwards</Eyebrow>
        <Context>
          The validation, through the workspace&rsquo;s own component — including the rows it
          refuses to dress up. A skipped check says it was skipped and why; it does not quietly
          count as a pass, and the block does not roll five states into one tick.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <RenderBlock label="Checks" at="4m" index={0}>
            <AgentChecks checks={AGENT.checks} />
          </RenderBlock>
          <div className="max-w-[24rem]">
            <Move label="Look at the change" leavesTo="Agent" />
          </div>
        </div>
        <Context>
          What it must never say is that this is ready to ship. A validation pass means a
          profile&rsquo;s commands exited zero in an isolated VM — never that a change is safe,
          reviewed, mergeable or live (rule 66), which is why the control beside it goes to the
          review rather than to a merge.
        </Context>
      </section>

      {/* ── The ask ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>A question answered where it was asked</Eyebrow>
        <Context>
          The second kind of block. &ldquo;Answer in the Agent&rdquo; sends a founder out of the
          conversation to answer a question the conversation just asked, while the run sits paused,
          and expects them to come back. That was on ten of the twenty-one moments and it is the one
          interaction a surface meant to be <em>the</em> place somebody works cannot have.
        </Context>
        <Context>
          It is composition rather than a rebuild because the shipped pieces already split the two
          halves that had to be split: the panel renders what is asked and takes the control as
          children; the control takes its server action as a prop. Neither knows where it is, so the
          panel travels into the thread and the action stays with whoever can perform it.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble tone="waiting" open index={0}>
            <Line>I stopped part-way and need something from you.</Line>
          </Bubble>
          <RenderBlock label="Needs your answer" tone="waiting" index={1}>
            <AskBlock
              projectId="project_e2e"
              request={ASK_REQUEST}
              context="runtime_execution"
              waitingSince="12m"
              resolveAction={labResolveAction}
            />
          </RenderBlock>
        </div>
        <Context>
          One frame and one heading, which took two attempts. The first drew the block&rsquo;s amber
          border around the card&rsquo;s own amber surface, under a label saying{" "}
          <em>Needs your answer</em>, above a panel saying <em>Vibe has a question</em>, above a
          pill saying <em>Needs your decision</em>. Three statements of one fact and two borders —
          in the sheet whose whole argument is that this surface says things once.
        </Context>
        <Context>
          What survives is the half that could not be dropped: the card holds the options and the
          submit. <em>Execution paused</em> stays because it is the one claim the frame does not
          make — a <em>run</em> is stopped, which is why answering here matters — and the waiting
          time moved onto it, because that was the only thing the panel said that nothing else did.
        </Context>
        <Context>
          What the lab cannot show is the action: resolving writes a durable answer and unblocks a
          paused run, and there is nothing here to unblock — so the control reports that rather than
          pretending. In production Nova&rsquo;s route supplies the real one, the same way the agent
          route supplies it today.
        </Context>
      </section>

      {/* ── The same move, twice more ────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Two more that used to send you away</Eyebrow>
        <Context>
          <em>Answer in the plan</em> and <em>Choose in the Agent</em>. Both are the same mechanism
          as the one above, and both were <code className="font-mono">elsewhere</code> controls for
          a reason home-view.ts states plainly: Home did not hold the arguments the action needed. A
          block that mounts the panel does hold them, because the panel is where they live.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble tone="waiting" open index={0}>
            <Line>The plan needs a decision only you can make.</Line>
          </Bubble>
          <RenderBlock label="Needs your answer" tone="waiting" index={1}>
            <AskBlock
              projectId="project_e2e"
              request={PLAN_REQUEST}
              context="action_plan"
              resolveAction={labResolveAction}
            />
          </RenderBlock>
        </div>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble tone="waiting" open index={0}>
            <Line>There is more than one app here, and I do not know which one to work on.</Line>
          </Bubble>
          <RenderBlock label="Needs your choice" tone="waiting" namesItself index={1}>
            {/* The block requires a control, and requiring it is the point: a
                render prop cannot cross from a server component to a client
                one, so whoever supplies it has to be a client component. In
                production that is `AgentWorkspaceChoiceAction`, which needs a
                project the lab does not have. This one does nothing and does
                not pretend otherwise. */}
            <WorkspaceAskBlock
              candidates={WORKSPACES}
              action={() => (
                <span className="shrink-0 rounded-nav border border-line-3 bg-surface-2 px-3 py-1.5 text-caption text-fg-meta">
                  Choose
                </span>
              )}
            />
          </RenderBlock>
        </div>
        <Context>
          The workspace list brings its own notice with it —{" "}
          <em>choosing is free and you can change it later, nothing starts running</em> — which is
          the sentence that stops a founder reading this as the moment a priced run begins. A block
          that rebuilt the list would have had to remember to write it.
        </Context>
      </section>

      {/* ── The change, read where it was announced ──────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Look at the change, without going anywhere</Eyebrow>
        <Context>
          The last of the send-you-away controls, and the only one that was
          <em> honest</em> as a link: there was genuinely nothing here to look at. A block changes
          that. ChangeGates is the component the Agent route mounts, and it renders the whole review
          gate from one card — so the change is read where it was announced.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble tone="waiting" index={0}>
            <Line>There is a change waiting for you to look at.</Line>
          </Bubble>
          <Bubble aside tail={false} index={1}>
            <Context>Two files changed on a branch of their own.</Context>
          </Bubble>
          <RenderBlock label="The change" tone="waiting" at="32m" index={2}>
            <ReviewBlock
              projectId="project_e2e"
              change={E2E_SCENARIOS.change_awaiting_approval()}
              planHref="/app/projects/project_e2e/plan"
            />
          </RenderBlock>
        </div>
        <Context>
          And the state a founder actually reached on a phone: nothing previewed yet, so approval is
          blocked on a preview and says so. The gate mounts at <code>stage=&quot;review&quot;</code>
          , which used to filter the preview panel out — so the refusal named a step that had no
          control anywhere on the screen. A stage is a floor now: this gate and everything it rests
          on.
        </Context>
        <div
          className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}
          data-testid="gate-needs-preview"
        >
          <Bubble tone="waiting" index={0}>
            <Line>There is a change waiting for you to look at.</Line>
          </Bubble>
          <RenderBlock label="The change" tone="waiting" at="4m" index={1}>
            <ReviewBlock
              projectId="project_e2e"
              change={E2E_SCENARIOS.change_needs_preview()}
              planHref="/app/projects/project_e2e/plan"
            />
          </RenderBlock>
        </div>
        <Context>
          I said last time I would not put a merge control in a thread, and the reason this is not
          that is that a <em>button</em> is not what arrives. The gate brings its own order —
          evidence, then approval, then merge, then outcome, each reachable only through the one
          above it. Its own comment says it:{" "}
          <em>
            a merge needs an approval, an approval needs a review, a review needs a preview, a
            preview needs a validation.
          </em>
        </Context>
        <Context>
          That ordering is rule 67 in component form. An approval binds to one immutable identity —
          this change, this commit, this base, this validation run — and the panels carry the
          change&rsquo;s own approval and merge cards rather than a latest lookup. Lifting a merge
          button out of the sequence would be a yes to commit A applied to commit B. Lifting the
          sequence itself is not, and the block adds nothing to it.
        </Context>
        <Context>
          One property of composing an <em>interactive</em> component that a read-only one never
          had: it may reach for data on mount. A code-classified change loads its diff immediately,
          because there the diff is the review — and in a lab with no session that request bounces
          to the sign-in page and takes the study with it. The fixture here is a change awaiting
          approval, which fetches on the click. Worth knowing before Nova&rsquo;s route mounts this
          for real: the blocks inherit the components&rsquo; data appetite along with their looks.
        </Context>
      </section>

      {/* ── The offer, in the thread ─────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Start it here</Eyebrow>
        <Context>
          The last moment that sent a founder away. Nova would say <em>there is a step here I can
          build</em> and then hand over a link to the plan — off the thread, onto a page, to press a
          button and come back. The reason was good and it was written down: a build is two pieces
          of work at two prices, and offering one of them in a thread would be half a decision at a
          price nobody was shown the alternative to.
        </Context>
        <Context>
          So the answer is to show both. This is the Agent&rsquo;s own ready stage in block
          presentation, and the offer inside it is one component — the same one the plan page mounts
          — which is what makes &ldquo;the same two prices&rdquo; a property of the code rather than
          a thing two files agree about.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`} data-testid="stage-ready-block">
          <Bubble tone="waiting" index={0}>
            <Line>There is a step here I can build.</Line>
          </Bubble>
          {/*
            No aside naming the step. The task panel below opens with that
            exact string as its headline — `BLOCK_SAYS_THE_DETAIL` — and the
            thread drew both until this render put them three lines apart.
          */}
          <Bubble tone="waiting" tail={false} index={1}>
            <Line>Want me to build it?</Line>
          </Bubble>
          <RenderBlock label="The step to build" tone="waiting" at="now" index={2}>
            <AgentReadyStage
              presentation="block"
              task={OFFERED.task}
              planHref="/e2e/action-plan-ranked"
              repository={null}
              liveUrl={null}
              caption=""
              creditEstimate={OFFERED.chainOffer?.stepCredits ?? null}
              forecastNotes={agentReadyForecastNotes()}
              /*
                Stand-in buttons, for the reason the stage scenarios give: the
                real control binds a server action and cannot be mounted in a
                lab with no session. What a study can show is what a founder is
                offered — two figures, both named, and the single step still
                reachable.

                Split across the two slots exactly as `agentStartControls`
                splits them, because the split is the thing worth looking at
                here: only the chain button belongs inside the swept pill.
              */
              startAction={
                <button type="button" className="w-full rounded-full px-5 py-3">
                  {`Build all ${OFFERED.chainOffer?.memberCount ?? 1} steps — ${OFFERED.chainOffer?.chainCredits ?? ""}`}
                </button>
              }
              startBeneath={
                <div className="flex w-full flex-col gap-2">
                  <button type="button" className="w-full rounded-full px-5 py-3">
                    {`Build just this step — ${OFFERED.chainOffer?.stepCredits ?? ""}`}
                  </button>
                  <p className="text-fg-meta text-xs" data-testid="agent-chain-boundary">
                    {OFFERED.chainOffer?.boundary}
                  </p>
                </div>
              }
            />
          </RenderBlock>
        </div>
        <Context>
          What the page keeps and the block drops: a radial glow, a thirty-two point heading, the
          Agent core at hero size introducing itself, and a facts row naming the repository and the
          live address. In a thread Nova&rsquo;s mark is already in the rail and the status row
          above already carries the project — all of it would be said twice, larger. What survives
          is the decision.
        </Context>
      </section>

      {/* ── The agent at work, in the thread ─────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Watch it work</Eyebrow>
        <Context>
          The block used to be the polling file list and nothing else — a real piece of the build
          stage, and the only piece, so somebody who had just spent Credits watched filenames appear
          and could not see the run. This is the Agent&rsquo;s own build stage in block
          presentation: the task, the core, the activity. The narrative column is gone, because
          Nova&rsquo;s bubble says <em>Vibe is writing the change</em> one line above it and the
          assurance bar at the foot says the rest of what that paragraph said.
        </Context>
        <div
          className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}
          data-testid="stage-build-block"
        >
          <Bubble open index={0}>
            <Line>I am writing the change now. You can watch it happen.</Line>
          </Bubble>
          <RenderBlock label="The agent" at="now" index={1}>
            <AgentBuildStage
              presentation="block"
              task={BUILDING.task}
              live
              core={<AgentCore state={BUILDING.core} caption={BUILDING.caption} size="compact" />}
              activity={
                <AgentFileActivity
                  events={BUILDING.fileEvents}
                  limit={4}
                  title="Files touched"
                  live
                  variant="block"
                />
              }
            />
          </RenderBlock>
        </div>
        <Context>
          What this study cannot show is the seam. In the product the stage arrives behind a
          <code> Suspense</code> boundary whose fallback is the file list, so a founder sees the
          list immediately and the run assembles around it. A fixture has the whole reading in hand,
          so the boundary never suspends here.
        </Context>
      </section>

      {/* ── What was merged, and what it did ─────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Check what changed</Eyebrow>
        <Context>
          The same gate, one stage further on. The change reached the default branch and no outcome
          has been read back — so the block shows what a founder needs to decide whether to look,
          and the check sits where the approval used to.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble open index={0}>
            <Line>
              A change reached your default branch. I have not looked at what changed yet.
            </Line>
          </Bubble>
          <RenderBlock label="The change" at="2h" index={1}>
            <ReviewBlock
              projectId="project_e2e"
              change={E2E_SCENARIOS.outcome_not_started()}
              planHref="/app/projects/project_e2e/plan"
            />
          </RenderBlock>
        </div>
        <Context>
          Merged means one sentence here, the same as everywhere: the default branch points at the
          approved commit and Vibe read it back. Not deployed, not released, not live — and the
          block adds no word that says otherwise.
        </Context>
      </section>

      {/* ── The Move, before it is paid for ──────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>A Move, before twenty Credits</Eyebrow>
        <Context>
          &ldquo;Plan this&rdquo; costs twenty Credits and &ldquo;Look at this move&rdquo; is a
          navigation, and both were offered with nothing but their own label — so a founder either
          pressed the first without seeing the problem it addresses, or took the second trip to find
          out what the thread would not say.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble tone="active" index={0}>
            <Line>There is a move here without a plan behind it.</Line>
          </Bubble>
          <RenderBlock label="Next move" index={1}>
            <MoveBlock opportunity={MOVE} execution={MOVE_EXECUTION} />
          </RenderBlock>
          <Moves
            moves={[
              { label: "Plan this", operation: "action_plan" },
              { label: "Look at this move", leavesTo: "Action plan" },
            ]}
            balance={STUDY_BALANCE}
          />
        </div>
        <Context>
          The control is outside, as every control is. A Move block is a view, so a founder reading
          it is never a mis-click away from spending inside the thing they are reading — and the
          card gives up its own surface rather than the block giving up its frame.
        </Context>
      </section>

      {/* ── The minute after the press ───────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>What the twenty Credits are doing</Eyebrow>
        <Context>
          The press used to be the end of the thread. Twenty Credits were spent, a run took about a
          minute, and the next thing a founder saw was a finished plan on another screen — if they
          thought to go and look. The press and its consequence were not visibly the same event.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble tone="active" index={0}>
            <Line>That&rsquo;s started. The steps will land here, not on another screen.</Line>
          </Bubble>
          <RenderBlock label="Planning the move" tone="active" index={1}>
            <ProgressBlock sequence="action_planning" operation={planningRun(40_000, "planning")} />
          </RenderBlock>
        </div>
        <Context>
          No percentage, no &ldquo;3 of 4&rdquo;, no estimate — the rows come from the run&rsquo;s
          own durable stage, so a tick is a fact rather than an animation on a timer. It is the
          shipped checklist, not a copy of it: the component carries no frame of its own, so there
          was not even a variant to add. Nova says the one thing the block cannot — that the result
          arrives here — and the first draft of this line did not: it repeated the current row back
          in Nova&rsquo;s voice, which is the two-UIs problem in copy rather than in components.
        </Context>
      </section>

      {/* ── The same run, too long ───────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>When the minute becomes twelve</Eyebrow>
        <Context>
          A durable run can be lost by the platform, and the row would then say
          &ldquo;running&rdquo; forever. The block says so without claiming the run failed — it may
          yet land, and a founder told otherwise pays twice.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <RenderBlock label="Planning the move" tone="waiting" index={0}>
            <ProgressBlock sequence="action_planning" operation={PLANNING_STALLED} />
          </RenderBlock>
          <Moves
            moves={[{ label: "Start again", operation: "action_plan" }]}
            balance={STUDY_BALANCE}
          />
        </div>
        <Context>
          No bubble. The block already says it in the shipped component&rsquo;s own words, and a
          bubble above it would be Nova reading the panel out loud — so this is the case where a
          render block is the whole message and speech would only be a second voice. Starting again
          is a second twenty Credits, so it is a control outside the block like every other priced
          thing.
        </Context>
      </section>

      {/* ── More than one thing to do ────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Four ways to offer more than one move</Eyebrow>
        <Context>
          A stack of full-width buttons is what the thread does today and it is the weakest of the
          four: every option gets the same weight, the column gets taller with every one, and
          nothing says which is the thing to do. These are the alternatives, on the real moves for
          this moment — one navigation, one priced action, one that leaves the product.
        </Context>
        <div className={`flex flex-col divide-y divide-line-1 ${panel}`}>
          {CTA_VARIANTS.map(({ id, what }) => (
            <div key={id} className="flex flex-col gap-3 p-6">
              <p className="font-mono text-caption text-fg-meta">{id}</p>
              <CtaVariant id={id} />
              <p className="study-measure font-mono text-caption text-fg-meta">{what}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The three objects together ───────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The three, in one thread</Eyebrow>
        <Context>
          Speech, then what was made, then what you can do. Each is its own object at its own width,
          and the differences between them are silhouette and material rather than a label saying
          which is which.
        </Context>
        <div className={`flex flex-col gap-2.5 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>Your pricing is the thing holding the rest back.</Line>
          </Bubble>
          <Bubble tail={false} aside index={1}>
            <Context>I read nine areas and this is the one every other one waits on.</Context>
          </Bubble>
          <RenderBlock label="Business audit" at="32m" index={2}>
            <AuditBlock view={auditView("audit-synthesis")} />
          </RenderBlock>
          <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">
            <Move label="Plan this move" operation="action_plan" balance={STUDY_BALANCE} />
            <Move label="Open the business map" leavesTo="Business health" />
          </div>
        </div>
      </section>
    </div>
  );
}
