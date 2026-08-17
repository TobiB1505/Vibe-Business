import type { AIUsage } from "@/modules/ai/provider";
import { ACTOR_LABELS, EXECUTION_SUPPORT_LABELS, type ActionPlan } from "./schema";
import { firstActionableStep, planProgress } from "./sequence";
import type { PlannerSource } from "./source";
import type { PlanValidationFinding } from "./validate";

/**
 * The developer-readable Action Plan report (CORE-2b §62).
 *
 * This is the **primary evaluation surface** for this sprint, deliberately —
 * CORE-2b ships no customer UI (§61), so the way a plan is judged is by reading
 * one of these against the five dogfood questions in §92–§96:
 *
 *  1. does this read like it was written for *this* business?
 *  2. could Vibe have prepared more before asking the founder?
 *  3. for every executable step, does a real capability exist?
 *  4. is the first actionable step genuinely the next thing that could happen?
 *  5. if the whole plan succeeded, would the audit blocker be different?
 *
 * So the report is arranged to make those answerable rather than to look tidy:
 * the source judgment comes first, every step states who acts and what the
 * server concluded about execution, and the capability behind an executable
 * step is printed by name — an empty capability under an executable step would
 * be visible immediately.
 *
 * Plain text on purpose. It goes into a terminal and into a sprint document,
 * both of which outlive any screen this sprint might have built.
 */

export type PlanReportInput = {
  source: PlannerSource;
  plan: ActionPlan;
  findings: PlanValidationFinding[];
  usage?: AIUsage;
  estimatedInputTokens?: number | null;
  latencyMs?: number;
  /** Provider cost in USD, already computed by the pricing module. */
  providerCostUsd?: string | null;
};

function section(title: string): string {
  return `\n${title}\n${"─".repeat(title.length)}`;
}

export function renderActionPlanReport(input: PlanReportInput): string {
  const { plan, source } = input;
  const lines: string[] = [];

  lines.push("ACTION PLAN — dogfood report");
  lines.push(
    `${plan.contractVersion} · ${plan.plannerVersion} · ${plan.promptVersion} · ${plan.rubricVersion}`,
  );
  lines.push(`${plan.provider}/${plan.model} · evidence ${plan.evidencePackVersion}`);
  lines.push(`generated ${plan.generatedAt}`);

  lines.push(section("Source"));
  lines.push(`Move: ${source.opportunity.title} (rank ${source.opportunity.rank})`);
  lines.push(`  problem: ${source.opportunity.problem}`);
  lines.push(`  why now: ${source.opportunity.whyNow}`);
  lines.push(
    `Root business problem: ${source.conclusion?.rootProblem ?? "— none matched to this Move —"}`,
  );
  if (source.conclusion) {
    lines.push(`  headline: ${source.conclusion.headline}`);
    lines.push(`  lenses: ${source.conclusion.lenses.join(", ") || "—"}`);
  }
  for (const lens of source.lenses) {
    lines.push(`  ${lens.lens}: ${lens.health}, ${lens.materiality}`);
  }

  lines.push(section("Plan"));
  lines.push(`Goal:     ${plan.goal}`);
  lines.push(`Why now:  ${plan.whyNow}`);
  lines.push(`Outcome:  ${plan.expectedOutcome}`);
  lines.push(`Moves the root problem how: ${plan.addressesRootProblem}`);
  if (plan.assumptions.length > 0) {
    lines.push("Assumptions:");
    for (const assumption of plan.assumptions) lines.push(`  - ${assumption}`);
  }

  lines.push(section(`Steps (${plan.steps.length})`));
  for (const step of plan.steps) {
    const prerequisites =
      step.dependsOn.length > 0 ? `after ${step.dependsOn.join(", ")}` : "can start now";
    lines.push(`${step.order}. ${step.title}`);
    lines.push(`   ${step.description}`);
    lines.push(`   purpose:    ${step.purpose}`);
    lines.push(`   done when:  ${step.completionCriteria}`);
    lines.push(
      `   actor:      ${ACTOR_LABELS[step.actor]} (${step.actor}) · ${step.changeKind} · ${prerequisites}`,
    );
    // The execution-honesty line (§94). A capability is printed by name, so
    // "executable" with nothing behind it is impossible to miss.
    lines.push(
      `   execution:  ${EXECUTION_SUPPORT_LABELS[step.executionSupport]} (${step.executionSupport})` +
        ` · capability: ${step.capability ?? "none"}` +
        ` · approval: ${step.requiresApproval ? "required" : "not required"}`,
    );
    lines.push(`   evidence:   ${step.evidenceIds.join(", ") || "—"}`);
  }

  const next = firstActionableStep(plan.steps);
  lines.push(section("What could happen next"));
  lines.push(`Plan progress: ${planProgress(plan.steps)}`);
  lines.push(
    next
      ? `First actionable step: ${next.order}. ${next.title} — ${EXECUTION_SUPPORT_LABELS[next.executionSupport]}`
      : "First actionable step: none — every remaining step is waiting on something.",
  );

  const decisions = plan.steps.filter((step) => step.actor === "founder_decision");
  lines.push(section("Unresolved founder decisions"));
  if (decisions.length === 0) {
    lines.push("None.");
  } else {
    for (const step of decisions) {
      const prepared = plan.steps.filter(
        (other) => step.dependsOn.includes(other.order) && other.actor === "vibe",
      );
      // §93's question, answered mechanically: did Vibe do its homework before
      // asking? A decision with no Vibe preparation behind it is the thing to
      // look at first when reading this report.
      lines.push(
        `${step.order}. ${step.title} — prepared by ${prepared.length} Vibe step(s) before asking`,
      );
    }
  }

  lines.push(section("Validation"));
  lines.push(`Findings: ${input.findings.join(", ") || "none"}`);
  if (plan.validationNotes.length === 0) {
    lines.push("Notes: none.");
  } else {
    for (const note of plan.validationNotes) lines.push(`  - ${note}`);
  }

  lines.push(section("Cost"));
  if (input.usage) {
    lines.push(
      `input ${input.usage.inputTokens} · output ${input.usage.outputTokens} · reasoning ${input.usage.thinkingTokens}`,
    );
  } else {
    lines.push("No usage reported.");
  }
  if (input.estimatedInputTokens != null) {
    lines.push(`estimated input before the call: ${input.estimatedInputTokens}`);
  }
  if (input.latencyMs != null) lines.push(`latency: ${input.latencyMs} ms`);
  if (input.providerCostUsd) lines.push(`provider cost: $${input.providerCostUsd}`);

  return lines.join("\n");
}
