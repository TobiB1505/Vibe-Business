"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import type { ValidationStepResult } from "@/modules/validation/schema";
import { getOperationStatusAction } from "./run-audit-action";
import { validateChangeAction, type ValidateChangeActionState } from "./validate-change-action";

/**
 * Isolated validation, as the user sees it (Sprint 10A §44, §45).
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
 */

const POLL_INTERVAL_MS = 2500;

/** Per-step copy. Named for the work, never a percentage (§17). */
const STEP_LABELS: Record<string, string> = {
  install: "Install dependencies",
  typecheck: "Check types",
  test: "Run tests",
  build: "Build application",
};

const STEP_SYMBOLS: Record<string, string> = {
  passed: "✓",
  failed: "✕",
  skipped: "–",
  timed_out: "⏱",
};

export type ValidationSummary = {
  status: "passed" | "failed" | "running" | "queued" | "cancelled";
  steps: Partial<Record<string, ValidationStepResult>>;
  failureMessage: string | null;
  sandboxDurationMs: number | null;
};

function StepRow({ name, step }: { name: string; step: ValidationStepResult }) {
  const tone =
    step.status === "passed"
      ? "text-emerald-400"
      : step.status === "skipped"
        ? "text-zinc-500"
        : "text-red-400";

  return (
    <li className="space-y-1">
      <div className="flex items-baseline gap-2 text-sm">
        <span className={tone}>{STEP_SYMBOLS[step.status] ?? "•"}</span>
        <span className="text-zinc-300">{STEP_LABELS[name] ?? name}</span>
        {step.status === "skipped" && (
          <span className="text-xs text-zinc-500">no {name} script in this project</span>
        )}
        {step.durationMs > 0 && (
          <span className="text-xs text-zinc-600">{(step.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      {/* A bounded tail only — never the whole build log. Rendered as escaped
          text in a <pre>: the content is untrusted output from code Vibe did
          not write, already ANSI-stripped and secret-redacted at storage. */}
      {step.status !== "passed" && step.status !== "skipped" && step.outputTail.length > 0 && (
        <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-400">
          {step.outputTail}
          {step.outputTruncated && "\n…output truncated"}
        </pre>
      )}
    </li>
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

  function validate() {
    startTransition(async () => {
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
      const result = await getOperationStatusAction(projectId, operationId);
      if (cancelled) return;
      if (result.ok) setPolled(result.operation);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, operationId, shouldPoll]);

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

  return (
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <h4 className="text-sm font-medium text-zinc-200">Validation</h4>

      {running ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">Validating in an isolated environment…</p>
          <p className="text-sm text-zinc-400">
            {operation ? OPERATION_STAGE_LABELS[operation.stage] : "Starting"}
          </p>
          {/* The Sprint 7 promise, restated where it matters: this runs for
              minutes and does not belong to the browser tab. */}
          <p className="text-xs text-zinc-500">You can leave this page.</p>
        </div>
      ) : summary?.status === "passed" ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-400">Validation passed</p>
          <p className="text-sm text-zinc-400">
            The application built successfully in an isolated environment.
          </p>
          <ul className="space-y-2">
            {Object.entries(summary.steps).map(([name, step]) =>
              step ? <StepRow key={name} name={name} step={step} /> : null,
            )}
          </ul>
          {/* Deliberately repeated after a pass. A green tick is exactly when
              someone is most likely to assume more happened than did. */}
          <p className="text-xs text-zinc-500">
            Not merged · Not deployed · Not reviewed by a human
          </p>
        </div>
      ) : summary?.status === "failed" ? (
        <div className="space-y-3">
          <p className="text-sm text-red-400">Validation failed</p>
          {summary.failureMessage && <p className="text-sm text-zinc-400">{summary.failureMessage}</p>}
          <ul className="space-y-2">
            {Object.entries(summary.steps).map(([name, step]) =>
              step ? <StepRow key={name} name={name} step={step} /> : null,
            )}
          </ul>
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
