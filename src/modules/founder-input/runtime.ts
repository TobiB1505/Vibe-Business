import { createHash } from "node:crypto";
import type { RuntimeFounderInputDraft } from "@/modules/coding-agent/provider";
import { normalizeFounderInputRequirement } from "./normalize";
import type { FounderInputRequirement } from "./schema";

/**
 * The readable half of a runtime subject key, bounded so the whole key fits.
 *
 * `isFounderInputSubjectKey` caps a subject key at 96 characters. The rest of
 * the key is fixed: `"runtime."` (8) + `"."` (1) + a 24-character digest, so
 * the step segment has 63 to spend. A step key is
 * `${order}-${changeKind}-${slug(title)}` with the title slug capped at 48,
 * and `product_change` alone is 15 — an ordinary title such as "Add a clear
 * pricing section to the marketing homepage" already produces a 65-character
 * step key and a 98-character subject key.
 *
 * That over-length key failed validation, so `normalizeFounderInputRequirement`
 * returned null and the run reported `missing_required_context` — it failed
 * instead of asking the founder the question, which is the one thing this whole
 * path exists to do, on the commonest change kind, after the founder had paid
 * for the attempt.
 *
 * Truncation is safe because the digest, not this segment, carries identity:
 * it already hashes the full step key, so two different steps cannot collide
 * on a shared prefix. A step key that sanitizes to nothing yields the empty
 * segment rather than a leading separator, and the digest still keys it.
 */
const RUNTIME_STEP_SEGMENT_MAX = 63;

function runtimeStepSegment(stepKey: string): string {
  return stepKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, RUNTIME_STEP_SEGMENT_MAX)
    .replace(/-$/, "");
}

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
    subjectKey: `runtime.${runtimeStepSegment(params.stepKey)}.${subjectDigest}`,
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
