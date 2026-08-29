"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { statusToneText } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import {
  planMeasurementAction,
  startMeasurementAction,
  type BusinessImpactActionState,
} from "./business-impact-actions";
import { formatDate, formatNumber } from "@/lib/utils/format-datetime";

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
  // Deterministic across server and client — see format-datetime.ts. The
  // window's own timezone is printed by `windowRange`, so the day shown here
  // and the zone it was counted in are never conflated.
  return formatDate(iso) ?? iso;
}

/** A window as a person reads it: two dates and the zone they were counted in. */
function windowRange(window: { start: string; end: string; timezone: string }): string {
  // The end is exclusive, so the last *included* day is the day before it.
  const lastDay = new Date(Date.parse(window.end) - 1);
  return `${localDate(window.start)} – ${localDate(lastDay.toISOString())} (${window.timezone})`;
}

function formatValue(value: number): string {
  // `toLocaleString()` groups as `1,240` or `1.240` depending on the runtime's
  // locale, which is not cosmetic when the number is a count of anything.
  return formatNumber(value);
}

/** Signed, and never dressed up. A negative result reads as negative (§25). */
function formatRelative(relative: number): string {
  const percent = relative * 100;
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent).toFixed(1)}%`;
}

/*
 * `degraded` is `waiting`, not `problem`: an observed decline between two
 * windows is a thing to look at, and the panel's own copy says it does not
 * prove this change caused it. And `failed` here is Vibe's measurement
 * failing, never the customer's business — which is why neither is coral.
 */
const RESULT_TONE: Record<string, string> = {
  improved: statusToneText("success"),
  degraded: statusToneText("waiting"),
  neutral: statusToneText("neutral"),
  insufficient_data: statusToneText("neutral"),
  failed: statusToneText("waiting"),
};

function BeforeAfter({ card }: { card: BusinessImpactCard }) {
  if (card.baselineValue === null || card.observedValue === null) return null;

  return (
    <dl className="grid grid-cols-3 gap-3" data-testid="business-impact-values">
      <div>
        <dt className="text-xs text-fg-muted">Before</dt>
        <dd className="text-sm text-fg-body">{formatValue(card.baselineValue)}</dd>
      </div>
      <div>
        <dt className="text-xs text-fg-muted">After</dt>
        <dd className="text-sm text-fg-body">{formatValue(card.observedValue)}</dd>
      </div>
      <div>
        {/* "Observed change", never "impact" and never "uplift". The label is
            part of the causality safeguard, not decoration (§10, §24). */}
        <dt className="text-xs text-fg-muted">Observed change</dt>
        <dd className="text-sm text-fg-body">
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
        <dt className="text-xs text-fg-muted">Baseline</dt>
        <dd className="text-xs text-fg-prose">{windowRange(card.baselineWindow)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-fg-muted">Measurement window</dt>
        <dd className="text-xs text-fg-prose">{windowRange(card.measurementWindow)}</dd>
      </div>
      {card.resultAvailableAt && (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-fg-muted">Result available after</dt>
          <dd className="text-xs text-fg-prose">{localDate(card.resultAvailableAt)}</dd>
        </div>
      )}
    </dl>
  );
}

function MeasuredMetric({ card }: { card: BusinessImpactCard }) {
  if (!card.metricLabel) return null;

  return (
    <div className="space-y-1">
      <p className="text-sm text-fg-body">{card.metricLabel}</p>
      {card.businessGoal && <p className="text-xs text-fg-muted">{card.businessGoal}</p>}
    </div>
  );
}

export function BusinessImpactPanel({
  projectId,
  preparedChangeId,
  card,
  presentation = "section",
}: {
  projectId: string;
  preparedChangeId: string;
  card: BusinessImpactCard;
  /** Removes legacy divider chrome when history is nested in the Agent stage. */
  presentation?: "section" | "workspace";
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
      <section
        className={
          presentation === "workspace"
            ? "space-y-2"
            : "space-y-2 border-t border-line-2 pt-4"
        }
      >
        <h4 className="text-sm font-medium text-fg-secondary">Impact tracking</h4>
        <p className="text-sm text-fg-muted">Long-term impact has not been measured.</p>

        {/* Kept, but demoted: planning is free and deterministic — no analytics
            connection, no provider call, no model — and it records the intent
            rather than a result. It is an option, never a prerequisite. */}
        {card.state === "not_planned" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => run(planMeasurementAction)}
            disabled={pending}
          >
            Plan how this would be measured
          </Button>
        )}

        {state?.ok === false && <p className="text-sm text-coral">{state.message}</p>}
      </section>
    );
  }

  return (
    <section
      className={
        presentation === "workspace"
          ? "space-y-3"
          : "space-y-3 border-t border-line-2 pt-4"
      }
    >
      <h4 className="text-sm font-medium text-fg-body">Business impact</h4>

      {card.state === "scheduled" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">{card.headline}</p>
          <MeasuredMetric card={card} />
          <Windows card={card} />
          {/* No interim conclusion. The result does not exist yet, and saying
              anything about its direction would be a guess (§22). */}
          {card.canStartMeasuring && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => run(startMeasurementAction)}
              disabled={pending}
            >
              Start measuring
            </Button>
          )}
        </div>
      ) : card.state === "measuring" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">{card.headline}</p>
          <MeasuredMetric card={card} />
          {/* Factual progress only — days, never a percentage, and never
              "looking good" before the window closes (§23). */}
          <p className="text-sm text-fg-secondary">
            {card.daysObserved ?? 0} of {card.daysExpected ?? 0} complete days observed
          </p>
          <Windows card={card} />
        </div>
      ) : card.state === "insufficient_data" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">{card.headline}</p>
          <MeasuredMetric card={card} />
          <p className="text-sm text-fg-secondary">
            Not enough traffic was observed to make a meaningful comparison.
          </p>
          {/* What was required and what was seen, so the user can tell "this
              did not work" from "we cannot yet tell" (§26). */}
          <dl className="grid grid-cols-3 gap-3" data-testid="business-impact-samples">
            <div>
              <dt className="text-xs text-fg-muted">Needed each period</dt>
              <dd className="text-sm text-fg-body">{card.minimumObservations ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Observed before</dt>
              <dd className="text-sm text-fg-body">{card.sampleSizeBefore ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Observed after</dt>
              <dd className="text-sm text-fg-body">{card.sampleSizeAfter ?? "—"}</dd>
            </div>
          </dl>
          <Windows card={card} />
        </div>
      ) : card.state === "failed" ? (
        <div className="space-y-2">
          {/* A statement about Vibe's measurement, never about the metric (§33). */}
          <p className="text-sm text-amber">{card.headline}</p>
          {card.failureMessage && <p className="text-sm text-fg-secondary">{card.failureMessage}</p>}
          <p className="text-xs text-fg-muted">
            This says nothing about whether the metric moved — only that Vibe could not read it.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* improved / degraded / neutral. A negative result is shown exactly
              as prominently as a positive one (§25). */}
          <p className={`text-sm ${RESULT_TONE[card.state] ?? "text-fg-prose"}`}>{card.headline}</p>
          <MeasuredMetric card={card} />
          <BeforeAfter card={card} />
          <Windows card={card} />
          {card.dataQuality && card.dataQuality !== "complete" && (
            <p className="text-xs text-amber">
              Some days were missing from the data, so this comparison is not built on full periods.
            </p>
          )}
          {/* Required on every stated movement. A field on the card, so it
              cannot be dropped in a redesign (§24). */}
          {card.observedChangeDisclaimer && (
            <p className="text-xs text-fg-muted">{card.observedChangeDisclaimer}</p>
          )}
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-coral">{state.message}</p>}
    </section>
  );
}
