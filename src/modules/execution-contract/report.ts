import type { ActionPlanStep } from "@/modules/action-plans/schema";
import {
  firstExecutableStep,
  isAgentReady,
  isDeterministicReady,
  type ExecutionResolution,
} from "./schema";

/**
 * The §38 dogfood report.
 *
 * A plain-text table for a developer reading a terminal, not a customer
 * surface — internal enum values are shown deliberately, because the whole
 * point is to see what the resolver actually decided rather than the copy that
 * would eventually wrap it. Nothing here is rendered in the product (§40).
 *
 * Kept out of the probe so the shape is importable, testable and reviewable
 * without a database, exactly as `action-plans/report.ts` is.
 */

export type ExecutionReportInput = {
  plan: {
    id: string;
    goal: string | null;
    steps: readonly ActionPlanStep[];
  };
  repository: {
    fullName: string | null;
    frameworks: readonly string[];
    packageManager: string;
    snapshotCommitSha: string | null;
  };
  budgetAuthorized: boolean;
  resolutions: readonly ExecutionResolution[];
};

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

function readiness(resolution: ExecutionResolution): string {
  if (isDeterministicReady(resolution)) return "yes (deterministic)";
  if (isAgentReady(resolution)) return "yes (agentic)";
  return resolution.admission.admissible ? "no" : `no — ${resolution.admission.refusal}`;
}

export function renderExecutionResolutionReport(input: ExecutionReportInput): string {
  const byOrder = new Map(input.plan.steps.map((step) => [step.order, step]));
  const lines: string[] = [];

  lines.push("EXECUTION CORE-3 — resolver dogfood");
  lines.push("");
  lines.push(`plan            ${input.plan.id}`);
  lines.push(`goal            ${truncate(input.plan.goal ?? "(none)", 90)}`);
  lines.push(`repository      ${input.repository.fullName ?? "(not connected)"}`);
  lines.push(
    `stack           ${input.repository.frameworks.join(", ") || "(none detected)"} · package manager ${input.repository.packageManager}`,
  );
  lines.push(`analyzed commit ${input.repository.snapshotCommitSha ?? "(none)"}`);
  lines.push(
    `agentic budget  ${input.budgetAuthorized ? "authorized" : "not configured — no approved Credit policy prices agentic execution"}`,
  );
  lines.push("");

  const header = [
    pad("#", 3),
    pad("planner says", 20),
    pad("depends", 8),
    pad("resolved", 17),
    pad("if unblocked", 17),
    pad("risk", 11),
    pad("absorbs", 8),
    pad("agent-ready?", 34),
    "why",
  ].join(" ");
  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const resolution of input.resolutions) {
    const step = byOrder.get(resolution.stepOrder);
    lines.push(
      [
        pad(String(resolution.stepOrder), 3),
        pad(step?.executionSupport ?? "?", 20),
        pad(step?.dependsOn.length ? step.dependsOn.join(",") : "—", 8),
        pad(resolution.mode, 17),
        pad(resolution.mode === "blocked" ? resolution.intrinsicMode : "—", 17),
        pad(resolution.riskClass, 11),
        // Preparation this execution would carry out itself rather than wait
        // for (semantics fix §15). Blank is the common case.
        pad(resolution.absorbedPreparation.join(",") || "—", 8),
        pad(readiness(resolution), 34),
        resolution.reason,
      ].join(" "),
    );
  }

  lines.push("");
  lines.push("titles");
  for (const resolution of input.resolutions) {
    const step = byOrder.get(resolution.stepOrder);
    lines.push(`  ${resolution.stepOrder}. ${truncate(step?.title ?? "", 100)}`);
  }

  const unmet = input.resolutions.flatMap((resolution) =>
    resolution.unmetRequirements.map((reason) => `${resolution.stepOrder}: ${reason}`),
  );
  if (unmet.length > 0) {
    lines.push("");
    lines.push("unmet requirements");
    for (const entry of unmet) lines.push(`  ${entry}`);
  }

  const executable = input.resolutions.filter(
    (resolution) => isAgentReady(resolution) || isDeterministicReady(resolution),
  );
  lines.push("");
  lines.push(
    executable.length === 0
      ? "No step on this plan can be executed by Vibe right now."
      : `${executable.length} step(s) could be executed by Vibe right now.`,
  );

  // The execution layer's own "what could start now", read from the resolver
  // rather than from plan position (§17). Not the same question as the
  // Planner's first actionable step, and after the dependency fix not
  // necessarily the same answer either.
  const next = firstExecutableStep(input.resolutions);
  if (next) {
    const step = byOrder.get(next.stepOrder);
    lines.push(
      `First executable: #${next.stepOrder} — ${truncate(step?.title ?? "", 80)}` +
        (next.absorbedPreparation.length > 0
          ? ` (absorbing preparation ${next.absorbedPreparation.join(", ")})`
          : ""),
    );
  }

  return lines.join("\n");
}
