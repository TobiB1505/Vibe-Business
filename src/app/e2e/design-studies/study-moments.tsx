import type { ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import {
  novaPresenceState,
  statusForCandidate,
  statusForFocusTier,
} from "@/components/system/status-vocabulary";
import { NovaPresence } from "@/components/nova/nova-presence";
import { StatusPill } from "@/components/ui/status-pill";
import { creditsToUnits } from "@/modules/credits/units";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import {
  deriveNovaFocus,
  FOCUS_CANDIDATE_KINDS,
} from "@/modules/nova/focus";
import { buildNovaHomeView, type NovaHomeEntry } from "@/modules/nova/home-view";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
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

function controlOf(entry: NovaHomeEntry): { label: string; priced: boolean } | null {
  const control = entry.control;
  if (control.kind === "none") return null;
  if (control.kind === "elsewhere") return { label: control.label, priced: false };
  return {
    label: control.option.label,
    priced: NOVA_ACTION_META[control.option.actionId].price !== null,
  };
}

function priceOf(entry: NovaHomeEntry) {
  const control = entry.control;
  if (control.kind !== "server_action" && control.kind !== "navigation") return null;
  return NOVA_ACTION_META[control.option.actionId].price;
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
          An index to work through, not a screen to ship. The layout studies each show one moment —
          usually the friendly one — and a shape that only ever met a change awaiting review will
          meet the other twenty in production.
        </p>
      </div>

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
              {rows.map(({ kind, entry }) => {
                const status = statusForCandidate(kind);
                const control = controlOf(entry);
                const presence = novaPresenceState({ tier: entry.tier, phase: "idle" });

                return (
                  <li key={kind} className="flex flex-col gap-2.5 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <NovaPresence state={presence} seed="project_e2e" size="sm" />
                      <StatusPill tone={status.tone}>{status.word}</StatusPill>
                      <code className="font-mono text-caption text-fg-meta">{kind}</code>
                    </div>

                    <p className="text-ui text-fg-body">{entry.message}</p>

                    {entry.detail && <p className="text-caption text-fg-prose">{entry.detail}</p>}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      {control ? (
                        <span className="rounded-nav border border-mint-line bg-mint-tint-soft px-3 py-1.5 text-caption font-semibold text-mint">
                          {control.label}
                        </span>
                      ) : (
                        /* `nothing_to_do` has no control on purpose, and a
                           blocked candidate whose recovery lives elsewhere has
                           none here either. Saying so is part of the moment. */
                        <span className="text-caption text-fg-meta">no control</span>
                      )}
                      <CostDisclosure operation={priceOf(entry)} balance={STUDY_BALANCE} />
                      {entry.prompt && (
                        <span className="text-caption text-fg-meta">{entry.prompt}</span>
                      )}
                    </div>
                  </li>
                );
              })}
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
            const view = buildNovaHomeView(deriveNovaFocus({ ...NO_FACTS, working: operation }));
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
