import type { CSSProperties, ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { statusForCandidate } from "@/components/system/status-vocabulary";
import { creditsToUnits } from "@/modules/credits/units";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { NovaHomeEntry, NovaHomeView } from "@/modules/nova/home-view";
import { buildNovaHomeView, novaControlLabel } from "@/modules/nova/home-view";
import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { novaScenarioHealth, novaScenarioView, NOVA_SCENARIO_PRIORITY } from "../nova-scenarios";
import type { Study } from "./studies";

/**
 * Nova Home, recomposed (S0, composition track).
 *
 * ## What this study varies, and what it holds fixed
 *
 * The direction studies vary *material* — glass against panel against rule —
 * and hold the composition fixed. This one is the other axis: it takes the
 * chosen direction's material unchanged and varies **rank**. Put beside
 * `study-chosen` it isolates one question, which is the only way either
 * question gets answered: does the page read better because the surfaces
 * changed, or because the order and the weight did?
 *
 * ## The four findings it answers
 *
 * The audit of the shipped screen found eight defects. Three are code (a
 * missing poll, a duplicated label, a dead field) and one is copy. The other
 * four are composition, they interlock, and none of them is fixable alone:
 *
 * - **The ranking stops after the first card.** `deriveNovaFocus` ranks
 *   everything, and the screen draws that ranking for exactly one row. Below
 *   it the stack, the health reading and the audit's first blocker are three
 *   boxes of identical border, fill and width.
 * - **The blocker outweighs the reading it belongs to.** In the chosen
 *   direction it is the tallest block on the page at roughly three times the
 *   height of the health panel above it, with its own eyebrow and a headline
 *   near the focus card's size. `focus-card.tsx` forbids a second primary and
 *   enforces it inside the card; nothing enforces it across the page.
 * - **The width is not used.** One column of full-width blocks at 1440px, and
 *   a working strip that spends 975 pixels on two words.
 * - **Settled is a blank page.** The state a founder in good shape spends most
 *   of their time in is the emptiest screen in the product.
 *
 * ## The answer: three ranks with three shapes
 *
 * A raised card at full width, then a two-column band, then a quiet foot. Rank
 * is legible from the *shape* rather than from the position, so a reader who
 * scans without reading still knows what the screen thinks is important.
 *
 * Nothing here re-decides a product claim. The ranking is `deriveNovaFocus`'s,
 * the status words are `statusForCandidate`'s, the prices resolve through
 * `CostDisclosure`, and the activity titles come out of `buildActivityFeed`'s
 * own table rather than being written for the picture.
 *
 * ## Two things it deliberately restores
 *
 * The stack rows carry **no controls and no prices**. `attention-stack.tsx`
 * argues that case and it is right: a button on every row rebuilds the wall of
 * equally weighted choices Nova exists to replace, and puts a second and third
 * priced control on a screen whose whole claim is that there is one thing to
 * do next. `study-nova-home.tsx` put them back; this takes them out again.
 *
 * And the blocker becomes a **well inside the health panel** rather than a
 * sibling card. `DESIGN.md` asks for exactly that — *nested cards should become
 * wells or divided rows rather than another elevated rectangle* — and it is
 * also the truer statement: the blocker belongs to the reading, and drawing it
 * as a peer says it is a second subject.
 */

/** The stagger index, as a typed custom property rather than a cast. */
function rise(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/** Tone → the study's own surface treatment. Colour is never the only signal. */
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

function controlLabel(entry: NovaHomeEntry): string | null {
  const control = entry.control;
  if (control.kind === "none") return null;
  return novaControlLabel(control);
}

/**
 * What Vibe has been doing, as recorded rows.
 *
 * ## Why this is the answer to the empty settled screen
 *
 * Because it is the one region that is true in **every** state. A founder with
 * nothing to decide still has a product Vibe has been working on, and showing
 * that is neither an invented suggestion nor a manufactured task —
 * `novaCandidateAction` returns null for `nothing_to_do` on purpose, and this
 * does not go around it. The feed shows the past, which happened, rather than
 * a future nobody planned.
 *
 * ## Why the records go through the real builder
 *
 * `buildActivityFeed` owns the label table and the tone map. Writing "Business
 * audit completed" into this file would produce a study that reads well for a
 * reason the product cannot reproduce — the same trap `study-nova-home.tsx`
 * names about inventing status words. Only the *records* are fixture data, in
 * the shape `readProjectActivity` returns.
 */
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

/**
 * A fixed reference instant, so a screenshot does not change meaning overnight.
 * The shipped surface would format against the real clock.
 */
const NOW = Date.parse("2026-09-06T02:00:00.000Z");

function ago(at: string): string {
  const hours = Math.round((NOW - Date.parse(at)) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * A project with more than two other true things.
 *
 * ## Why the dense case needed its own fixture
 *
 * The first render of this composition left a void under the stack: the
 * health column carries the blocker and is taller, and `nova-review` raises
 * only two secondary entries. Two rows cannot fill a column beside a panel
 * that holds a score, a coverage line and a finding — so the question was
 * whether the layout is wrong or the fixture is thin, and a screenshot of the
 * thin case cannot answer it.
 *
 * The facts go through `deriveNovaFocus` exactly as every other scenario
 * does. What is dense here is the project, not the ranking: five candidates
 * arise because five things are true at once, which is the situation the
 * ranking exists for.
 */
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

const TONE_DOT: Record<string, string> = {
  success: "bg-mint",
  waiting: "bg-amber",
  problem: "bg-coral",
  neutral: "bg-fg-disabled",
};

export function StudyComposition({
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
  const status = statusForCandidate(primary.kind);
  const priceKind = retailKindOf(primary);
  const action = controlLabel(primary);
  const activity = buildActivityFeed(ACTIVITY_RECORDS);

  const cardSkin = study.skin === "glass" ? "study-glass study-glass-sheen" : "study-panel";
  const sectionSkin = "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 max-sm:px-4 max-sm:py-8">
      <CompositionChrome settled={settled} dense={dense} />

      <main className="flex flex-col gap-7">
        {/* ── Rank 0: whose product this is ────────────────────────── */}
        <header className="study-rise flex flex-wrap items-center gap-4" style={rise(0)}>
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-nav border border-line-3 bg-surface-2 text-title font-semibold text-fg"
          >
            P
          </span>
          <div className="min-w-0">
            <h1 className="text-title font-semibold tracking-tight text-fg">Payflow</h1>
            <p className="text-caption text-fg-meta">Developer tool · Confirmed by you</p>
          </div>
        </header>

        {/* ── Rank 1: the one thing ────────────────────────────────── */}
        <section
          className={`study-rise study-press relative overflow-hidden rounded-card p-8 max-sm:p-5 ${cardSkin}`}
          style={rise(1)}
          aria-labelledby="composition-focus-heading"
        >
          {study.focusLight && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--color-mint) 32%, var(--color-mint) 68%, transparent)",
                opacity: 0.7,
              }}
            />
          )}

          <div className="flex items-center gap-3">
            <span aria-hidden className="relative grid size-3 place-items-center">
              <span className="study-breathe absolute inset-0 rounded-full bg-mint" />
              <span className="absolute inset-0 rounded-full bg-mint opacity-40" />
            </span>
            <Label>Nova</Label>
            <Pill tone={status.tone}>{status.word}</Pill>
          </div>

          <h2
            id="composition-focus-heading"
            className="mt-5 text-headline font-semibold text-balance text-fg"
          >
            {primary.message}
          </h2>

          {primary.detail && (
            <p className="study-measure mt-3 text-lead text-fg-prose">{primary.detail}</p>
          )}

          {action && (
            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                className="study-press rounded-nav bg-mint px-5 py-2.5 text-ui font-semibold text-mint-ink"
              >
                {action}
              </button>
              <CostDisclosure operation={priceKind} balance={STUDY_BALANCE} />
            </div>
          )}
        </section>

        {/*
          ── Rank 2: the band ──────────────────────────────────────────
          Two columns, and the split is 1.4 to 1 rather than even, because an
          even split is a second way of saying the two are equal. The stack is
          actionable and the reading is context, so the stack takes the room.

          It disappears whole when neither half has anything, which is the
          settled case — and is why rank 3 below it is not optional.
        */}
        {(view.secondary.length > 0 || health) && (
          <div
            className="study-rise grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]"
            style={rise(2)}
          >
            {view.secondary.length > 0 && (
              <section className="flex flex-col gap-3" aria-labelledby="composition-also">
                <Label>
                  <span id="composition-also">Also true</span>
                </Label>
                <ul className={`flex flex-col divide-y divide-line-1 ${sectionSkin}`}>
                  {view.secondary.map((entry) => {
                    const entryStatus = statusForCandidate(entry.kind);
                    return (
                      <li
                        key={entry.id}
                        className="study-press flex items-start gap-3 px-5 py-4 hover:bg-surface-hover"
                      >
                        <Pill tone={entryStatus.tone}>{entryStatus.word}</Pill>
                        {/*
                          A row is a link to the thing and nothing more. No
                          button, no price — see the note at the top of this
                          file for why that is a restoration rather than a
                          simplification.
                        */}
                        <span className="min-w-0 flex-1 text-ui text-fg-body">{entry.message}</span>
                        <span aria-hidden className="mt-0.5 text-ui text-fg-meta">
                          →
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {health && (
              <section className="flex flex-col gap-3" aria-labelledby="composition-health">
                <Label>
                  <span id="composition-health">Business health</span>
                </Label>
                <div className={`flex flex-col gap-5 p-5 ${sectionSkin}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-display font-semibold tabular-nums text-fg">
                      {health.score ?? "—"}
                    </span>
                    <span className="text-caption text-fg-meta">/ 100</span>
                    <span className="ml-auto text-ui text-fg-prose">{health.stateLabel}</span>
                  </div>

                  <p className="text-caption text-fg-secondary">
                    Scored {health.scoredLenses} of {health.eligibleLenses} applicable areas
                  </p>

                  {health.insufficientCoverageReason && (
                    <p className="text-caption text-amber">{health.insufficientCoverageReason}</p>
                  )}

                  {/*
                    The first blocker, as a well inside the reading it came
                    from. A darker floor rather than a fifth white layer, which
                    is what `DESIGN.md` asks for and what stops the page
                    growing a second primary.
                  */}
                  {health.score !== null && (
                    <div className="flex flex-col gap-3 rounded-well bg-well p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone="blocked">In the way</Pill>
                      </div>
                      <h3 className="text-ui font-semibold text-balance text-fg">
                        {NOVA_SCENARIO_PRIORITY.headline}
                      </h3>
                      <p className="text-caption text-fg-prose">
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
              </section>
            )}
          </div>
        )}

        {/*
          ── Rank 3: what has been happening ───────────────────────────
          Present in every state, and the reason the settled screen stops
          being empty. Bounded to what a glance can hold; the full log is
          already a route.
        */}
        <section className="study-rise flex flex-col gap-3" style={rise(3)}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <Label>What Vibe has been doing</Label>
            <button
              type="button"
              className="text-caption text-fg-muted underline underline-offset-4"
            >
              All activity
            </button>
          </div>
          <ul className={`flex flex-col divide-y divide-line-1 ${sectionSkin}`}>
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
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
        </section>
      </main>
    </div>
  );
}

/** Lab chrome: what this study is testing, printed on the study. */
function CompositionChrome({ settled, dense }: { settled?: boolean; dense?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Label>Composition study</Label>
        <p className="text-title font-semibold text-fg">Three ranks{settled ? " — settled" : ""}</p>
      </div>
      <p className="study-measure text-caption text-fg-prose">
        The chosen direction&rsquo;s material, unchanged. What moves is rank: a raised card at full
        width, a two-column band where the blocker sits inside the reading it belongs to, and a
        quiet foot that is present in every state.
      </p>
      <p className="study-measure text-caption text-fg-secondary">
        {settled
          ? "The state a founder in good shape spends most of their time in. Compare it with /e2e/nova-settled, where the same facts leave the screen blank."
          : dense
            ? "Five things true at once — the case the ranking exists for, and the one that says whether the band's left column is short or the fixture was."
            : "Compare with /e2e/study-chosen, which holds this material and keeps the shipped composition."}
      </p>
    </div>
  );
}
