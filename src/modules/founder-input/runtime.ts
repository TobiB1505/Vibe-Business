import { createHash } from "node:crypto";
import type { RuntimeFounderInputDraft } from "@/modules/coding-agent/provider";
import { normalizeFounderInputRequirement } from "./normalize";
import type { FounderInputRequirement } from "./schema";

export function executionSpecAlreadyResolvedFounderInput(
  approvedDecisions: readonly { key: string }[],
  requirement: Pick<FounderInputRequirement, "kind" | "subjectKey">,
): boolean {
  const key = `${requirement.kind}:${requirement.subjectKey}`;
  return approvedDecisions.some((decision) => decision.key === key);
}

/**
 * Converts one bounded runtime question into the same domain contract the
 * planner uses. The business content remains dynamic; only normalization,
 * identity, and interaction semantics are deterministic here.
 */
export function runtimeFounderInputRequirement(params: {
  stepKey: string;
  draft: RuntimeFounderInputDraft;
}): FounderInputRequirement | null {
  const question = params.draft.question.replace(/\s+/g, " ").trim();
  if (!question) return null;

  const subjectDigest = createHash("sha256")
    .update(JSON.stringify([params.stepKey, params.draft.kind, question.toLowerCase()]))
    .digest("hex")
    .slice(0, 24);

  const alternatives = params.draft.options.map((label, index) => ({
    id: `option-${index + 1}`,
    label,
    value: label,
    explanation: null,
  }));

  return normalizeFounderInputRequirement({
    kind: params.draft.kind,
    subjectKey: `runtime.${params.stepKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.${subjectDigest}`,
    question,
    whyNeeded:
      params.draft.kind === "decision"
        ? "This execution found a business choice that Vibe must not make without your confirmation."
        : "This execution is missing founder-owned information that it cannot safely infer from the project.",
    responseType: alternatives.length >= 2 ? "single_select" : "text",
    recommendation: null,
    alternatives,
    allowCustom: true,
  });
}
