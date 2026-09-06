import type { CSSProperties, ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { statusForFocusTier, novaPresenceState } from "@/components/system/status-vocabulary";
import { NovaPresence } from "@/components/nova/nova-presence";
import { creditsToUnits } from "@/modules/credits/units";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { NovaHomeEntry, NovaHomeView } from "@/modules/nova/home-view";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { novaScenarioHealth, novaScenarioView, NOVA_SCENARIO_PRIORITY } from "../nova-scenarios";
import type { Study } from "./studies";

/**
 * Nova Home as Nova speaking (S0, voice track).
 *
 * ## The argument
 *
 * `home-view.ts` states the split this study reopens: *the feed is a linear
 * transcript — message, control, progress, asides — and Home is a composition:
 * one dominant card, a working strip, a short stack.* Two projections of one
 * set of facts, and Home took the composition.
 *
 * The cost of that choice only shows when you look at the two screens
 * together. During onboarding Nova **talks**: `NovaFeed`, `NovaMessage` and
 * `NovaChoice` are mounted, she introduces herself, she asks and the founder
 * answers. Then they arrive at Home and she becomes a 72-pixel mark in the
 * corner of a card, while the sentence she would have said is set as an `h1`.
 * The words did not change — `entry.message` is already written *to* a person,
 * *There is a change waiting for you to look at.* — only who appears to be
 * saying them did.
 *
 * So this study changes nothing about what Home knows and everything about who
 * is speaking. Nova leads at `hero`, her sentence is speech rather than a
 * heading, her control follows it the way an answer follows a question, and
 * the ranked points come after — the shape of a conversation, with no input.
 *
 * ## Why there is no composer, and why that is the point
 *
 * `nova-feed.tsx` already argues it: *not a chat. There is no input, no
 * history and nothing to scroll back through* — the surface is a render of
 * current state, rebuilt on every read, and `audit_events` is the product's
 * record. A text box would promise a conversation the product cannot hold and
 * a transcript it deliberately does not keep.
 *
 * What the chat grammar is borrowed for is the *address*: an avatar beside a
 * sentence, at a size that makes the speaker present. A founder should see
 * that they are being talked to rather than handed a summary.
 *
 * ## What the ranks become
 *
 * The three ranks from `study-composition` survive; what changes is the first
 * one's grammar. Rank 1 is Nova saying one thing. Rank 2 is what else is true,
 * subordinate to her. Rank 3 is the record. Nothing about the ranking moved —
 * `deriveNovaFocus` still decides, `statusForFocusTier` still supplies every
 * status word, and `novaPresenceState` derives the mark's state from the tier
 * and the operation phase rather than the study picking one for effect.
 */

/** The stagger index, as a typed custom property rather than a cast. */
function rise(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

const TONE_CLASS: Record<string, string> = {
  active: "border-mint-line bg-mint-tint-soft text-mint",
  waiting: "border-amber-line bg-amber-tint-soft text-amber",
  blocked: "border-coral-line bg-coral-tint-soft text-coral",
  neutral: "border-line-3 bg-surface-2 text-fg-secondary",
  done: "border-line-3 bg-surface-2 text-fg-secondary",
};

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-label font-semibold tracking-[0.14em] uppercase ${
        TONE_CLASS[tone] ?? TONE_CLASS.neutral
      }`}
    >
      {children}
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

const STUDY_BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

function retailKindOf(entry: NovaHomeEntry): RetailOperationKind | null {
  const control = entry.control;
  if (control.kind !== "server_action" && control.kind !== "navigation") return null;
  return NOVA_ACTION_META[control.option.actionId].price;
}

function controlLabelOf(entry: NovaHomeEntry): string | null {
  const control = entry.control;
  if (control.kind === "none") return null;
  if (control.kind === "elsewhere") return control.label;
  return control.option.label;
}

const ACTIVITY_RECORDS: AuditEventRecord[] = [
  {
    id: "act-1",
    eventType: "business_audit.completed",
    createdAt: "2026-09-06T00:40:00.000Z",
    metadata: {},
  },
  {
    id: "act-2",
    eventType: "agent_execution.completed",
    createdAt: "2026-09-05T16:10:00.000Z",
    metadata: { commitSha: "9f2c41ab77e3d5" },
  },
  {
    id: "act-3",
    eventType: "deep_scan.completed",
    createdAt: "2026-09-04T09:25:00.000Z",
    metadata: {},
  },
];

const NOW = Date.parse("2026-09-06T02:00:00.000Z");

function ago(at: string): string {
  const hours = Math.round((NOW - Date.parse(at)) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

const TONE_DOT: Record<string, string> = {
  success: "bg-mint",
  waiting: "bg-amber",
  problem: "bg-coral",
  neutral: "bg-fg-disabled",
};

/** Five things true at once — the same fixture the composition study uses. */
const DENSE_FACTS: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: true, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [
    {
      preparedChangeId: "change_dense",
      stage: "review_required",
      headline: "Two files changed on a branch of their own",
    },
  ],
  questions: [
    {
      founderInputRequestId: "fir_dense",
      question: "Which of the two checkout flows should stay?",
      origin: "planner",
      stepOrder: 2,
    },
  ],
  moves: [
    { id: "move_dense_1", rank: 1, title: "Add a pricing page" },
    { id: "move_dense_2", rank: 2, title: "Publish the changelog" },
  ],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: true,
  repositoryReadOutdated: true,
  workspaceChoiceRequired: false,
  working: null,
};

export function StudyVoice({
  study,
  settled,
  dense,
}: {
  study: Study;
  settled?: boolean;
  dense?: boolean;
}) {
  const scenario = settled ? ("nova-settled" as const) : ("nova-review" as const);
  const view: NovaHomeView = dense
    ? buildNovaHomeView(deriveNovaFocus(DENSE_FACTS))
    : novaScenarioView(scenario);
  const health = novaScenarioHealth(scenario);
  const primary = view.primary;
  const status = statusForFocusTier(primary.tier);
  const action = controlLabelOf(primary);
  const activity = buildActivityFeed(ACTIVITY_RECORDS);

  /*
   * Derived, never chosen. `novaPresenceState` is the one function that turns
   * a tier and an operation phase into a mark state — a study that set
   * `working` by hand would be animating activity nobody observed, on the one
   * component whose whole doc comment forbids exactly that.
   */
  const presence = novaPresenceState({
    tier: primary.tier,
    phase: view.working?.phase ?? "idle",
  });

  const sectionSkin = "rounded-panel border border-line-2 bg-surface-1";
  const glass = study.skin === "glass";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 max-sm:px-4 max-sm:py-8">
      <VoiceChrome settled={settled} dense={dense} />

      <main className="flex flex-col gap-9">
        {/* ── Who she is talking about ─────────────────────────────── */}
        <header className="study-rise flex flex-wrap items-center gap-3" style={rise(0)}>
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-nav border border-line-3 bg-surface-2 text-caption font-semibold text-fg"
          >
            P
          </span>
          <p className="text-ui text-fg-secondary">
            <span className="font-semibold text-fg">Payflow</span>
            <span className="text-fg-meta"> · Developer tool · Confirmed by you</span>
          </p>
        </header>

        {/*
          ── Nova, speaking ────────────────────────────────────────────
          The avatar beside the sentence, at the size that makes a speaker
          present rather than a mark that labels a card. Everything below is
          indented to her text column, so the page reads as one address with
          its supporting material rather than as four stacked panels.
        */}
        <section
          className="study-rise grid gap-5 sm:grid-cols-[auto_1fr] sm:gap-7"
          style={rise(1)}
          aria-labelledby="voice-lead"
        >
          <div className="flex justify-start">
            <NovaPresence
              state={presence}
              seed="project_e2e"
              size="hero"
              className="max-sm:hidden"
            />
            <NovaPresence state={presence} seed="project_e2e" size="lg" className="sm:hidden" />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Label>Nova</Label>
              <Pill tone={status.tone}>{status.word}</Pill>
            </div>

            {/*
              Speech, not a heading. It is still the page's h1 — one sentence
              naming what the screen is about is exactly what an h1 is for —
              but it is set at reading weight rather than display weight,
              because a person talking to you does not shout.
            */}
            <h1
              id="voice-lead"
              className="study-measure text-headline font-semibold text-balance text-fg"
            >
              {primary.message}
            </h1>

            {primary.detail && (
              <p className="study-measure text-lead text-fg-prose">{primary.detail}</p>
            )}

            {action && (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  className="study-press rounded-nav bg-mint px-5 py-2.5 text-ui font-semibold text-mint-ink"
                >
                  {action}
                </button>
                <CostDisclosure operation={retailKindOf(primary)} balance={STUDY_BALANCE} />
              </div>
            )}
          </div>
        </section>

        {/*
          ── Then the points ───────────────────────────────────────────
          Aligned to her text column on desktop, so they read as the rest of
          what she is telling the founder rather than as a new section of the
          page. Still no controls: the argument in `attention-stack.tsx` is
          untouched by who is speaking.
        */}
        {view.secondary.length > 0 && (
          <section
            className="study-rise sm:grid sm:grid-cols-[auto_1fr] sm:gap-7"
            style={rise(2)}
            aria-labelledby="voice-also"
          >
            <span aria-hidden className="max-sm:hidden sm:w-[132px]" />
            <div className="flex min-w-0 flex-col gap-3">
              <Label>
                <span id="voice-also">Also true</span>
              </Label>
              <ul className={`flex flex-col divide-y divide-line-1 ${sectionSkin}`}>
                {view.secondary.map((entry) => {
                  const entryStatus = statusForFocusTier(entry.tier);
                  return (
                    <li
                      key={entry.id}
                      className="study-press flex items-start gap-3 px-5 py-3.5 hover:bg-surface-hover"
                    >
                      <Pill tone={entryStatus.tone}>{entryStatus.word}</Pill>
                      <span className="min-w-0 flex-1 text-ui text-fg-body">{entry.message}</span>
                      <span aria-hidden className="mt-0.5 text-ui text-fg-meta">
                        →
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {/* ── The reading, with its blocker inside it ───────────────── */}
        {health && (
          <section
            className="study-rise sm:grid sm:grid-cols-[auto_1fr] sm:gap-7"
            style={rise(3)}
            aria-labelledby="voice-health"
          >
            <span aria-hidden className="max-sm:hidden sm:w-[132px]" />
            <div className="flex min-w-0 flex-col gap-3">
              <Label>
                <span id="voice-health">Business health</span>
              </Label>
              <div
                className={`flex flex-col gap-4 p-5 ${glass ? "study-glass rounded-panel" : sectionSkin}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-display font-semibold tabular-nums text-fg">
                    {health.score ?? "—"}
                  </span>
                  <span className="text-caption text-fg-meta">/ 100</span>
                  <span className="text-ui text-fg-prose">{health.stateLabel}</span>
                  <span className="ml-auto text-caption text-fg-secondary">
                    Scored {health.scoredLenses} of {health.eligibleLenses} applicable areas
                  </span>
                </div>

                {health.insufficientCoverageReason && (
                  <p className="text-caption text-amber">{health.insufficientCoverageReason}</p>
                )}

                {health.score !== null && (
                  <div className="flex flex-col items-start gap-2.5 rounded-well bg-well p-4">
                    <Pill tone="blocked">In the way</Pill>
                    <h2 className="text-ui font-semibold text-balance text-fg">
                      {NOVA_SCENARIO_PRIORITY.headline}
                    </h2>
                    <p className="study-measure text-caption text-fg-prose">
                      {NOVA_SCENARIO_PRIORITY.whyItMatters}
                    </p>
                    <button
                      type="button"
                      className="self-start text-caption text-fg-muted underline underline-offset-4"
                    >
                      {NOVA_SCENARIO_PRIORITY.citations.length} sources
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── What she has been doing ──────────────────────────────── */}
        <section
          className="study-rise sm:grid sm:grid-cols-[auto_1fr] sm:gap-7"
          style={rise(4)}
          aria-labelledby="voice-activity"
        >
          <span aria-hidden className="max-sm:hidden sm:w-[132px]" />
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <Label>
                <span id="voice-activity">What I have been doing</span>
              </Label>
              <button
                type="button"
                className="text-caption text-fg-muted underline underline-offset-4"
              >
                All activity
              </button>
            </div>
            <ul className={`flex flex-col divide-y divide-line-1 ${sectionSkin}`}>
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
                >
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[entry.tone] ?? TONE_DOT.neutral}`}
                  />
                  <span className="min-w-0 flex-1 text-ui text-fg-body">{entry.title}</span>
                  {entry.facts.map((fact) => (
                    <span key={fact.label} className="font-mono text-caption text-fg-meta">
                      {fact.value}
                    </span>
                  ))}
                  <span className="text-caption text-fg-meta tabular-nums">{ago(entry.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Lab chrome: what this study is testing, printed on the study. */
function VoiceChrome({ settled, dense }: { settled?: boolean; dense?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Label>Voice study</Label>
        <p className="text-title font-semibold text-fg">
          Nova speaks{settled ? " — settled" : dense ? " — dense" : ""}
        </p>
      </div>
      <p className="study-measure text-caption text-fg-prose">
        The same facts, the same ranking, the same material — said by somebody. Nova leads at her
        hero size, her sentence is speech rather than a headline, and everything below is indented
        to her text column so the page reads as one address.
      </p>
      <p className="study-measure text-caption text-fg-secondary">
        The chat grammar is borrowed for the address only. There is no composer, because there is no
        transcript behind one — see nova-feed.tsx, which argues that already.
      </p>
    </div>
  );
}
