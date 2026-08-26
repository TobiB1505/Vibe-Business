import {
  isFounderInputKind,
  isFounderInputResponseType,
  isFounderInputSubjectKey,
  type FounderInputOption,
  type FounderInputRequirement,
} from "./schema";

const MAX_QUESTION = 400;
const MAX_WHY = 600;
const MAX_OPTION_ID = 64;
const MAX_OPTION_LABEL = 120;
const MAX_OPTION_VALUE = 1200;
const MAX_OPTION_EXPLANATION = 400;
const MAX_ALTERNATIVES = 5;

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function option(value: unknown): FounderInputOption | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = boundedText(candidate.id, MAX_OPTION_ID);
  const label = boundedText(candidate.label, MAX_OPTION_LABEL);
  const resolvedValue = boundedText(candidate.value, MAX_OPTION_VALUE);
  if (!id || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id) || !label || !resolvedValue) {
    return null;
  }
  return {
    id,
    label,
    value: resolvedValue,
    explanation: boundedText(candidate.explanation, MAX_OPTION_EXPLANATION),
  };
}

/**
 * Validates model-authored request content independently of structured-output
 * schema compliance. Invalid requests are discarded; they never degrade into a
 * blank text field or a fabricated default.
 */
export function normalizeFounderInputRequirement(value: unknown): FounderInputRequirement | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isFounderInputKind(candidate.kind)) return null;
  if (!isFounderInputSubjectKey(candidate.subjectKey)) return null;
  if (!isFounderInputResponseType(candidate.responseType)) return null;

  const question = boundedText(candidate.question, MAX_QUESTION);
  const whyNeeded = boundedText(candidate.whyNeeded, MAX_WHY);
  if (!question || !whyNeeded) return null;

  const recommendation = candidate.recommendation === null ? null : option(candidate.recommendation);
  if (candidate.recommendation !== null && !recommendation) return null;

  const alternatives = Array.isArray(candidate.alternatives)
    ? candidate.alternatives
        .slice(0, MAX_ALTERNATIVES)
        .map(option)
        .filter((entry): entry is FounderInputOption => entry !== null)
    : [];

  if (
    candidate.responseType === "confirm" &&
    recommendation === null &&
    alternatives.length === 0
  ) {
    return null;
  }
  if (
    candidate.responseType === "single_select" &&
    recommendation === null &&
    alternatives.length === 0 &&
    candidate.allowCustom !== true
  ) {
    return null;
  }

  const ids = [recommendation, ...alternatives]
    .filter((entry): entry is FounderInputOption => entry !== null)
    .map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) return null;

  return {
    kind: candidate.kind,
    subjectKey: candidate.subjectKey,
    question,
    whyNeeded,
    responseType: candidate.responseType,
    recommendation,
    alternatives,
    allowCustom: candidate.allowCustom === true,
  };
}
