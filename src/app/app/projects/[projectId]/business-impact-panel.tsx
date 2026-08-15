"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import {
  planMeasurementAction,
  startMeasurementAction,
  type BusinessImpactActionState,
} from "./business-impact-actions";

/**
 * The Business impact section (Sprint 12B §21–§26, §28, §43).
 *
 * ## The sentence this panel exists to never say
 *
 * > No impact.
 *
 * Four of its ten states have no result at all — nothing merged, no metric
 * defined, no source connected, window not elapsed — and every one of them
 * would read as "this change did nothing" if rendered carelessly. The state
 * that matters most today is `source_required`, because **that is the state
 * every project is in**: Vibe has no analytics connector, and reporting that as
 * a negative outcome would blame the change for a gap in Vibe's own setup.
 *
 * ## The second sentence it never says
 *
 * > This change caused a 15% increase.
 *
 * Vibe compared two periods and found a difference. Everything else that
 * happened in those weeks is equally consistent with the numbers. So every
 * stated movement carries the observed-change disclaimer, and the disclaimer is
 * a field on the server's card rather than a string here — it cannot be dropped
 * in a redesign, and `causality.ts` plus the tests keep the verbs honest (§10,
 * §24, §43).
 *
 * ## And what it never offers
 *
 * A revert, a re-merge, a redeploy. A degraded result is information, not a
 * trigger. The consequential response to a bad outcome belongs to a human and
 * to a later sprint (§28).
 */

function localDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A window as a person reads it: two dates and the zone they were counted in. */
function windowRange(window: { start: string; end: string; timezone: string }): string {
  // The end is exclusive, so the last *included* day is the day before it.
  const lastDay = new Date(Date.parse(window.end) - 1);
  return `${localDate(window.start)} – ${localDate(lastDay.toISOString())} (${window.timezone})`;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

/** Signed, and never dressed up. A negative result reads as negative (§25). */
function formatRelative(relative: number): string {
  const percent = relative * 100;
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent).toFixed(1)}%`;
}

const RESULT_TONE: Record<string, string> = {
  improved: "text-emerald-400",
  degraded: "text-amber-300",
  neutral: "text-zinc-300",
  insufficient_data: "text-zinc-300",
  failed: "text-amber-300",
};

function BeforeAfter({ card }: { card: BusinessImpactCard }) {
  if (card.baselineValue === null || card.observedValue === null) return null;

  return (
    <dl className="grid grid-cols-3 gap-3" data-testid="business-impact-values">
      <div>
        <dt className="text-xs text-zinc-500">Before</dt>
        <dd className="text-sm text-zinc-200">{formatValue(card.baselineValue)}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500">After</dt>
        <dd className="text-sm text-zinc-200">{formatValue(card.observedValue)}</dd>
      </div>
      <div>
        {/* "Observed change", never "impact" and never "uplift". The label is
            part of the causality safeguard, not decoration (§10, §24). */}
        <dt className="text-xs text-zinc-500">Observed change</dt>
        <dd className="text-sm text-zinc-200">
          {card.observedRelativeChange === null ? "—" : formatRelative(card.observedRelativeChange)}
        </dd>
      </div>
    </dl>
  );
}

function Windows({ card }: { card: BusinessImpactCard }) {
  if (!card.baselineWindow || !card.measurementWindow) return null;

  return (
    <dl className="space-y-1" data-testid="business-impact-windows">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-zinc-500">Baseline</dt>
        <dd className="text-xs text-zinc-300">{windowRange(card.baselineWindow)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-zinc-500">Measurement window</dt>
        <dd className="text-xs text-zinc-300">{windowRange(card.measurementWindow)}</dd>
      </div>
      {card.resultAvailableAt && (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-zinc-500">Result available after</dt>
          <dd className="text-xs text-zinc-300">{localDate(card.resultAvailableAt)}</dd>
        </div>
      )}
    </dl>
  );
}

function Metric({ card }: { card: BusinessImpactCard }) {
  if (!card.metricLabel) return null;

  return (
    <div className="space-y-1">
      <p className="text-sm text-zinc-200">{card.metricLabel}</p>
      {card.businessGoal && <p className="text-xs text-zinc-500">{card.businessGoal}</p>}
    </div>
  );
}

export function BusinessImpactPanel({
  projectId,
  preparedChangeId,
  card,
}: {
  projectId: string;
  preparedChangeId: string;
  card: BusinessImpactCard;
}) {
  const router = useRouter();
  const [state, setState] = useState<BusinessImpactActionState>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  // Nothing merged: the merge and outcome panels above already explain the
  // gate, and a third component narrating it would be noise.
  if (card.state === "unavailable") return null;

  function run(action: typeof planMeasurementAction) {
    setPending(true);
    startTransition(async () => {
      setState(await action(projectId, preparedChangeId));
      router.refresh();
      setPending(false);
    });
  }

  /**
   * The states with no metric evidence behind them (Cleanup §8, §9).
   *
   * Previously each rendered a full section with a headline, a metric and an
   * explanation — which meant every project in existence ended its post-change
   * experience on a prominent block explaining a gap in Vibe's own setup.
   *
   * They are now one quiet line under a secondary heading. Nothing here is a
   * failure, nothing is styled as one, and nothing asks the user to configure
   * analytics before their change is considered finished. The measurement
   * architecture is intact underneath; it simply has nothing to report yet, and
   * that is not news.
   */
  const noEvidenceYet =
    card.state === "not_planned" || card.state === "source_required" || card.state === "unsupported";

  if (noEvidenceYet) {
    return (
      <section className="space-y-2 border-t border-zinc-800 pt-4">
        <h4 className="text-sm font-medium text-zinc-400">Impact tracking</h4>
        <p className="text-sm text-zinc-500">Long-term impact has not been measured.</p>

        {/* Kept, but demoted: planning is free and deterministic — no analytics
            connection, no provider call, no model — and it records the intent
            rather than a result. It is an option, never a prerequisite. */}
        {card.state === "not_planned" && (
          <button
            type="button"
            onClick={() => run(planMeasurementAction)}
            disabled={pending}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300 disabled:opacity-60"
          >
            Plan how this would be measured
          </button>
        )}

        {state?.ok === false && <p className="text-sm text-red-400">{state.message}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <h4 className="text-sm font-medium text-zinc-200">Business impact</h4>

      {card.state === "scheduled" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{card.headline}</p>
          <Metric card={card} />
          <Windows card={card} />
          {/* No interim conclusion. The result does not exist yet, and saying
              anything about its direction would be a guess (§22). */}
          {card.canStartMeasuring && (
            <button
              type="button"
              onClick={() => run(startMeasurementAction)}
              disabled={pending}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
            >
              Start measuring
            </button>
          )}
        </div>
      ) : card.state === "measuring" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{card.headline}</p>
          <Metric card={card} />
          {/* Factual progress only — days, never a percentage, and never
              "looking good" before the window closes (§23). */}
          <p className="text-sm text-zinc-400">
            {card.daysObserved ?? 0} of {card.daysExpected ?? 0} complete days observed
          </p>
          <Windows card={card} />
        </div>
      ) : card.state === "insufficient_data" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{card.headline}</p>
          <Metric card={card} />
          <p className="text-sm text-zinc-400">
            Not enough traffic was observed to make a meaningful comparison.
          </p>
          {/* What was required and what was seen, so the user can tell "this
              did not work" from "we cannot yet tell" (§26). */}
          <dl className="grid grid-cols-3 gap-3" data-testid="business-impact-samples">
            <div>
              <dt className="text-xs text-zinc-500">Needed each period</dt>
              <dd className="text-sm text-zinc-200">{card.minimumObservations ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Observed before</dt>
              <dd className="text-sm text-zinc-200">{card.sampleSizeBefore ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Observed after</dt>
              <dd className="text-sm text-zinc-200">{card.sampleSizeAfter ?? "—"}</dd>
            </div>
          </dl>
          <Windows card={card} />
        </div>
      ) : card.state === "failed" ? (
        <div className="space-y-2">
          {/* A statement about Vibe's measurement, never about the metric (§33). */}
          <p className="text-sm text-amber-300">{card.headline}</p>
          {card.failureMessage && <p className="text-sm text-zinc-400">{card.failureMessage}</p>}
          <p className="text-xs text-zinc-500">
            This says nothing about whether the metric moved — only that Vibe could not read it.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* improved / degraded / neutral. A negative result is shown exactly
              as prominently as a positive one (§25). */}
          <p className={`text-sm ${RESULT_TONE[card.state] ?? "text-zinc-300"}`}>{card.headline}</p>
          <Metric card={card} />
          <BeforeAfter card={card} />
          <Windows card={card} />
          {card.dataQuality && card.dataQuality !== "complete" && (
            <p className="text-xs text-amber-300">
              Some days were missing from the data, so this comparison is not built on full periods.
            </p>
          )}
          {/* Required on every stated movement. A field on the card, so it
              cannot be dropped in a redesign (§24). */}
          {card.observedChangeDisclaimer && (
            <p className="text-xs text-zinc-500">{card.observedChangeDisclaimer}</p>
          )}
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-red-400">{state.message}</p>}
    </section>
  );
}
