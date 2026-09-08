import type { ReactNode } from "react";
import { novaPresenceState, statusForFocusTier } from "@/components/system/status-vocabulary";
import { NovaPresence } from "@/components/nova/nova-presence";
import { creditsToUnits } from "@/modules/credits/units";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { deriveNovaFocus, FOCUS_CANDIDATE_KINDS } from "@/modules/nova/focus";
import { buildNovaHomeView, novaControlLabel, type NovaHomeEntry } from "@/modules/nova/home-view";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import { NovaFocusThread } from "@/app/app/projects/[projectId]/nova/nova-focus-thread";
import { Moves } from "./elements";
import { BLOCK_FOR_MOMENT } from "@/modules/nova/blocks";
import { MOMENT_FACTS, NO_FACTS } from "./moment-fixtures";
import type { Study } from "./studies";

/**
 * Every moment Nova has, on one page (S0, moments track).
 *
 * ## Why this exists before any of them is designed
 *
 * The four layout studies each show *one* moment — a change awaiting review,
 * usually — and a layout that works for one candidate is not evidence about
 * twenty-one. The blocked ones carry no control and a coral word; the decision
 * ones carry a control that navigates; `audit_outdated` carries a priced one;
 * `nothing_to_do` carries none and must not look like a failure. A shape that
 * only ever met the friendly case will meet the others in production.
 *
 * So this lifts all of them into the lab at once, which is the point: it is an
 * index to work through rather than a screen to ship.
 *
 * ## The facts are the smallest that raise each candidate
 *
 * Every row runs the real `deriveNovaFocus` over a fact set built to raise
 * exactly one candidate, so what is on screen is what the product would say —
 * the sentence from `feed.ts`'s table, the tier from `CANDIDATE_TIER`, the
 * status word from `statusForCandidate`, the price from the action catalog.
 * Nothing here is written for the picture.
 *
 * The isolation is also an assertion. `FOCUS_CANDIDATE_KINDS` is the list, and
 * this file maps every entry in it; a kind added to the domain without a fact
 * set here fails the type, so the gallery cannot quietly fall behind the thing
 * it is an index of.
 *
 * ## What is deliberately not here
 *
 * Combinations. A real project raises several candidates at once and the
 * ranking decides — that is what `study-composition-dense` and
 * `study-voice-dense` are for. This page answers the other question: what does
 * each moment *say*, on its own, before anything ranks it.
 */

/** The four readings `operationPollPhase` produces, as the facts behind them. */
const OPERATIONS: { label: string; note: string; operation: OperationView | null }[] = [
  { label: "Nothing running", note: "No operation. The mark is still.", operation: null },
  {
    label: "Working",
    note: "A stage the executor wrote. Never a fraction.",
    operation: {
      operationId: "op_a",
      status: "running",
      stage: "reading_code",
      startedAt: "2026-09-06T01:52:00.000Z",
      completedAt: null,
      failureCode: null,
      resultId: null,
      shouldPoll: true,
      retryAllowed: false,
      stalled: false,
    },
  },
  {
    label: "Waiting for you",
    note: "Blocked on a person. This is not activity and must never be drawn as it.",
    operation: {
      operationId: "op_b",
      status: "needs_user",
      stage: "asking_founder",
      startedAt: "2026-09-06T01:40:00.000Z",
      completedAt: null,
      failureCode: null,
      resultId: null,
      shouldPoll: false,
      retryAllowed: false,
      stalled: false,
    },
  },
  {
    label: "Stalled",
    note: "Presumed lost from a clock. Neither working nor failed.",
    operation: {
      operationId: "op_c",
      status: "running",
      stage: "running_ai",
      startedAt: "2026-09-05T20:00:00.000Z",
      completedAt: null,
      failureCode: null,
      resultId: null,
      shouldPoll: false,
      retryAllowed: false,
      stalled: true,
    },
  },
];

const STUDY_BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

function controlOf(entry: NovaHomeEntry): { label: string } | null {
  const label = novaControlLabel(entry.control);
  return label === null ? null : { label };
}

function priceOf(entry: NovaHomeEntry) {
  const control = entry.control;
  if (control.kind !== "server_action" && control.kind !== "navigation") return null;
  return NOVA_ACTION_META[control.option.actionId].price;
}

