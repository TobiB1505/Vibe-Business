import type { CSSProperties, ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { novaPresenceState, statusForOperationPhase } from "@/components/system/status-vocabulary";
import { NovaPresence } from "@/components/nova/nova-presence";
import { creditsToUnits } from "@/modules/credits/units";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import { buildNovaFeed, type NovaEntry } from "@/modules/nova/feed";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import type { OperationView } from "@/modules/operations/view";
import { novaScenarioHealth } from "../nova-scenarios";
import type { Study } from "./studies";

/**
 * Nova as a presence you can read along with (S0, console track).
 *
 * ## What moved from the chat study
 *
 * There the mark travelled with the speech — one avatar per run of bubbles,
 * a tail joining them. Here it comes out of the thread entirely and takes the
 * left column as a standing box: the avatar large, the state word beneath it,
 * and under that a running account of what Vibe has been doing. The thread on
 * the right keeps the messages and loses the avatar, so it reads as things
 * arriving rather than as somebody leaning in each time.
 *
 * The trade is real and worth naming. The chat study makes it obvious *who* is
 * talking; this one makes it obvious *that she is working*, continuously, in a
 * place that does not move while the thread grows. Which matters more is the
 * question these two studies exist to put side by side.
 *
 * ## The trace is what Vibe did, never what a model thought
 *
 * This is the one line in this study that is not a design choice. Rule 43
 * forbids rendering model reasoning, and `DESIGN.md` says what may stand in
 * its place: *what Vibe recorded itself doing — files read, files written,
 * stages entered — and never a model's account of its own thinking.*
 *
 * So the box shows two things and neither is invented. The **present** line is
 * `OPERATION_STAGE_LABELS[stage]` — the stage the executor actually wrote, which
 * is also why there is no bar beside it: a durable operation has no honest
 * fraction, and the stage name says more than a percentage could. The **past**
 * lines are `audit_events` rows through `buildActivityFeed`, which is the
 * product's own record with its own label table.
 *
 * A reader gets the "watch it work" feeling either way. What they do not get is
 * a stream of sentences a model wrote about itself, which would be the version
 * of this that reads best and is not allowed.
 *
 * ## Why the box does not breathe when nothing is running
 *
 * `novaPresenceState` derives the mark from the tier and the operation phase,
 * so an idle project gets a still mark and no present-tense line. A box that
 * kept moving over a settled project would be the animated form of a status
 * line narrating work nobody is doing.
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

const ACTIVITY_RECORDS: AuditEventRecord[] = [
  {
    id: "act-1",
    eventType: "agent_execution.started",
    createdAt: "2026-09-06T01:52:00.000Z",
    metadata: {},
  },
  {
    id: "act-2",
    eventType: "business_audit.completed",
    createdAt: "2026-09-06T00:40:00.000Z",
    metadata: {},
  },
  {
    id: "act-3",
    eventType: "agent_execution.change_verified",
    createdAt: "2026-09-05T16:04:00.000Z",
    metadata: { commitSha: "9f2c41ab77e3d5" },
  },
  {
    id: "act-4",
    eventType: "deep_scan.completed",
    createdAt: "2026-09-04T09:25:00.000Z",
    metadata: {},
  },
];

const NOW = Date.parse("2026-09-06T02:00:00.000Z");

function ago(at: string): string {
  const minutes = Math.round((NOW - Date.parse(at)) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const TONE_DOT: Record<string, string> = {
  success: "bg-mint",
  waiting: "bg-amber",
  problem: "bg-coral",
  neutral: "bg-fg-disabled",
};

/** A run in flight, so the box has a present tense to show. */
const RUNNING: OperationView = {
  operationId: "op_console",
  status: "running",
  stage: "reading_code",
  startedAt: "2026-09-06T01:52:00.000Z",
  completedAt: null,
  failureCode: null,
  resultId: null,
  shouldPoll: true,
  retryAllowed: false,
  stalled: false,
};

function facts(working: OperationView | null): NovaFocusFacts {
  return {
    sourceDisconnected: false,
    failedOperations: { agent: false, scan: false, audit: false },
    stalledOperations: { agent: false, scan: false, audit: false },
    changes: [
      {
        preparedChangeId: "change_console",
        stage: "review_required",
        headline: "Two files changed on a branch of their own",
      },
    ],
    questions: [],
    moves: [{ id: "move_console", rank: 1, title: "Add a pricing page" }],
    plannedMoveId: null,
    executableStep: null,
    planOffered: false,
    auditOutdated: true,
    repositoryReadOutdated: false,
    workspaceChoiceRequired: false,
    working,
  };
}

/**
 * Nova composing, in the shape a phone taught everybody (WhatsApp reference).
 *
 * ## Why this one is admissible and a shimmer over a paused run is not
 *
 * `DESIGN.md` gives decorative "thinking" motion three properties, and a typing
 * bubble either has all of them or it is a lie:
 *
 * - **Bound to an observed state.** It renders only while `phase === "working"`
 *   — an operation the product recorded as running. It is unreachable on
 *   pending, waiting, stalled and failed, which is exactly where a borrowed
 *   chat idiom would otherwise imply somebody is at the keyboard.
 * - **Removable without loss.** Every sentence in the thread and the stage in
 *   the left box are legible with it gone. Turn it off and the founder knows
 *   the same things.
 * - **Carrying no timing.** Three dots on a fixed 1.4s cycle, unrelated to how
 *   long the run has taken or has left. A rhythm that accelerated with apparent
 *   progress would be a percentage nobody measured.
 *
 * What it must never become is the thing that tells a founder work is
 * happening. The state word and the stage do that; this decorates them.
 */
function Typing() {
  return (
    <div
      className="flex w-fit items-center gap-1.5 rounded-card border border-line-2 bg-surface-1 px-4 py-3.5"
      /* Announced once as a state rather than as three animating dots. */
      role="status"
      aria-label="Nova is working"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden
          className="study-typing size-1.5 rounded-full bg-fg-muted"
          /* Only the offset is inline; the animation itself is a class so the
             shell's hidden-tab pause and the reduced-motion block can reach
             it. An inline `animation` is unreachable by both, which is how the
             first draft of this quietly broke two of the three obligations. */
          style={{ animationDelay: `${index * 0.18}s` }}
        />
      ))}
    </div>
  );
}

