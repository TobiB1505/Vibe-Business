import type { CSSProperties, ReactNode } from "react";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import { NovaPresence } from "@/components/nova/nova-presence";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import { buildNovaFeed, type NovaEntry } from "@/modules/nova/feed";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { Move } from "./elements";
import { novaScenarioHealth } from "../nova-scenarios";
import type { Study } from "./studies";

/**
 * Nova Home in the shape everybody already knows (S0, chat track).
 *
 * ## The argument, which is about familiarity rather than about novelty
 *
 * A founder arriving at Home has met this layout a thousand times: an avatar,
 * and messages coming out of it. Borrowing that costs nothing to teach.
 *
 * ## The composer is gone, and its absence is the cleaner claim
 *
 * An earlier revision of this study put a text field at the bottom, visibly
 * disabled, with Nova explaining that she could not read replies yet. It was
 * honest and it was still wrong: a disabled input is an apology for something
 * nobody asked for, and it spends the bottom of the surface on a capability
 * that does not exist. Removing it says the same thing with less — there is
 * nowhere to type, so nothing suggests typing.
 *
 * What stays is the part that carried the familiarity: an avatar that is
 * plainly a speaker, and speech attached to it.
 *
 * ## The bubble comes out of the mark
 *
 * `NovaPresence` is not an icon beside the text; it is the thing the text is
 * coming from. The tail joins them, so the four states the mark carries —
 * idle, listening, working, settled — are read as *hers* rather than as a
 * status dot that happens to sit nearby. When she is working, the speaker
 * visibly is.
 *
 * The bubble takes anything: a sentence, a set of options, a stage name, a
 * panel. That is the extension point — new things Nova has to say arrive as
 * new bubbles rather than as new regions of the page.
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
 * **Right** is the conversation: Nova's mark, and everything she has to say
 * hanging off it. The panel hugs its content — the 560px floor it used to
 * carry existed to hold a composer against the bottom edge, and with the
 * composer gone it was reserving space for nothing.
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

/**
 * One thing Nova says, joined to the mark it comes out of.
 *
 * The tail is what makes this a speaker rather than an icon with a caption. It
 * is a rotated square sitting on the bubble's left edge with the same border
 * and fill, so the two read as one shape — cheaper and sharper at any zoom
 * than an SVG pointer, and it inherits the surface tokens for free.
 *
 * Only the first bubble in a run carries the mark, the way every chat does.
 * The ones after it keep the gutter so the column stays straight.
 */
function NovaSays({
  children,
  mark,
  seed,
  state,
  tone = "default",
}: {
  children: ReactNode;
  mark: boolean;
  seed: string;
  state: Parameters<typeof NovaPresence>[0]["state"];
  tone?: "default" | "note";
}) {
  const skin =
    tone === "note"
      ? "border-line-2 bg-surface-1 text-fg-secondary"
      : "border-line-3 bg-surface-3 text-fg-body";

  return (
    <div className="flex items-start gap-4">
      <span className="w-[72px] shrink-0">
        {mark && <NovaPresence state={state} seed={seed} size="lg" />}
      </span>

      <div className={`relative min-w-0 max-w-[46ch] rounded-card border px-4 py-3 ${skin}`}>
        {/*
          The join. Positioned on the bubble's edge and clipped by its own
          border so only the two outward sides show — a triangle drawn with
          two borders rather than a third element to keep aligned.
        */}
        {mark && (
          <span
            aria-hidden
            className={`absolute top-6 -left-[7px] size-3 rotate-45 border-b border-l ${skin}`}
          />
        )}
        <span className="relative block">{children}</span>
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
          className={`study-rise flex flex-col gap-5 p-6 max-sm:p-4 ${panel}`}
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
                  <div key={entry.id} className="flex flex-col gap-3 pl-[88px] max-sm:pl-0">
                    <p className="text-caption text-fg-meta">{entry.prompt}</p>
                    {/* The shared Move — the same element the console uses,
                        so the two layouts differ by layout alone. */}
                    <div className="flex max-w-[26rem] flex-col gap-2.5">
                      {entry.options.map((option) => (
                        <Move
                          key={option.actionId}
                          label={option.label}
                          operation={option.price}
                        />
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
        Right: her mark, and everything she has to say hanging off it.
      </p>
      <p className="study-measure text-caption text-fg-secondary">
        {answered
          ? "A press becomes the founder's own message, and Nova answers with the sentence her own table holds for what is true next."
          : "No composer: there is nowhere to type, so nothing suggests typing. What carries the familiarity is the mark and the speech coming out of it — and the bubble takes anything, so what Nova has to say next arrives as another bubble rather than as another region of the page."}
      </p>
    </div>
  );
}
