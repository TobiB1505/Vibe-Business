import type { CSSProperties, ReactNode } from "react";
import { NovaPresence } from "@/components/nova/nova-presence";
import { novaPresenceState, statusForCandidate } from "@/components/system/status-vocabulary";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { firstActionableStep } from "@/modules/action-plans/sequence";
import { stepDisplayState, stepSequenceStatus } from "@/modules/action-plans/view";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import { creditsToUnits } from "@/modules/credits/units";
import { buildNovaFeed, type NovaEntry } from "@/modules/nova/feed";
import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import type { OperationView } from "@/modules/operations/view";
import {
  Bubble,
  Context,
  Happened,
  Header,
  Line,
  Move,
  type NovaAvailability,
  SinceDivider,
  Thinking,
} from "./elements";
import { Clock } from "./clock";
import { NO_FACTS } from "./moment-fixtures";
import { speechBubbles } from "./speech-bubbles";
import type { Study } from "./studies";

/**
 * The wireframe, assembled (S0).
 *
 * ## What this is
 *
 * The screen the hand-drawn wireframe describes, built from the elements
 * rather than drawn again: a header, a rail Nova stands in, and a thread that
 * arrives. Every element here has its own sheet — the Bubble at
 * `/e2e/study-bubble`, the Move at `/e2e/study-move` — and this is where they
 * have to survive each other.
 *
 * ## The problem it exists to solve, which is not a layout problem
 *
 * A founder works with Nova, closes the tab, comes back tomorrow and reloads.
 * Until now the screen simply re-derived itself, which is correct and useless:
 * everything is where they left it and nothing tells them *that*. They cannot
 * see what they already read, what happened while they were away, or where
 * they stopped.
 *
 * The fix turned out to need almost nothing built, because the history already
 * exists. `audit_events` is an append-only, per-project, RLS-bound log with a
 * label table written in the product's own voice — "You answered Vibe's
 * question", "Vibe understood your product" — and `buildActivityFeed` already
 * maps it. Nobody had put it on this surface.
 *
 * So the thread has two halves and one persisted source each:
 *
 * - **The past** is the event log. It records what *occurred*, which stays
 *   true, and it carries real timestamps because real moments have them.
 * - **The present** is the projection over current facts, exactly as before.
 *   It carries no timestamps, because a sentence re-derived on every load was
 *   never "sent" at any particular time.
 *
 * The one thing that had to be invented is the line between them: which of
 * this the founder has already seen. That is a fact about a person rather than
 * about a project, so no derivation produces it — it is one timestamp per
 * founder per project, and it is the whole of the new state this screen needs.
 *
 * ## What a bubble is for, which is narrower than it was
 *
 * Nothing executable goes inside one. A bubble exists to show that Nova is
 * *saying* something; a Move is something the founder can *do*. The question
 * she asks is speech and sits in a bubble; the control sits under it,
 * unwrapped. The same will hold for the render blocks when they arrive — a
 * business map or a scan is not a remark.
 *
 * ## The one piece of motion this screen has not grown yet
 *
 * Messages that dissolve. They belong to exactly one situation and it is not
 * this one: while a render block is running, Nova can narrate what she is
 * doing at that moment, and those lines are snapshots — once the block has
 * finished they were never events, so they may remove themselves. What stays
 * is the log, which is why this is safe at all.
 *
 * Three rules travel with it, and the first is the one that makes it usable:
 * nothing carrying a decision or a price ever dissolves. A control that goes
 * away under a cursor is the worst interaction a surface can have. Second, a
 * line dissolves because it stopped being true, never on a timer — a timer is
 * a claim about how fast somebody reads. Third, under `prefers-reduced-motion`
 * it never appears rather than appearing and vanishing.
 *
 * ## What is a fixture here and what is not
 *
 * The sentences, the ranking, the words, the prices and the activity labels
 * are all the product's. The rows behind them are fixtures, and the read
 * marker is a constant, because no table stores one yet — that is the piece
 * this study exists to justify before it is built.
 */