/**
 * One moment, in the thread the product actually draws.
 *
 * ## Why this replaced a row
 *
 * The gallery used to render a pill, a sentence, a detail line and a chip —
 * a table with a status column, which is a fine index and a poor test. It
 * could not answer the question this page exists for: *does the vocabulary
 * carry twenty-one different situations?* A pill answers it by fiat, because
 * the word is right there. The thread has no pill.
 *
 * ## Why it mounts `NovaFocusThread` rather than drawing one
 *
 * Because the second version of this was a hand-built copy of that component:
 * a bubble with the register, the detail as an aside, the prompt as a second
 * bubble, the control outside. Every line of it correct, and none of it the
 * thing production renders — so a change to the thread's arrangement showed up
 * on twenty-one moments in the product and on none of them here, in the
 * gallery that exists to judge exactly that.
 *
 * It mounts the component now. What the gallery still owns is the *control*,
 * because the lab has no server actions to bind: a real one becomes a `Moves`
 * picture, and the two moments that have none say so instead.
 *
 * ## What the page then shows, which is the finding
 *
 * The register is tone and contour, and **there is no status word anywhere**.
 * That is not an omission — it is the claim being tested. `DESIGN.md` says
 * colour is never the only signal, and here the other signal is the sentence
 * itself: *"My last audit did not finish"*, *"I have lost access to your
 * repository"*. Each candidate states its own situation, which is a stronger
 * signal than a label above it would be.
 *
 * Scroll the page and the twenty-one either read apart or they do not. That is
 * a thing to look at rather than to argue about, and it is why the code name
 * is the only label left on a row.
 */
function Moment({ entry }: { entry: NovaHomeEntry }) {
  const control = controlOf(entry);
  const price = priceOf(entry);

  return (
    <NovaFocusThread
      entry={entry}
      /* Isolated by construction: each row runs facts built to raise exactly
         one candidate, so there is never a second true thing behind it. The
         register is shown once, below, where it can be looked at. */
      asides={[]}
      /* The label the thread needs to decide whether the prompt above the
         control would repeat it — `footnoteFor`'s rule, asked here the way
         Home asks it rather than skipped because the lab has no action. */
      controlLabel={control?.label}
      control={
        control ? (
          <Moves moves={[{ label: control.label, operation: price }]} balance={STUDY_BALANCE} />
        ) : entry.control.kind === "answer" ? (
          /*
             Not the same as having nothing to press, and the gallery has to say
             which. A question carries no separate control because the answering
             card *is* the control — it brings the options, the recommendation and
             the submit. Printing "no control" here would read as "nothing to do"
             over the one moment that is entirely about doing something.
          */
          <p className="font-mono text-caption text-fg-meta">
            answered in the card — see /e2e/study-block
          </p>
        ) : (
          /* `nothing_to_do` has no control on purpose. Saying so is part of the
             moment: a screen that invented one would be work Nova made up. */
          <p className="font-mono text-caption text-fg-meta">no control</p>
        )
      }
    />
  );
}

