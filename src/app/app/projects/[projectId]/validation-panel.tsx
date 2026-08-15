"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import type { OperationView } from "@/modules/operations/view";
import { failedPhase, type ValidationPhaseView, type ValidationSummary } from "@/modules/validation/view";
import { getValidationProgressAction, validateChangeAction, type ValidateChangeActionState } from "./validate-change-action";

/**
 * Isolated validation, as the user sees it (Sprint 10A §44, §45, §15 refactor).
 *
 * ## The vocabulary is the product guarantee
 *
 * "Validation passed" means exactly one thing: the configured checks succeeded
 * inside an isolated environment. It is deliberately never rendered as *safe*,
 * *correct*, *approved* or *production ready*, because those are different
 * gates and the previous sprint proved why. The first prepared change was
 * byte-perfect and would have passed a build — and it still put `/login` in a
 * sitemap. A green build says nothing about whether the change is a good idea.
 *
 * So the panel keeps showing what has *not* happened, next to what has:
 *
 * ```
 * repository_write_verified → sandbox_validation_passed → human review → merge → deploy
 *                                                    ↑ we are here
 * ```
 *
 * ## Progress is read, never inferred
 *
 * A validation takes about five minutes, and for most of that the user is
 * looking at this component. It renders six named phases with real elapsed
 * seconds, all derived on the server from the ValidationRun row — the same row
 * each durable step writes as it finishes.
 *
 * Two things it deliberately does not do. It does not read the workflow's
 * internal step index, which would tie product copy to a third-party execution
 * detail and would report progress for work whose result was never persisted.
 * And it does not show a percentage, because the phases have wildly different
 * durations and any number here would be invented.
 */

const POLL_INTERVAL_MS = 2500;

const PHASE_SYMBOLS: Record<ValidationPhaseView["state"], string> = {
  passed: "✓",
  failed: "✕",
  timed_out: "⏱",
  skipped: "–",
  active: "●",
  pending: "○",
  not_run: "○",
};

const PHASE_TONES: Record<ValidationPhaseView["state"], string> = {
  passed: "text-mint",
  failed: "text-coral",
  timed_out: "text-coral",
  skipped: "text-fg-muted",
  active: "text-sky-400",
  pending: "text-fg-meta",
  not_run: "text-fg-meta",
};

export type { ValidationSummary };

