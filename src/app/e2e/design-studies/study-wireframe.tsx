import type { CSSProperties, ReactNode } from "react";
import { NovaPresence } from "@/components/nova/nova-presence";
import {
  novaPresenceState,
  statusForCandidate,
  statusForOperationPhase,
} from "@/components/system/status-vocabulary";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import { creditsToUnits } from "@/modules/credits/units";
import { buildNovaFeed, type NovaEntry } from "@/modules/nova/feed";
import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { buildNovaHomeView, type NovaHomeEntry } from "@/modules/nova/home-view";
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
} from "./elements";
import { NO_FACTS } from "./moment-fixtures";
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
 * What this item asks of the founder, in the catalog's own words.
 *
 * A to-do list has to name a task, and `entry.message` is a sentence Nova
 * says rather than a thing to do. The control's label is the thing to do, and
 * it is the same string the button in the thread carries — a rail that invented
 * its own second vocabulary is a rail nobody can match against the thread.
 */
function taskOf(entry: NovaHomeEntry): string | null {
  switch (entry.control.kind) {
    case "server_action":
    case "navigation":
      return entry.control.option.label;
    case "elsewhere":
      return entry.control.label;
    case "none":
      return null;
  }
}

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
  const workStatus = working ? statusForOperationPhase(working.phase) : null;
  const status = statusForCandidate(view.primary.kind);

  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  const choice = entries.find(
    (entry): entry is Extract<NovaEntry, { kind: "nova.choice" }> => entry.kind === "nova.choice",
  );
  const messages = entries.filter(
    (entry): entry is Extract<NovaEntry, { kind: "nova.message" }> =>
      entry.kind === "nova.message",
  );

  /* Oldest first: a thread reads downward, and the log arrives newest first. */
  const past = [...activity].reverse();
  const seen = past.filter((entry) => Date.parse(entry.at) <= LAST_SEEN);
  const since = past.filter((entry) => Date.parse(entry.at) > LAST_SEEN);

  /* Everything the founder could act on, which is what the rail lists. */
  const open = [view.primary, ...view.secondary];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 max-sm:px-3 max-sm:py-4">
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
        {/* ── The rail: Nova, and what is open ───────────────────────── */}
        <aside className="study-rise flex flex-col gap-5" style={rise(0)}>
          <div className={`flex flex-col gap-5 p-5 ${panel}`}>
            <div className="flex flex-col items-center gap-3.5 text-center">
              <NovaPresence state={presence} seed="project_e2e" size="hero" />
              <div className="flex flex-col gap-1">
                <Label>Nova</Label>
                {/*
                  The work state, which is a different question from the header's
                  availability. Online says the service is reachable; this says
                  what she is doing with it.
                */}
                <p className="text-ui font-semibold text-fg">
                  {workStatus ? workStatus.word : "Nothing running"}
                </p>
              </div>
            </div>

            {working && (
              <div className="flex flex-col gap-1.5 rounded-well bg-well px-3.5 py-3">
                <Label>Right now</Label>
                {/* The stage the executor wrote. No bar: a durable operation has
                    no honest fraction, and the stage says more than one could. */}
                <p className="text-ui text-fg-body">{working.stageLabel}</p>
              </div>
            )}

            {/*
              The list the wireframe puts under her state. Not a second thread —
              the thread is the conversation and this is the inventory, which is
              why it carries words and no sentences.
            */}
            {/*
              The list the wireframe puts under her state. Not a second thread —
              the thread is the conversation and this is the inventory, so each
              row names the *task* rather than repeating the sentence. The task
              is the action catalog's own label, which is also what the control
              in the thread says: one vocabulary, not two.
            */}
            <div className="flex flex-col gap-2.5">
              <Label>Open · {open.length}</Label>
              <ul className="flex flex-col gap-2">
                {open.map((entry) => {
                  const entryStatus = statusForCandidate(entry.kind);
                  return (
                    <li key={entry.id} className="flex items-start gap-2.5">
                      {/*
                        The same two axes the Bubble draws, at list scale: a
                        square for a settled item, a hollow one for an open
                        loop. Colour is the third signal, never the only one.
                      */}
                      <span
                        aria-hidden
                        className={`mt-1 size-2 shrink-0 rounded-[2px] border ${
                          entryStatus.tone === "problem"
                            ? "border-coral"
                            : entryStatus.tone === "waiting"
                              ? "border-amber"
                              : entryStatus.tone === "active"
                                ? "border-mint"
                                : "border-line-strong"
                        } ${
                          entryStatus.open
                            ? ""
                            : entryStatus.tone === "problem"
                              ? "bg-coral"
                              : entryStatus.tone === "waiting"
                                ? "bg-amber"
                                : entryStatus.tone === "active"
                                  ? "bg-mint"
                                  : "bg-line-strong"
                        }`}
                      />
                      <span className="min-w-0 flex-1 text-caption text-fg-secondary">
                        {taskOf(entry) ?? entryStatus.word}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
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
        <section className="study-rise flex flex-col gap-3" style={rise(1)} aria-label="Nova">
          <Header
            availability={
              offline
                ? { state: "offline", because: "maintenance until 11:00 UTC" }
                : AVAILABILITY
            }
            subject="Payflow"
            mark={<NovaPresence state={presence} seed="project_e2e" size="sm" />}
          />

          <div className={`flex flex-col gap-1 p-5 max-sm:p-3.5 ${panel}`}>
            {/* ── Earlier: the log, oldest first ──────────────────────── */}
            <Label>Earlier</Label>
            <div className="flex flex-col divide-y divide-line-1 pb-1">
              {seen.map((entry) => (
                <Happened
                  key={entry.id}
                  title={entry.title}
                  at={ago(entry.at)}
                  tone={entry.tone}
                  facts={entry.facts}
                />
              ))}
            </div>

            {/*
              The only line on this screen that knows anything about the person
              reading it. Everything under it happened while they were away.
            */}
            {since.length > 0 && <SinceDivider>While you were away</SinceDivider>}

            <div className="flex flex-col divide-y divide-line-1 pb-2">
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

            {/* ── Now: what she has to say about it ───────────────────── */}
            <div className="flex flex-col gap-2.5 pt-3">
              {messages.map((entry, position) => {
                const aside = entry.emphasis === "aside";
                const previous = messages[position - 1];
                const speaking = previous ? previous.emphasis !== "aside" : false;
                return (
                  <Bubble
                    key={entry.id}
                    tone={status.tone}
                    open={status.open}
                    aside={aside}
                    tail={!speaking}
                    index={position}
                  >
                    {aside ? <Context>{entry.text}</Context> : <Line>{entry.text}</Line>}
                  </Bubble>
                );
              })}

              {/*
                She is composing, and the product observed it. Bound to the
                operations view's own `working` phase and unreachable on any
                other, so a borrowed chat idiom never implies somebody is at a
                keyboard when nothing is running.
              */}
              {working?.phase === "working" && <Typing />}

              {choice && (
                <Bubble
                  tone={status.tone}
                  open={status.open}
                  tail={messages.at(-1)?.emphasis === "aside"}
                  wide
                  index={messages.length}
                >
                  {choice.prompt && <Context>{choice.prompt}</Context>}
                  <div className="flex flex-col gap-2.5">
                    {choice.options.map((option) => (
                      <Move
                        key={option.actionId}
                        label={option.label}
                        operation={option.price}
                        balance={STUDY_BALANCE}
                      />
                    ))}
                  </div>
                </Bubble>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Nova composing, in the shape a phone taught everybody. */
function Typing() {
  return (
    <div
      className="flex w-fit items-center gap-1.5 rounded-card border border-line-2 bg-surface-1 px-4 py-3.5"
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