/** One message, arriving. No mark — the speaker stands in the left box. */
function Says({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "note" }) {
  return (
    <div
      className={`min-w-0 max-w-[52ch] rounded-card border px-4 py-3 ${
        tone === "note"
          ? "border-line-2 bg-surface-1 text-fg-secondary"
          : "border-line-3 bg-surface-3 text-fg-body"
      }`}
    >
      {children}
    </div>
  );
}

export function StudyConsole({ study, idle }: { study: Study; idle?: boolean }) {
  const focus = deriveNovaFocus(facts(idle ? null : RUNNING));
  const entries = buildNovaFeed(focus);
  const view = buildNovaHomeView(focus);
  const health = novaScenarioHealth("nova-review");
  const activity = buildActivityFeed(ACTIVITY_RECORDS);

  const working = view.working;
  const presence = novaPresenceState({
    tier: view.primary.tier,
    phase: working?.phase ?? "idle",
  });
  const status = working ? statusForOperationPhase(working.phase) : null;

  const glass = study.skin === "glass";
  const panel = glass
    ? "study-glass rounded-panel"
    : "rounded-panel border border-line-2 bg-surface-1";

  const choice = entries.find(
    (entry): entry is Extract<NovaEntry, { kind: "nova.choice" }> => entry.kind === "nova.choice",
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <ConsoleChrome idle={idle} />

      <div className="grid gap-8 lg:grid-cols-[320px_1fr] lg:items-start">
        {/* ── Left: Nova, standing ───────────────────────────────────── */}
        <aside className="study-rise flex flex-col gap-6" style={rise(0)}>
          <div className={`flex flex-col gap-5 p-6 ${panel}`}>
            <div className="flex flex-col items-center gap-4 text-center">
              <NovaPresence state={presence} seed="project_e2e" size="hero" />
              <div className="flex flex-col gap-1">
                <Label>Nova</Label>
                {/*
                  The state word, not a colour and not the mark alone. The mark
                  says the same thing more precisely, and a reader who cannot
                  see it still knows.
                */}
                <p className="text-ui font-semibold text-fg">
                  {status ? status.word : "Nothing running"}
                </p>
              </div>
            </div>

            {/*
              The present tense: the stage the executor wrote. No bar beside
              it — a durable operation has no honest fraction, and the stage
              name carries more than a percentage would.
            */}
            {working && (
              <div className="flex flex-col gap-1.5 rounded-well bg-well px-4 py-3">
                <Label>Right now</Label>
                <p className="text-ui text-fg-body">{working.stageLabel}</p>
              </div>
            )}

            {/*
              The past tense: rows the product wrote when it acted. Read along
              here rather than in the thread, because a completed job is
              something Vibe *did*, not something Nova said to anybody.
            */}
            <div className="flex flex-col gap-2.5">
              <Label>{working ? "Before that" : "What I have done"}</Label>
              <ul className="flex flex-col gap-2.5">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${TONE_DOT[entry.tone] ?? TONE_DOT.neutral}`}
                    />
                    <span className="min-w-0 flex-1 text-caption text-fg-secondary">
                      {entry.title}
                    </span>
                    <span className="shrink-0 font-mono text-caption text-fg-meta tabular-nums">
                      {ago(entry.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* The project this is all about, kept small under her. */}
          <div className={`flex flex-col gap-3 p-5 ${panel}`}>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-nav border border-line-3 bg-surface-2 text-caption font-semibold text-fg"
              >
                P
              </span>
              <div className="min-w-0">
                <p className="truncate text-ui font-semibold text-fg">Payflow</p>
                <p className="truncate text-caption text-fg-meta">Developer tool</p>
              </div>
            </div>
            {health && (
              <div className="flex items-baseline gap-2 border-t border-line-1 pt-3">
                <span className="text-title font-semibold tabular-nums text-fg">
                  {health.score ?? "—"}
                </span>
                <span className="text-caption text-fg-meta">/ 100</span>
                <span className="ml-auto text-caption text-fg-prose">{health.stateLabel}</span>
              </div>
            )}
          </div>
        </aside>

        {/* ── Right: what arrives ────────────────────────────────────── */}
        <section
          className={`study-rise flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}
          style={rise(1)}
          aria-label="Nova"
        >
          {entries.map((entry) => {
            if (entry.kind === "nova.message") {
              return (
                <Says key={entry.id} tone={entry.emphasis === "aside" ? "note" : "default"}>
                  <p className={entry.emphasis === "aside" ? "text-caption" : "text-ui"}>
                    {entry.text}
                  </p>
                </Says>
              );
            }

            /*
              The progress entry stays out of the thread here, and that is the
              whole point of moving the mark left. `buildNovaFeed` emits it
              because a transcript has nowhere else to put a running stage; this
              layout does — the box owns the present tense. Rendering both put
              "Reading what you built" on screen twice, once in each column,
              which is the same defect `footnoteFor` exists to stop on the Focus
              Card and `working-strip.tsx` fixed for itself before that.
            */
            return null;
          })}

          {/*
            She is composing, and the product observed it. Placed last in the
            thread because that is where the next thing will arrive.
          */}
          {working?.phase === "working" && <Typing />}

          {choice && (
            <div className="flex flex-col gap-3 pt-1">
              <p className="text-caption text-fg-meta">{choice.prompt}</p>
              <div className="flex flex-wrap gap-2.5">
                {choice.options.map((option) => (
                  <span
                    key={option.actionId}
                    className="study-press flex items-center gap-3 rounded-nav border border-mint-line bg-mint-tint-soft px-4 py-2.5 text-ui font-semibold text-mint"
                  >
                    {option.label}
                    <CostDisclosure operation={option.price} balance={STUDY_BALANCE} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ConsoleChrome({ idle }: { idle?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Label>Console study</Label>
        <p className="text-title font-semibold text-fg">
          Nova stands on the left{idle ? " — nothing running" : ""}
        </p>
      </div>
      <p className="study-measure text-caption text-fg-prose">
        The mark leaves the thread and takes a standing box: her state, what she is doing right now,
        and what she did before that. Messages arrive on the right without an avatar, because the
        speaker is already on screen and does not move while the thread grows.
      </p>
      <p className="study-measure text-caption text-fg-secondary">
        {idle
          ? "Nothing is running, so there is no present tense and the mark is still. A box that kept moving over a settled project would be narrating work nobody is doing."
          : "The trace is what Vibe recorded itself doing — the stage the executor wrote, then the rows it wrote when it acted. Never a model's account of its own thinking, which is the version that would read best and is not allowed."}
      </p>
    </div>
  );
}
