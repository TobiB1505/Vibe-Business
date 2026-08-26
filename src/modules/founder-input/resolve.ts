import type {
  FounderInputRequest,
  FounderInputResponse,
  FounderInputResponseSource,
} from "./schema";

export type ResolvedFounderInputResponse = {
  source: FounderInputResponseSource;
  selectedOptionId: string | null;
  rawAnswer: string | null;
  resolvedStatement: string;
};

/**
 * Resolves a browser response only against the persisted request contract.
 *
 * The model may have proposed the question and options, but it has no role in
 * accepting an answer or choosing the durable statement. That transition is
 * closed, bounded and deterministic here, and repeated inside the database
 * transaction before anything is persisted.
 */
export function resolveFounderInputResponse(
  request: FounderInputRequest,
  response: FounderInputResponse,
): ResolvedFounderInputResponse | null {
  if (response.source === "recommendation") {
    const recommendation = request.recommendation;
    if (!recommendation) return null;
    return {
      source: "recommendation",
      selectedOptionId: recommendation.id,
      rawAnswer: null,
      resolvedStatement: recommendation.value,
    };
  }

  if (response.source === "option") {
    const selected = request.alternatives.find(
      (option) => option.id === response.selectedOptionId,
    );
    if (!selected) return null;
    return {
      source: "option",
      selectedOptionId: selected.id,
      rawAnswer: null,
      resolvedStatement: selected.value,
    };
  }

  if (!request.allowCustom || typeof response.rawAnswer !== "string") return null;
  const resolvedStatement = response.rawAnswer.trim();
  if (!resolvedStatement || response.rawAnswer.length > 1200) return null;
  return {
    source: "custom",
    selectedOptionId: null,
    rawAnswer: response.rawAnswer,
    resolvedStatement,
  };
}