function rise(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

const STUDY_BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

/** Where "now" is, so every relative time on this page is stable in a screenshot. */
const NOW = Date.parse("2026-09-06T09:10:00.000Z");

/**
 * The last moment this founder looked at this project.
 *
 * A constant here and a stored column later. Everything above it in the thread
 * happened while they were away.
 */
const LAST_SEEN = Date.parse("2026-09-05T18:30:00.000Z");

const ACTIVITY_RECORDS: AuditEventRecord[] = [
  {
    id: "act-1",
    eventType: "agent_execution.change_verified",
    createdAt: "2026-09-06T08:40:00.000Z",
    metadata: { commitSha: "9f2c41ab77e3d5" },
  },
  {
    id: "act-2",
    eventType: "agent_execution.completed",
    createdAt: "2026-09-06T08:38:00.000Z",
    metadata: {},
  },
  {
    id: "act-3",
    eventType: "agent_execution.started",
    createdAt: "2026-09-06T07:55:00.000Z",
    metadata: {},
  },
  {
    id: "act-4",
    eventType: "business_audit.completed",
    createdAt: "2026-09-05T17:20:00.000Z",
    metadata: {},
  },
  {
    id: "act-5",
    eventType: "business_audit.question_answered",
    createdAt: "2026-09-05T16:58:00.000Z",
    metadata: {},
  },
];

/** A run in flight, so the rail has a present tense. */
const RUNNING: OperationView = {
  operationId: "op_wireframe",
  status: "running",
  stage: "reading_code",
  startedAt: "2026-09-06T09:02:00.000Z",
  completedAt: null,
  failureCode: null,
  resultId: null,
  shouldPoll: true,
  retryAllowed: false,
  stalled: false,
};

/** Several things open at once, which is the case a single-moment study hides. */
const FACTS: NovaFocusFacts = {
  ...NO_FACTS,
  changes: [
    {
      preparedChangeId: "change_wireframe",
      stage: "review_required",
      headline: "Two files changed on a branch of their own",
    },
  ],
  moves: [{ id: "move_wireframe", rank: 1, title: "Add a pricing page" }],
  auditOutdated: true,
  working: RUNNING,
};

/**
 * A plan, as `action-plans` already models one.
 *
 * The rail's list is not a second ranking somebody invented for this screen.
 * `ActionPlanStep` carries `order` and `dependsOn`; `firstActionableStep`
 * decides which one is the entry point; `stepDisplayState` and
 * `stepSequenceStatus` say what each row reads. All four already exist and
 * already drive the Action Plan page — this is the same answer, at rail width.
 *
 * That is what makes the list a *sequence* rather than a bag of open items.
 * "Waiting for step 2" is a fact about dependencies, not a status somebody
 * assigned, and it is why a founder can read down the column and see the order
 * the work has to happen in.
 */
function step(
  order: number,
  title: string,
  actor: ActionPlanStep["actor"],
  dependsOn: number[],
): ActionPlanStep {
  return {
    id: `step_${order}`,
    order,
    title,
    description: "",
    purpose: "",
    actor,
    changeKind: actor === "vibe" ? "product_change" : "decision",
    completionCriteria: "",
    dependsOn,
    evidenceIds: [],
    founderInputRequirement: null,
    executionSupport:
      actor === "vibe"
        ? "vibe_executes_now"
        : actor === "founder_decision"
          ? "founder_decides"
          : "founder_acts",
    capability: null,
    requiresApproval: false,
  };
}

const PLAN: ActionPlanStep[] = [
  step(1, "Read what the site promises today", "vibe", []),
  step(2, "Decide who the pricing page is for", "founder_decision", [1]),
  step(3, "Write the pricing page", "vibe", [2]),
  step(4, "Put the price on the home page", "vibe", [3]),
  step(5, "Tell your existing customers", "founder_action", [4]),
];

/** Steps already carried out. A fixture here, a stored set in the product. */
const DONE = new Set([1]);

function ago(at: string): string {
  const minutes = Math.round((NOW - Date.parse(at)) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const AVAILABILITY: NovaAvailability = { state: "online" };

export function StudyWireframe({
  study,
  offline,
}: {
  study: Study;
  /** The maintenance case. The one state no amount of focus ranking says. */
  offline?: boolean;
}) {
  const focus = deriveNovaFocus(FACTS);
  const view = buildNovaHomeView(focus);
  const entries = buildNovaFeed(focus);
  const activity = buildActivityFeed(ACTIVITY_RECORDS);

  const working = view.working;
  const presence = novaPresenceState({
    tier: view.primary.tier,
    phase: working?.phase ?? "idle",
  });
  const status = statusForCandidate(view.primary.kind);

  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  const choice = entries.find(
    (entry): entry is Extract<NovaEntry, { kind: "nova.choice" }> => entry.kind === "nova.choice",
  );
  const bubbles = speechBubbles(
    entries.filter(
      (entry): entry is Extract<NovaEntry, { kind: "nova.message" }> =>
        entry.kind === "nova.message",
    ),
  );

  /* Oldest first: a thread reads downward, and the log arrives newest first. */
  const past = [...activity].reverse();
  const seen = past.filter((entry) => Date.parse(entry.at) <= LAST_SEEN);
  const since = past.filter((entry) => Date.parse(entry.at) > LAST_SEEN);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 max-sm:px-3 max-sm:py-4">
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
        {/* ── The rail: Nova, and what is open ───────────────────────── */}
        {/*
          Second on a phone. The rail is the work column and the thread is the
          conversation, and a founder who opens this on a phone came for the
          conversation — putting the whole plan and the whole log above it means
          scrolling past everything to reach the one thing that speaks.
        */}
        <aside className="study-rise flex flex-col gap-5 max-lg:order-2" style={rise(0)}>
          <div className={`flex flex-col gap-5 p-5 ${panel}`}>
            <div className="flex flex-col items-center gap-4 text-center">
              <NovaPresence state={presence} seed="project_e2e" size="hero" />
              {/*
                No name and no state word under the mark. "NOVA / Working" was
                the mark's own two facts written out again underneath it in
                case it did not read — and if a mark does not read, the answer
                is the mark, not a caption apologising for it.

                What replaces it is the stage: what she is doing, in a sentence,
                with no box around it. The box was a card built for one line.
              */}
              {working && <Thinking>{working.stageLabel}</Thinking>}
            </div>

            <Plan />

            <Earlier seen={seen} since={since} />
          </div>

          <div className={`flex flex-col gap-3 p-4 ${panel}`}>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-nav border border-line-3 bg-surface-2 text-caption font-semibold text-fg"
              >
                P
              </span>
              <div className="min-w-0">
                <p className="truncate text-ui font-semibold text-fg">Payflow</p>
                <p className="truncate text-caption text-fg-meta">Developer tool</p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── The thread: what happened, then what is true now ────────── */}
        <section
          className="study-rise flex flex-col gap-3 max-lg:order-1"
          style={rise(1)}
          aria-label="Nova"
        >
          <Header
            availability={
              offline
                ? { state: "offline", because: "maintenance until 11:00 UTC" }
                : AVAILABILITY
            }
            subject="Payflow"
            mark={<NovaPresence state={presence} seed="project_e2e" size="sm" />}
            now={<Clock />}
          />

          {/*
            The chat panel holds bubbles and nothing else.

            The log used to sit at the top of it, under a heading, and it was
            wrong for a reason that took saying out loud: this box is the place
            Nova speaks. A row that reads "Vibe finished a change · 32m" is not
            something she is saying, it is something that happened, and putting
            it in the same container makes the container mean two things. It is
            in the rail now, which is the column about the work.
          */}
          <div className={`flex flex-col gap-1 p-5 max-sm:p-3.5 ${panel}`}>
            {/* ── Now: what she has to say about it ───────────────────── */}
            <div className="flex flex-col gap-1.5 pt-3">
              {bubbles.map((bubble, position) => (
                <Bubble
                  key={bubble.key}
                  tone={status.tone}
                  open={status.open}
                  aside={bubble.aside}
                  tail={bubble.tail}
                  index={position}
                >
                  {bubble.paragraphs.map((text) =>
                    bubble.aside ? (
                      <Context key={text}>{text}</Context>
                    ) : (
                      <Line key={text}>{text}</Line>
                    ),
                  )}
                </Bubble>
              ))}

              {/*
                She is composing, and the product observed it. Bound to the
                operations view's own `working` phase and unreachable on any
                other, so a borrowed chat idiom never implies somebody is at a
                keyboard when nothing is running.
              */}
              {working?.phase === "working" && <Typing />}

              {choice && (
                /*
                  The control is **outside** the bubble. A bubble means Nova is
                  saying something; a Move is something the founder can do, and
                  a button inside a speech bubble makes those one object when
                  they are two. Only the question is speech.
                */
                <>
                  {choice.prompt && (
                    <Bubble
                      tone={status.tone}
                      open={status.open}
                      tail={bubbles.at(-1)?.aside ?? true}
                      index={bubbles.length}
                    >
                      <Line>{choice.prompt}</Line>
                    </Bubble>
                  )}
                  <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">
                    {choice.options.map((option) => (
                      <Move
                        key={option.actionId}
                        label={option.label}
                        operation={option.price}
                        balance={STUDY_BALANCE}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * What has happened, in the column about the work.
 *
 * Two groups and one line between them. Everything under the line happened
 * while the founder was away — the only thing on this screen that knows
 * anything about the person reading it, and the one piece of state no
 * derivation produces.
 */
function Earlier({
  seen,
  since,
}: {
  seen: ReturnType<typeof buildActivityFeed>;
  since: ReturnType<typeof buildActivityFeed>;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line-1 pt-4">
      <Label>Earlier</Label>
      <div className="flex flex-col">
        {seen.map((entry) => (
          <Happened key={entry.id} title={entry.title} at={ago(entry.at)} tone={entry.tone} />
        ))}
      </div>
      {since.length > 0 && <SinceDivider>While you were away</SinceDivider>}
      <div className="flex flex-col">
        {since.map((entry) => (
          <Happened
            key={entry.id}
            title={entry.title}
            at={ago(entry.at)}
            tone={entry.tone}
            facts={entry.facts}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The to-do list, in plan order.
 *
 * ## Why this is a sequence and not a list of open things
 *
 * The rail used to show the focus candidates — three rows saying what needed
 * attention. That is a set, and a founder reading it cannot tell what has to
 * happen before what. A plan is ordered, and the order is the useful part:
 * *decide who this is for, then write it, then put the price on the home page,
 * then tell your customers.*
 *
 * None of that ordering is invented here. `dependsOn` is the plan's own,
 * `firstActionableStep` picks the entry point the Action Plan page picks, and
 * `stepSequenceStatus` writes "Waiting for step 2: …" — a fact about
 * dependencies rather than a status somebody assigned.
 *
 * ## The three marks, and why none of them is a percentage
 *
 * A filled square is carried out. A ring is the step to work on now. A hollow
 * outline is waiting, and its row says what for. There is no bar and no "2 of
 * 5 complete" figure, because a plan whose steps are a decision, a piece of
 * writing and a phone call has no honest fraction — and `planMetaSummary`
 * already refuses to invent one.
 */
function Plan() {
  const current = firstActionableStep(PLAN, DONE);

  return (
    <div className="flex flex-col gap-2.5">
      <Label>To do</Label>
      <ol className="flex flex-col gap-2">
        {PLAN.map((entry) => {
          const display = stepDisplayState(entry, current?.order ?? null, DONE);
          const sequence = stepSequenceStatus(entry, PLAN, display);
          const here = display === "start_here";
          const done = display === "done" || display === "covered";

          return (
            <li key={entry.id} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={`mt-1 size-2.5 shrink-0 rounded-[3px] border ${
                  done
                    ? "border-mint bg-mint"
                    : here
                      ? "border-mint bg-mint-tint"
                      : "border-line-strong"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`text-caption ${
                    here ? "font-semibold text-fg" : done ? "text-fg-meta" : "text-fg-secondary"
                  }`}
                >
                  {entry.title}
                </p>
                {/*
                  Only where it says something the title does not. "Ready now"
                  under every waiting row would be noise; "Waiting for step 2"
                  is the sequencing a founder came here to read.
                */}
                {(here || sequence.state === "waiting" || done) && (
                  <p className="text-caption text-fg-meta">
                    {here ? "Working on this" : sequence.label}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Nova composing, in the shape a phone taught everybody. */
function Typing() {
  return (
    <div
      className="bubble bubble-neutral flex w-fit items-center gap-1.5 px-3.5 py-3"
      role="status"
      aria-label="Nova is working"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden
          className="study-typing size-1.5 rounded-full bg-fg-muted"
          /* Only the offset is inline; the animation is a class so the shell's
             hidden-tab pause and the reduced-motion block can both reach it. */
          style={{ animationDelay: `${index * 0.18}s` }}
        />
      ))}
    </div>
  );
}