export function StudyMoments({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  const moments = FOCUS_CANDIDATE_KINDS.map((kind) => {
    const view = buildNovaHomeView(deriveNovaFocus(MOMENT_FACTS[kind]));
    return { kind, entry: view.primary };
  });

  const byTier = ["blocked", "decision", "ready", "setup", "settled"] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Label>Moments</Label>
          <p className="text-title font-semibold text-fg">
            {FOCUS_CANDIDATE_KINDS.length} things Nova can be saying
          </p>
        </div>
        <p className="study-measure text-caption text-fg-prose">
          Every candidate the domain can raise, each from the smallest fact set that raises it and
          nothing else, through the real deriveNovaFocus. The sentence, the tier and the price are
          the product&rsquo;s; none of it is written for this page.
        </p>
        <p className="study-measure text-caption text-fg-secondary">
          Each one mounts the product&rsquo;s own <code className="font-mono">NovaFocusThread</code>
          . It used to be a hand-built copy of it here — every line correct, and none of it the
          component Home renders, so a change to the thread showed on twenty-one moments in the
          product and on none of them in the gallery built to judge exactly that. Before the copy it
          was a table with a status column, which is a fine index and a poor test: a pill answers
          &ldquo;can a founder tell these apart?&rdquo; by fiat, and the thread has no pill.
        </p>
        <p className="study-measure text-caption text-fg-secondary">
          Each row also says which block that moment shows, read from block-registry.ts rather than
          decided here. The registry is total over both unions, so an operation type or a moment
          added to the domain fails the build until somebody decides what a founder sees — which is
          the difference between a state that was decided to show nothing and one nobody got to.
        </p>
        <p className="study-measure text-caption text-fg-secondary">
          So there is no status word anywhere below. That is the claim being tested rather than an
          omission: colour is never the only signal here, and the other signal is the sentence.
          <em> My last audit did not finish</em> and{" "}
          <em>my audit has been running far longer than it should</em> say what they are without a
          label, which is more than a label would. Twenty-one of them in a column either read apart
          or they do not.
        </p>
      </div>

      <BehindTheFirst moments={moments} panel={panel} />

      {byTier.map((tier) => {
        const rows = moments.filter((moment) => moment.entry.tier === tier);
        if (rows.length === 0) return null;
        /* A tier heading holds only a tier, so it is the one place that still
           asks by tier. The rows under it no longer repeat its word: ten
           different moments used to, which is the defect this gallery found. */
        const tierStatus = statusForFocusTier(tier);

        return (
          <section key={tier} className="flex flex-col gap-3" aria-labelledby={`tier-${tier}`}>
            <div className="flex flex-wrap items-center gap-3">
              <Label>
                <span id={`tier-${tier}`}>{tierStatus.word}</span>
              </Label>
              <span className="text-caption text-fg-meta">
                {rows.length} {rows.length === 1 ? "moment" : "moments"}
              </span>
            </div>

            <ul className={`flex flex-col divide-y divide-line-1 ${panel}`}>
              {rows.map(({ kind, entry }) => (
                <li key={kind} className="flex flex-col gap-2.5 px-5 py-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <code className="font-mono text-caption text-fg-meta">{kind}</code>
                    {/*
                      Which block this moment shows, read from the registry
                      rather than decided here. That is the point of the
                      registry: the gallery asks the same question a screen
                      asks, and gets the same answer.
                    */}
                    <code className="font-mono text-caption text-fg-disabled">
                      {BLOCK_FOR_MOMENT[kind] === "none"
                        ? "no block — the sentence is the whole of it"
                        : `block: ${BLOCK_FOR_MOMENT[kind]}`}
                    </code>
                  </div>
                  <Moment entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* ── The operation overlay ────────────────────────────────────── */}
      <section className="flex flex-col gap-3" aria-labelledby="tier-operations">
        <Label>
          <span id="tier-operations">While something runs</span>
        </Label>
        <p className="study-measure text-caption text-fg-prose">
          Orthogonal to the twenty-one above: any of them can be true while an operation is in
          flight, and these are the four readings `operationPollPhase` produces.
        </p>
        <ul className={`flex flex-col divide-y divide-line-1 ${panel}`}>
          {OPERATIONS.map(({ label, note, operation }) => {
            const view = buildNovaHomeView(
              deriveNovaFocus({
                ...NO_FACTS,
                working: operation && { type: "business_audit", view: operation },
              }),
            );
            const presence = novaPresenceState({
              tier: view.primary.tier,
              phase: view.working?.phase ?? "idle",
            });

            return (
              <li key={label} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <NovaPresence state={presence} seed="project_e2e" size="sm" />
                <span className="text-ui font-semibold text-fg">{label}</span>
                {/*
                  The stage yields when it repeats the state word. Both tables
                  are written to the person being waited on, so both say
                  "Waiting for you" and this row read it twice — the collision
                  `working-strip.tsx` found and fixed for itself, reproduced
                  here the moment a second surface printed the same pair.
                */}
                {operation && OPERATION_STAGE_LABELS[operation.stage] !== label && (
                  <span className="text-ui text-fg-prose">
                    {OPERATION_STAGE_LABELS[operation.stage]}
                  </span>
                )}
                <span className="ml-auto max-w-[46ch] text-caption text-fg-meta">{note}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * The quiet register, which every row above is isolated from.
 *
 * ## Why it needs its own section
 *
 * Because the gallery's whole method is one candidate per fact set, so
 * `secondary` is empty on all twenty-one rows and the register never appears.
 * It is the one thing on this page that only exists when *more than one* is
 * true, which is the ordinary case in a real project and the case the page is
 * built to exclude.
 *
 * ## Why this is not the combination the page refuses
 *
 * The page refuses combined *fact sets*, because a row built from two would
 * stop being evidence about either candidate. Nothing is combined here: the
 * sentences are the ones the rows above already produced, from their own
 * isolated fact sets, borrowed to stand in the position the ranking would put
 * them in. What is being shown is the register, not an ordering — the ordering
 * is `deriveNovaFocus`'s and is not re-decided anywhere, least of all here.
 *
 * ## What it is evidence about
 *
 * That a second true thing can be said without becoming a second thing to do.
 * Home computed these and threw them away, so a founder with three things
 * pending saw one. The rule that makes them safe is that they carry no
 * controls and no prices, and `speechBubbles` is what keeps five of them from
 * being five stacked blocks: past a run's length they become one bubble with
 * line breaks, the way a long message actually arrives.
 */
function BehindTheFirst({
  moments,
  panel,
}: {
  moments: { kind: string; entry: NovaHomeEntry }[];
  panel: string;
}) {
  const lead = moments.find((moment) => moment.kind === "merge_ready");
  const behind = moments
    .filter((moment) =>
      ["audit_outdated", "next_move_available", "scan_stalled"].includes(moment.kind),
    )
    .map((moment) => moment.entry.message);

  if (!lead) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>And the ones behind it</Label>
        <p className="study-measure text-ui text-fg-body">
          Every row below is one candidate alone. A real project raises several, and the ranking
          says which leads — the rest are still true.
        </p>
      </div>
      <div className={`p-5 max-sm:p-4 ${panel}`}>
        <NovaFocusThread
          entry={lead.entry}
          asides={behind}
          control={<p className="font-mono text-caption text-fg-meta">control omitted here</p>}
        />
      </div>
      <p className="study-measure text-caption text-fg-secondary">
        No control and no price on any of them, which is what stops a second true thing becoming a
        second wall of buttons. Their sentences are the same ones the rows below produce from their
        own fact sets; nothing is written for this picture.
      </p>
    </section>
  );
}
