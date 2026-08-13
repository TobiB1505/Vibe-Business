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
  passed: "text-emerald-400",
  failed: "text-red-400",
  timed_out: "text-red-400",
  skipped: "text-zinc-500",
  active: "text-sky-400",
  pending: "text-zinc-600",
  not_run: "text-zinc-600",
};

export type { ValidationSummary };

function PhaseRow({ phase }: { phase: ValidationPhaseView }) {
  const active = phase.state === "active";
  const muted = phase.state === "pending" || phase.state === "not_run";

  return (
    <li className="space-y-1">
      <div className="flex items-baseline gap-2 text-sm">
        <span className={PHASE_TONES[phase.state]}>{PHASE_SYMBOLS[phase.state]}</span>
        <span className={muted ? "text-zinc-500" : "text-zinc-300"}>
          {active ? `${phase.activeLabel}…` : phase.label}
        </span>
        {phase.state === "skipped" && (
          <span className="text-xs text-zinc-500">no script for this in the project</span>
        )}
        {phase.durationMs !== null && (
          <span className="text-xs text-zinc-600">{(phase.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      {/* A bounded tail only — never the whole build log. Rendered as escaped
          text in a <pre>: the content is untrusted output from code Vibe did
          not write, already ANSI-stripped and secret-redacted at storage. */}
      {phase.outputTail && (
        <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-400">
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
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <h4 className="text-sm font-medium text-zinc-200">Validation</h4>

      {running ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Validating in an isolated environment…</p>
          {/* Real phases, from the database, updating as each one finishes.
              Before the first phase records itself there is nothing truthful to
              show, so the panel says only that it has started. */}
          {liveSummary ? (
            <PhaseList phases={liveSummary.phases} />
          ) : (
            <p className="text-sm text-zinc-400">Starting an isolated environment</p>
          )}
          {/* The Sprint 7 promise, restated where it matters: this runs for
              minutes and does not belong to the browser tab. */}
          <p className="text-xs text-zinc-500">You can leave this page.</p>
        </div>
      ) : shown?.status === "passed" ? (
        <div className="space-y-3">
          <p className={shown.underCurrentPolicy ? "text-sm text-emerald-400" : "text-sm text-amber-400"}>
            {shown.underCurrentPolicy ? "Validation passed" : "Validated under an earlier policy"}
          </p>
          <p className="text-sm text-zinc-400">
            {shown.underCurrentPolicy
              ? "The application built successfully in an isolated environment."
              : "This result was produced before Vibe's validation rules changed. It still describes what was checked at the time, but not what would be checked now."}
          </p>
          <PhaseList phases={shown.phases} />
          {/* Deliberately repeated after a pass. A green tick is exactly when
              someone is most likely to assume more happened than did. */}
          <p className="text-xs text-zinc-500">
            Not merged · Not deployed · Not reviewed by a human
          </p>

          {/* Always available, and always safe: validation identity plus
              artifact availability decide what happens. A current pass with a
              live artifact is reused; a missing/expired artifact or a policy
              change starts the explicit new validation the user requested. */}
          <button
            type="button"
            onClick={validate}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
          >
            {shown.underCurrentPolicy ? "Validate again" : "Validate under current policy"}
          </button>
        </div>
      ) : shown?.status === "failed" ? (
        <div className="space-y-3">
          <p className="text-sm text-red-400">
            {failed ? `Validation failed at ${failed.label.toLowerCase()}` : "Validation failed"}
          </p>
          {shown.failureMessage && <p className="text-sm text-zinc-400">{shown.failureMessage}</p>}
          <PhaseList phases={shown.phases} />
          {/* Says which phases never happened, rather than leaving empty
              circles that read as "still to come" on a run that is over. */}
          {shown.phases.some((phase) => phase.state === "not_run") && (
            <p className="text-xs text-zinc-500">
              Later checks were not run: Vibe stops at the first failure rather than spending
              sandbox time on a change that already needs work.
            </p>
          )}
          <button
            type="button"
            onClick={validate}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
          >
            Validate again
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Not validated</p>
          <p className="text-xs text-zinc-500">
            Vibe will check out this exact commit in an isolated environment, install dependencies,
            and build it. Your repository is not modified.
          </p>
          <button
            type="button"
            onClick={validate}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
          >
            Validate change
          </button>
        </div>
      )}

      {state?.ok === false && (
        <p className="text-sm text-red-400">
          {OPERATION_FAILURE_MESSAGES[state.error as keyof typeof OPERATION_FAILURE_MESSAGES] ??
            "Validation could not be started."}
        </p>
      )}

      {state?.ok && state.kind === "reused" && (
        <p className="text-xs text-zinc-500">
          This commit already passed validation under the current policy — nothing was re-run.
        </p>
      )}
    </section>
  );
}