function PhaseRow({ phase }: { phase: ValidationPhaseView }) {
  const active = phase.state === "active";
  const muted = phase.state === "pending" || phase.state === "not_run";

  return (
    <li className="space-y-1">
      <div className="flex items-baseline gap-2 text-sm">
        <span className={PHASE_TONES[phase.state]}>{PHASE_SYMBOLS[phase.state]}</span>
        <span className={muted ? "text-fg-muted" : "text-fg-prose"}>
          {active ? `${phase.activeLabel}…` : phase.label}
        </span>
        {phase.state === "skipped" && (
          <span className="text-xs text-fg-muted">no script for this in the project</span>
        )}
        {phase.durationMs !== null && (
          <span className="text-xs text-fg-meta">{(phase.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      {/* A bounded tail only — never the whole build log. Rendered as escaped
          text in a <pre>: the content is untrusted output from code Vibe did
          not write, already ANSI-stripped and secret-redacted at storage. */}
      {phase.outputTail && (
        <pre className="overflow-x-auto rounded-md border border-line-2 bg-app p-3 text-xs leading-relaxed text-fg-secondary">
          {phase.outputTail}
          {phase.outputTruncated && "\n…output truncated"}
        </pre>
      )}
    </li>
  );
}

function PhaseList({ phases }: { phases: ValidationPhaseView[] }) {
  return (
    <ul className="space-y-2">
      {phases.map((phase) => (
        <PhaseRow key={phase.phase} phase={phase} />
      ))}
    </ul>
  );
}

export function ValidationPanel({
  projectId,
  preparedChangeId,
  summary,
  runningOperation,
}: {
  projectId: string;
  preparedChangeId: string;
  /** The latest stored validation for this artifact, if any. */
  summary: ValidationSummary | null;
  /** A validation already in flight when the page rendered. */
  runningOperation: OperationView | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<ValidateChangeActionState>(null);
  const [pending, startTransition] = useTransition();
  const [polled, setPolled] = useState<OperationView | null>(runningOperation);
  /**
   * Live phase state, replacing the server-rendered summary while a run is in
   * flight.
   *
   * The whole point of the durable-phase refactor from the user's side: without
   * this the panel could only say "validating…" for five minutes, because the
   * server render happened before any phase had finished.
   */
  const [liveSummary, setLiveSummary] = useState<ValidationSummary | null>(null);

  function validate() {
    startTransition(async () => {
      setLiveSummary(null);
      setState(await validateChangeAction(projectId, preparedChangeId));
    });
  }

  const started = state?.ok && state.kind === "running" ? state.operation : null;
  const operation = started && polled?.operationId !== started.operationId ? started : polled;

  const operationId = operation?.operationId ?? null;
  const shouldPoll = operation?.shouldPoll ?? false;

  useEffect(() => {
    if (!operationId || !shouldPoll) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const result = await getValidationProgressAction(projectId, preparedChangeId, operationId);
      if (cancelled || !result.ok) return;
      setPolled(result.operation);
      // May legitimately be null before the first phase is recorded.
      setLiveSummary(result.summary);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, preparedChangeId, operationId, shouldPoll]);

  /**
   * Pull the result in once the operation stops.
   *
   * `summary` is rendered on the server, so without this the panel fell back to
   * "Not validated" the moment polling ended — which is exactly what the first
   * real run looked like from the outside: the button flickered and the failure
   * was invisible. The verdict lives in the database; this is what fetches it.
   */
  useEffect(() => {
    if (!operation) return;
    if (operation.status === "queued" || operation.status === "running") return;
    router.refresh();
  }, [operation, router]);

  const running =
    pending || (operation !== null && (operation.status === "queued" || operation.status === "running"));

  const shown = running ? (liveSummary ?? summary) : summary;
  const failed = shown ? failedPhase(shown.phases) : null;

  return (
    <section className="space-y-3 border-t border-line-2 pt-4">
      {/* "Safety checks" rather than "Validation" (Sprint UI-3.5). The
          internal vocabulary is unchanged — the stored status is still
          `passed`/`failed`, and it is shown verbatim in the details below. */}
      <h4 className="text-sm font-medium text-fg-body">Safety checks</h4>

      {running ? (
        <div className="space-y-3">
          <p className="text-sm text-fg-prose">Vibe is checking the change in a safe, isolated copy of your project…</p>
          {/* Real phases, from the database, updating as each one finishes.
              Before the first phase records itself there is nothing truthful to
              show, so the panel says only that it has started. */}
          {liveSummary ? (
            <PhaseList phases={liveSummary.phases} />
          ) : (
            <p className="text-sm text-fg-secondary">Starting an isolated environment</p>
          )}
          {/* The Sprint 7 promise, restated where it matters: this runs for
              minutes and does not belong to the browser tab. */}
          <p className="text-xs text-fg-muted">You can leave this page.</p>
        </div>
      ) : shown?.status === "passed" ? (
        <div className="space-y-3">
          <p className={shown.underCurrentPolicy ? "text-sm text-mint" : "text-sm text-amber"}>
            {shown.underCurrentPolicy
              ? "All safety checks passed"
              : "Checked under earlier rules"}
          </p>
          <p className="text-sm text-fg-secondary">
            {shown.underCurrentPolicy
              ? "Your project still builds, and the change matches the exact commit Vibe prepared."
              : "This result was produced before Vibe's validation rules changed. It still describes what was checked at the time, but not what would be checked now."}
          </p>
          <PhaseList phases={shown.phases} />
          {/* Deliberately repeated after a pass. A green tick is exactly when
              someone is most likely to assume more happened than did. */}
          {/* Deliberately repeated after a pass, and deliberately explicit
              about what passing does *not* establish. A green tick is exactly
              when someone is most likely to assume more happened than did. */}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-fg-muted">
              Not merged · Not deployed · Not reviewed by a human
            </p>
            <p className="text-fg-meta max-w-[70ch] text-xs">
              Passing these checks means the change is technically sound. It is not a judgement
              about whether the idea behind it will work for your business.
            </p>
          </div>

          {/* Always available, and always safe: validation identity plus
              artifact availability decide what happens. A current pass with a
              live artifact is reused; a missing/expired artifact or a policy
              change starts the explicit new validation the user requested. */}
          <button
            type="button"
            onClick={validate}
            disabled={pending}
            className="rounded-md border border-line-4 px-3 py-1.5 text-sm text-fg-body hover:bg-surface-2 disabled:opacity-60"
          >
            {shown.underCurrentPolicy ? "Validate again" : "Validate under current policy"}
          </button>
        </div>
      ) : shown?.status === "failed" ? (
        <div className="space-y-3">
          <p className="text-sm text-coral">
            {failed ? `A safety check did not pass: ${failed.label.toLowerCase()}` : "A safety check did not pass"}
          </p>
          {shown.failureMessage && <p className="text-sm text-fg-secondary">{shown.failureMessage}</p>}
          <PhaseList phases={shown.phases} />
          {/* Says which phases never happened, rather than leaving empty
              circles that read as "still to come" on a run that is over. */}
          {shown.phases.some((phase) => phase.state === "not_run") && (
            <p className="text-xs text-fg-muted">
              Later checks were not run: Vibe stops at the first failure rather than spending
              sandbox time on a change that already needs work.
            </p>
          )}
          <button
            type="button"
            onClick={validate}
            disabled={pending}
            className="rounded-md border border-line-4 px-3 py-1.5 text-sm text-fg-body hover:bg-surface-2 disabled:opacity-60"
          >
            Validate again
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">Not validated</p>
          <p className="text-xs text-fg-muted">
            Vibe will check out this exact commit in an isolated environment, install dependencies,
            and build it. Your repository is not modified.
          </p>
          <button
            type="button"
            onClick={validate}
            disabled={pending}
            className="rounded-md border border-line-4 px-3 py-1.5 text-sm text-fg-body hover:bg-surface-2 disabled:opacity-60"
          >
            Validate change
          </button>
        </div>
      )}

      {state?.ok === false && (
        <p className="text-sm text-coral">
          {OPERATION_FAILURE_MESSAGES[state.error as keyof typeof OPERATION_FAILURE_MESSAGES] ??
            "Validation could not be started."}
        </p>
      )}

      {state?.ok && state.kind === "reused" && (
        <p className="text-xs text-fg-muted">
          This commit already passed validation under the current policy — nothing was re-run.
        </p>
      )}
    </section>
  );
}
