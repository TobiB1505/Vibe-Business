import type { CSSProperties, ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import { NovaPresence } from "@/components/nova/nova-presence";
import { creditsToUnits } from "@/modules/credits/units";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import { buildNovaFeed, type NovaEntry } from "@/modules/nova/feed";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { novaScenarioHealth } from "../nova-scenarios";
import type { Study } from "./studies";

/**
 * Nova Home in the shape everybody already knows (S0, chat track).
 *
 * ## The argument, which is about familiarity rather than about novelty
 *
 * A founder arriving at Home has met this layout a thousand times: an avatar,
 * a message, options under it, a composer at the bottom. Borrowing it costs
 * nothing to teach. What Vibe adds is the one honest difference — the composer
 * is **there and disabled**, and Nova says why in her own words rather than
 * leaving a dead box for somebody to poke at.
 *
 * That is not a lie by omission, and the distinction matters enough to state:
 * a field that looked live and silently swallowed input would be one. A field
 * that is visibly unavailable, beside a sentence explaining that replies are
 * coming and are not here yet, is the product telling the truth about its own
 * version. It also puts the future affordance where it will eventually live,
 * so the day it turns on nothing about the screen has to move.
 *
 * ## Why this renders `buildNovaFeed` rather than `buildNovaHomeView`
 *
 * Because the transcript projection already exists and has never been mounted
 * outside onboarding. `feed.ts` produces exactly what a chat needs — message,
 * choice, progress, aside — with every sentence from its own table, and
 * `home-view.ts` was written beside it precisely because a *composition* needed
 * a different shape. This study does not need the different shape. Reaching
 * for the feed is the reuse, and writing a second set of chat entries over the
 * home view would have been the duplication.
 *
 * ## The two columns
 *
 * **Left** is the project and what is happening to it: who this is about, the
 * business reading, and the live record of what Vibe has done. It is the
 * context a chat has no room for and should not push into the conversation.
 *
 * **Right** is the conversation. Nova's messages, her options as pressable
 * tiles, and the disabled composer beneath them.
 *
 * ## What a press produces
 *
 * `study-chat-answered` shows it: the founder's choice appears as their own
 * message, and Nova answers. The answer is not written here — it is the
 * candidate's own `message` from the feed's table for the state the press
 * moves the project into. A study that invented Nova's reply would be
 * demonstrating a conversation the product cannot have.
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
    eventType: "agent_execution.change_verified",
    createdAt: "2026-09-05T16:04:00.000Z",
    metadata: {},
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

const FACTS: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: false, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [
    {
      preparedChangeId: "change_chat",
      stage: "review_required",
      headline: "Two files changed on a branch of their own",
    },
  ],
  questions: [],
  moves: [{ id: "move_chat", rank: 1, title: "Add a pricing page" }],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: true,
  repositoryReadOutdated: false,
  workspaceChoiceRequired: false,
  working: null,
};

/* ── Chat furniture ──────────────────────────────────────────────────── */

/** One thing Nova says, with her mark beside it the first time she speaks. */
function NovaSays({
  children,
  mark,
  seed,
  state,
  tone = "default",
}: {
  children: ReactNode;
  /** Only the first message in a run carries the avatar, as any chat does. */
  mark: boolean;
  seed: string;
  state: Parameters<typeof NovaPresence>[0]["state"];
  tone?: "default" | "note";
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-11 shrink-0">
        {mark && <NovaPresence state={state} seed={seed} size="md" />}
      </span>
      <div
        className={`min-w-0 max-w-[46ch] rounded-card rounded-tl-sm border px-4 py-3 ${
          tone === "note"
            ? "border-line-2 bg-surface-1 text-fg-secondary"
            : "border-line-3 bg-surface-3 text-fg-body"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** What the founder said, by pressing. Right-aligned, as their own words. */
function FounderSaid({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[40ch] rounded-card rounded-br-sm border border-mint-line bg-mint-tint px-4 py-2.5 text-ui text-fg">
        {children}
      </div>
    </div>
  );
}

/**
 * The answered variant leads with the candidate that starts work.
 *
 * Most candidates route to *somewhere to go* rather than to *something to
 * run*, and a press that navigates has no reply — the founder has left. Two
 * drafts of this fixture got that wrong in the same way: dropping the prepared
 * change promoted *Look at this move*, which is navigation too.
 *
 * What the ranking has to be left holding is a candidate whose control is a
 * server action, and `nova-priced` already found the shape: a stale audit and
 * nothing else. Its option costs 35 Credits, which is the product's own way of
 * saying that pressing it makes Vibe do something.
 *
 * The two fixtures differ by two empty arrays. Everything else — the ranking,
 * the sentences, the price — is derived exactly as in the resting state.
 */
const PRESSED_FACTS: NovaFocusFacts = { ...FACTS, changes: [], moves: [] };

export function StudyChat({ study, answered }: { study: Study; answered?: boolean }) {
  const focus = deriveNovaFocus(answered ? PRESSED_FACTS : FACTS);
  const entries = buildNovaFeed(focus);
  const view = buildNovaHomeView(focus);
  const health = novaScenarioHealth("nova-review");
  const activity = buildActivityFeed(ACTIVITY_RECORDS);
  const seed = "project_e2e";

  const presence = novaPresenceState({
    tier: view.primary.tier,
    phase: view.working?.phase ?? "idle",
  });

  const glass = study.skin === "glass";
  const panel = glass
    ? "study-glass rounded-panel"
    : "rounded-panel border border-line-2 bg-surface-1";

  /*
   * The choice the founder pressed, and what Nova honestly says next.
   *
   * Two corrections the first draft of this study needed, both worth keeping
   * written down because they are the same mistakes the product itself has
   * made.
   *
   * **It must be an option that starts work.** The first draft pressed *Look
   * at the change*, which is navigation — the founder leaves for the Agent and
   * there is no reply, so a bubble underneath it was a conversation nobody
   * had. The pressed option is now the first one carrying a price, because a
   * priced option is by definition one that makes Vibe do something.
   *
   * **The reply must not already be on screen.** The first draft answered with
   * `view.secondary[0]`, which the feed had already rendered as an aside four
   * lines above — the same duplication `footnoteFor` exists to stop on the
   * Focus Card. What Nova actually says after a run starts is the run's first
   * named stage, out of `OPERATION_STAGE_LABELS`, which is a sentence nothing
   * else on this screen is saying.
   */
  const choice = entries.find(
    (entry): entry is Extract<NovaEntry, { kind: "nova.choice" }> => entry.kind === "nova.choice",
  );
  const pressed = choice?.options.find((option) => option.price !== null) ?? null;
  // A missing priced option means the fixture leads with navigation, and the
  // exchange below would be a conversation nobody could have had.
  const reply = OPERATION_STAGE_LABELS.preparing;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <ChatChrome answered={answered} />

      <div className="grid gap-8 lg:grid-cols-[300px_1fr] lg:items-start">
        {/* ── Left: the project, and what has happened to it ─────────── */}
        <aside className="study-rise flex flex-col gap-6" style={rise(0)}>
          <div className={`flex flex-col gap-4 p-5 ${panel}`}>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-nav border border-line-3 bg-surface-2 text-ui font-semibold text-fg"
              >
                P
              </span>
              <div className="min-w-0">
                <p className="truncate text-ui font-semibold text-fg">Payflow</p>
                <p className="truncate text-caption text-fg-meta">Developer tool</p>
              </div>
            </div>

            {health && (
              <div className="flex flex-col gap-1 border-t border-line-1 pt-4">
                <Label>Business health</Label>
                <div className="flex items-baseline gap-2">
                  <span className="text-headline font-semibold tabular-nums text-fg">
                    {health.score ?? "—"}
                  </span>
                  <span className="text-caption text-fg-meta">/ 100</span>
                  <span className="ml-auto text-caption text-fg-prose">{health.stateLabel}</span>
                </div>
                <p className="text-caption text-fg-secondary">
                  Scored {health.scoredLenses} of {health.eligibleLenses} applicable areas
                </p>
              </div>
            )}
          </div>

          {/*
            The live record. Left rather than in the conversation, because it
            is what Vibe *did* — a log, not something Nova is saying to
            anybody. Putting it in the thread would make every completed job
            look like a message she wrote.
          */}
          <div className="flex flex-col gap-3">
            <Label>Live</Label>
            <ul className={`flex flex-col divide-y divide-line-1 ${panel}`}>
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2.5 px-4 py-3">
                  <span
                    aria-hidden
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${TONE_DOT[entry.tone] ?? TONE_DOT.neutral}`}
                  />
                  <span className="min-w-0 flex-1 text-caption text-fg-body">{entry.title}</span>
                  <span className="shrink-0 text-caption text-fg-meta tabular-nums">
                    {ago(entry.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* ── Right: the conversation ────────────────────────────────── */}
        <section
          className={`study-rise flex min-h-[560px] flex-col gap-5 p-6 max-sm:p-4 ${panel}`}
          style={rise(1)}
          aria-label="Nova"
        >
          <div className="flex flex-col gap-5">
            {/*
              Everything she says, then what can be pressed. `buildNovaFeed`
              interleaves them because a transcript reads top to bottom as it
              happened; a chat's options belong under the last thing said, the
              way a reply belongs under a question.
            */}
            {entries.map((entry, index) => {
              const first = index === 0;
              if (entry.kind === "nova.choice") return null;

              if (entry.kind === "nova.message") {
                return (
                  <NovaSays
                    key={entry.id}
                    mark={first}
                    seed={seed}
                    state={presence}
                    tone={entry.emphasis === "aside" ? "note" : "default"}
                  >
                    <p className={entry.emphasis === "aside" ? "text-caption" : "text-ui"}>
                      {entry.text}
                    </p>
                  </NovaSays>
                );
              }

              if (entry.kind === "nova.progress") {
                return (
                  <NovaSays key={entry.id} mark={false} seed={seed} state={presence} tone="note">
                    <p className="text-caption">
                      {OPERATION_STAGE_LABELS[entry.operation.stage]}
                      {/* The stage name is the progress. No fraction exists. */}
                    </p>
                  </NovaSays>
                );
              }

              return null;
            })}

            {choice &&
              (() => {
                const entry = choice;
                return (
                  <div key={entry.id} className="flex flex-col gap-3 pl-14 max-sm:pl-0">
                    <p className="text-caption text-fg-meta">{entry.prompt}</p>
                    <div className="flex flex-wrap gap-2.5">
                      {entry.options.map((option) => (
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
                );
              })()}

            {/* What a press produces. */}
            {answered && pressed && (
              <>
                <FounderSaid>{pressed.label}</FounderSaid>
                <NovaSays mark seed={seed} state={presence} tone="note">
                  <p className="text-caption">
                    {reply}
                    {/* The stage is the progress. No fraction exists behind a
                        durable operation, so none is drawn. */}
                  </p>
                </NovaSays>
              </>
            )}

            {/*
              Nova on her own limits, in her own voice. This is the sentence
              that makes the dead composer honest rather than broken, and it is
              deliberately hers rather than a system notice in grey.
            */}
            <NovaSays mark={false} seed={seed} state={presence} tone="note">
              <p className="text-caption">
                I can&rsquo;t read what you type yet — this is my first version, and talking back is
                what I am being built for next. Press one of my options and I will get to work.
              </p>
            </NovaSays>
          </div>

          {/*
            The composer, present and unavailable.

            `disabled` and `aria-disabled` rather than a styled div: assistive
            technology should reach the same conclusion an eye does, and a
            focusable box that swallows keystrokes is the failure this is
            avoiding. The label above it says why in Nova's own words.
          */}
          <div className="mt-auto flex flex-col gap-2 pt-2">
            <div className="flex items-center gap-3 rounded-nav border border-line-2 bg-field px-4 py-3 opacity-60">
              <input
                type="text"
                disabled
                aria-disabled="true"
                placeholder="Writing to Nova is coming in a later version"
                className="min-w-0 flex-1 cursor-not-allowed bg-transparent text-ui text-fg-body placeholder:text-fg-disabled focus:outline-none"
              />
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-nav bg-surface-2 text-fg-disabled"
              >
                ↑
              </span>
            </div>
            <p className="text-caption text-fg-meta">Version 1 answers by doing, not by typing.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function ChatChrome({ answered }: { answered?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Label>Chat study</Label>
        <p className="text-title font-semibold text-fg">
          The shape everybody knows{answered ? " — after a press" : ""}
        </p>
      </div>
      <p className="study-measure text-caption text-fg-prose">
        Rendered from buildNovaFeed — the transcript projection that has existed since the Nova
        slice and has never been mounted outside onboarding. Left: the project and the live record.
        Right: the conversation.
      </p>
      <p className="study-measure text-caption text-fg-secondary">
        {answered
          ? "A press becomes the founder's own message, and Nova answers with the sentence her own table holds for what is true next."
          : "The composer is present and disabled, with Nova saying why. A box that looked live and swallowed input would be the dishonest version of this."}
      </p>
    </div>
  );
}
