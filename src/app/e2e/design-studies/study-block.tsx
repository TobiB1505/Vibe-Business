import type { ReactNode } from "react";
import { creditsToUnits } from "@/modules/credits/units";
import {
  buildBusinessBrainView,
  type BusinessBrainView,
} from "@/modules/projects/business-brain-view";
import { OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { AgentChecks, AgentWorking } from "./agent-block";
import { AskBlock } from "./ask-block";
import { labResolveAction } from "./lab-resolve-action";
import { AuditBlock } from "./audit-block";
import { ScanBlock } from "./scan-block";
import { E2E_AGENT_STAGE_SCENARIOS } from "../agent-stage-scenarios";
import { E2E_PRODUCT_SCAN_SCENARIOS } from "../product-scan-scenarios";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { Bubble, Context, Dissolving, Line, Move, Moves, RenderBlock } from "./elements";
import { E2E_AUDIT_SCENARIOS } from "../audit-scenarios";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import type { StoredExecutionInterrupt } from "@/modules/coding-agent/store";
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
const ASK_INTERRUPT: StoredExecutionInterrupt = {
  id: "interrupt_e2e",
  projectId: "project_e2e",
  userId: "user_e2e",
  executionSpecId: "spec_e2e",
  agentExecutionRunId: "run_e2e",
  type: "business_decision_required",
  question: "Which of the two checkout flows should stay?",
  responseSchema: {
    kind: "single_choice",
    options: [
      { id: "hosted", label: "The hosted checkout" },
      { id: "embedded", label: "The embedded checkout" },
    ],
  },
  status: "open",
  answer: null,
  createdAt: "2026-09-06T08:58:00.000Z",
  answeredAt: null,
};

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
              operation={SCAN.operation}
              events={SCAN.events}
              presentation={SCAN.presentation}
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
          The block where the dissolving lines earn their argument, because both
          kinds of record are on screen at once. The lines at the top are the run&rsquo;s stages —
          a column that is overwritten as the run moves, with nothing writing down the ones before
          it. The files under them are stored rows, so they are rendered by the shipped component
          that already knows how to show them, disclosure and pulse included.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>I am building it now.</Line>
          </Bubble>
          <RenderBlock label="Building" index={1}>
            <div className="flex flex-col gap-5">
              <Dissolving stages={AGENT_STAGES} />
              <AgentWorking events={AGENT.fileEvents} />
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
          <RenderBlock label="Needs your answer" tone="waiting" namesItself index={1}>
            <AskBlock
              interrupt={ASK_INTERRUPT}
              request={ASK_REQUEST}
              resolveAction={labResolveAction}
            />
          </RenderBlock>
        </div>
        <Context>
          The block carries the amber and the panel gave up its own border to say it once instead of
          twice. What the lab cannot show is the action: resolving writes a durable answer and
          unblocks a paused run, and there is nothing here to unblock — so the control reports that
          rather than pretending. In production Nova&rsquo;s route supplies the real one, the same
          way the agent route supplies it today.
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
