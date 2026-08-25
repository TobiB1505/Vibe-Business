/**
 * Generic founder-owned information (ADR 0053).
 *
 * The business content is deliberately open-ended. The closed vocabulary is
 * only the interaction and authority contract around that content.
 */

export const FOUNDER_INPUT_KINDS = ["decision", "input"] as const;
export type FounderInputKind = (typeof FOUNDER_INPUT_KINDS)[number];

export const FOUNDER_INPUT_RESPONSE_TYPES = ["confirm", "single_select", "text"] as const;
export type FounderInputResponseType = (typeof FOUNDER_INPUT_RESPONSE_TYPES)[number];

export const FOUNDER_INPUT_RESPONSE_SOURCES = ["recommendation", "option", "custom"] as const;
export type FounderInputResponseSource = (typeof FOUNDER_INPUT_RESPONSE_SOURCES)[number];

export type FounderInputOption = {
  id: string;
  label: string;
  /** The durable statement downstream systems receive. */
  value: string;
  explanation: string | null;
};

export type FounderInputRequirement = {
  kind: FounderInputKind;
  /** Stable semantic identity, e.g. `monetization.pricing_model`; never display copy. */
  subjectKey: string;
  question: string;
  whyNeeded: string;
  responseType: FounderInputResponseType;
  recommendation: FounderInputOption | null;
  alternatives: FounderInputOption[];
  allowCustom: boolean;
};

export const FOUNDER_INPUT_REQUEST_ORIGINS = ["planner", "execution_blocker"] as const;
export type FounderInputRequestOrigin = (typeof FOUNDER_INPUT_REQUEST_ORIGINS)[number];

export const FOUNDER_INPUT_REQUEST_STATUSES = [
  "open",
  "resolved",
  "superseded",
  "cancelled",
] as const;
export type FounderInputRequestStatus = (typeof FOUNDER_INPUT_REQUEST_STATUSES)[number];

export type FounderInputRequest = FounderInputRequirement & {
  id: string;
  projectId: string;
  actionPlanId: string | null;
  actionPlanStepKey: string | null;
  executionInterruptId: string | null;
  origin: FounderInputRequestOrigin;
  contextHash: string;
  status: FounderInputRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type FounderInputResolution = {
  id: string;
  projectId: string;
  requestId: string;
  kind: FounderInputKind;
  subjectKey: string;
  responseSource: FounderInputResponseSource;
  selectedOptionId: string | null;
  rawAnswer: string | null;
  resolvedStatement: string;
  contextHash: string;
  supersedesResolutionId: string | null;
  supersededAt: string | null;
  createdAt: string;
};

export type FounderInputResponse = {
  source: FounderInputResponseSource;
  selectedOptionId?: string;
  rawAnswer?: string;
};

const SUBJECT_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function isFounderInputKind(value: unknown): value is FounderInputKind {
  return typeof value === "string" && FOUNDER_INPUT_KINDS.includes(value as FounderInputKind);
}

export function isFounderInputResponseType(value: unknown): value is FounderInputResponseType {
  return (
    typeof value === "string" &&
    FOUNDER_INPUT_RESPONSE_TYPES.includes(value as FounderInputResponseType)
  );
}

export function isFounderInputSubjectKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 96 &&
    SUBJECT_KEY_PATTERN.test(value)
  );
}
