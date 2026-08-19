import type { StepChangeKind } from "@/modules/action-plans/schema";
import {
  deriveExecutionSurfaceRequirement,
  type ExecutionSurfaceRequirement,
} from "@/modules/execution-context/surface";
import type { BusinessSurfaceId } from "@/modules/repository-intelligence/schema";

/**
 * Turning a trusted Action Step into a Conventional-Commits message
 * (Sprint 0046).
 *
 * ## The problem
 *
 * Every agentic commit reads `vibe: implement plan step 4`. Traceable to
 * Vibe's own state, useless to a human reading GitHub or Vercel afterwards —
 * nobody can tell what four is, let alone what it changed.
 *
 * ## The two trusted inputs, and the one that stays untrusted
 *
 * `title` / `purpose` / `doneWhen` are the Planner's own words, read from the
 * same trusted Action Step `execution-context/service.ts`'s `loadPlanStep`
 * already resolves for context compilation and Agent Verification — the
 * fixture registry first, then the project's real plan, never a second
 * lookup. Using them for a commit *subject* is new as of this sprint — see
 * the sprint doc for why that narrows Rule 57 rather than breaking it — but
 * using them for *classification* (which surface, which kind of change) is
 * not new at all: it is exactly what `execution-context/compiler.ts` has done
 * since Sprint 0041.
 *
 * `changeKind` / `evidenceIds` are Vibe-minted, validated against the
 * evidence pack at planning time, and already the trusted routing signal for
 * risk (`risk.ts`), Agent Verification (`verification.ts`) and the Execution
 * Surface (`surface.ts`, Sprint 0044). Scope is derived from them first, for
 * the same reason: evidence beats prose, and Sprint 0044 exists because prose
 * alone let two different steps of one plan compile identically.
 *
 * What never reaches this function: the coding agent's own final message, any
 * tool-call argument, any byte of repository content. Rule 77 already forbids
 * reading the agent's account of its own work; this file has no parameter
 * such an account could arrive through.
 */

export const COMMIT_MESSAGE_COMPILER_VERSION = "commit-message-v1" as const;

/* ---------------------------------------------------------------------------
 * The vocabulary (PART C, PART D)
 * ------------------------------------------------------------------------ */

/**
 * A closed, server-owned type vocabulary.
 *
 * Closed because a model choosing its own type is a model choosing what a
 * human believes the change was. `chore` is the deliberate floor: PART C asks
 * for it to be the safe fallback rather than letting every unclassified change
 * read as `feat`, which would make the type field decorative.
 */
export const COMMIT_TYPES = ["feat", "fix", "perf", "refactor", "test", "docs", "chore"] as const;
export type CommitType = (typeof COMMIT_TYPES)[number];

/**
 * A closed, server-owned scope vocabulary.
 *
 * Two tiers feed it — see `classifyScope` — but the *output* is always one of
 * these ten. A scope a model invented would be a free-text field with extra
 * steps; a bare `feat: …` with no scope is preferred over a scope that isn't
 * one of these (PART D).
 */
export const COMMIT_SCOPES = [
  "seo",
  "marketing",
  "auth",
  "billing",
  "agent",
  "validation",
  "ui",
  "github",
  "infra",
  "analytics",
] as const;
export type CommitScope = (typeof COMMIT_SCOPES)[number];

export const COMMIT_MESSAGE_FALLBACK_REASONS = [
  /** No trusted step was available to compile from at all. */
  "no_trusted_step",
  /** A step existed, but its title sanitised to nothing usable as a subject. */
  "subject_not_meaningful",
] as const;
export type CommitMessageFallbackReason = (typeof COMMIT_MESSAGE_FALLBACK_REASONS)[number];

/* ---------------------------------------------------------------------------
 * Sanitisation (PART N)
 * ------------------------------------------------------------------------ */

/** A subject line this long is truncated; longer than this, gracefully. */
const MAX_SUBJECT_LENGTH = 100;
/** The length PART E asks for. Not enforced as a hard ceiling — 100 is. */
const TARGET_SUBJECT_LENGTH = 72;
/** How much of the purpose/doneWhen text a keyword scan reads. Bounded, not parsed. */
const MAX_CLASSIFICATION_TEXT = 600;

const C0_CONTROL_MAX = 0x1f;
const DEL_CHAR = 0x7f;
const C1_CONTROL_MIN = 0x80;
const C1_CONTROL_MAX = 0x9f;

/**
 * Strips every control character and newline from a value bound for a commit
 * line — walked by code point rather than matched with a regex literal, so no
 * control byte is ever written into this file's own source.
 *
 * PART N's own example is a title that reads `foo`, a blank line, then
 * `Vibe-Execution: fake` — an attempt to forge a trailer by putting a blank
 * line and a trailer-shaped string inside Planner text. Once every newline
 * here is collapsed to a space there is no blank line left to open a trailer
 * block with, and the trailers below are never built by scanning this string
 * in the first place — they come from separate, Vibe-computed identifiers.
 * Two independent reasons the injection in that example cannot work, not one.
 */
function sanitizeLine(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl =
      code <= C0_CONTROL_MAX || code === DEL_CHAR || (code >= C1_CONTROL_MIN && code <= C1_CONTROL_MAX);
    out += isControl ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const atSpace = cut.lastIndexOf(" ");
  return `${atSpace > max * 0.6 ? cut.slice(0, atSpace) : cut}…`;
}

/**
 * Low-information subjects the old generator produced, or that any future
 * caller could hand in by accident. If sanitisation lands here, the result is
 * treated as no subject at all rather than shipped (PART E's own bad-example
 * list).
 */
const BANNED_SUBJECTS = [
  /^implement plan step\b/i,
  /^apply changes$/i,
  /^update files$/i,
  /^completed the requested task/i,
  /^vibe:/i,
];

/**
 * A title, reduced to a Conventional-Commits subject.
 *
 * Lowercases only the first character — the convention — and leaves the rest
 * exactly as the Planner wrote it, so an acronym like `URLs` or `CTA` survives
 * intact rather than being mangled by a blanket lowercase. Strips one trailing
 * period, because `type: subject.` is not the convention either.
 */
function toSubject(title: string): string | null {
  const cleaned = sanitizeLine(title).replace(/\.$/, "");
  if (cleaned.length === 0) return null;
  if (BANNED_SUBJECTS.some((pattern) => pattern.test(cleaned))) return null;

  const subject = cleaned[0]!.toLowerCase() + cleaned.slice(1);
  return truncate(subject, MAX_SUBJECT_LENGTH);
}

/* ---------------------------------------------------------------------------
 * Type classification (PART C)
 * ------------------------------------------------------------------------ */

/**
 * Keyword buckets, checked in this order. Order is the whole of the
 * precedence rule: a title that reads "fix" and "faster" is a fix, because
 * concrete evidence of a defect outranks a performance claim about the same
 * change.
 *
 * `feat` sits second-to-last, not first, on purpose (PART C: "avoid turning
 * every unknown change into feat"). Its keywords — add, create, introduce,
 * improve — are the most common verbs in ordinary English, so putting the
 * bucket anywhere but last-before-the-floor would make every more specific
 * bucket unreachable through it.
 */
const TYPE_KEYWORDS: readonly { type: CommitType; pattern: RegExp }[] = [
  {
    // "regression" is deliberately absent: "a performance regression" is
    // idiomatic perf vocabulary, and including it here made the perf fixture
    // below misclassify as fix. What is left is unambiguous defect language.
    type: "fix",
    pattern:
      /\b(fix(?:es|ed)?|bugs?|broken|incorrect|defect|resolves?|resolved|repairs?|fails?(?:\s+to)?|failing|does not work|doesn't work)\b/i,
  },
  {
    type: "perf",
    pattern: /\b(performance|latency|faster|speeds? up|slow(?:ness)?|optimi[sz](?:e|ation)|blocking render|render time)\b/i,
  },
  {
    type: "refactor",
    pattern: /\b(refactor|consolidat\w*|restructur\w*|simplif\w*|clean(?:s|ed|ing)?[\s-]?up|dedupl\w*|reorgani[sz]\w*)\b/i,
  },
  { type: "test", pattern: /\b(tests?|test coverage|e2e (?:test|suite))\b/i },
  { type: "docs", pattern: /\b(docs?|documentation|readme|changelog)\b/i },
  {
    type: "feat",
    pattern: /\b(adds?|adding|introduc\w*|creat\w*|enabl\w*|builds?|launch\w*|improv\w*|new\b)\b/i,
  },
];

/**
 * The type, from the title alone first and the rest of the trusted text only
 * if the title gives no signal.
 *
 * Title-first is deliberate, not just cheap. Run #7's own stored Planner
 * *purpose* text — "so indexing **consolidates** correctly on the intended
 * URL" — contains the refactor bucket's own keyword, purely incidentally, in
 * a step that unambiguously adds a feature. A title is short and imperative by
 * the Planner's own convention ("Add canonical URLs…"); purpose and doneWhen
 * are longer descriptive prose with far more surface for an accidental match.
 * Reading the short, high-signal field first and the long, collision-prone
 * field only as a fallback is the same shape Sprint 0044 used for execution
 * surfaces, applied to this one extra axis prose is still needed for.
 */
function classifyType(title: string, purpose: string, doneWhen: string): CommitType {
  for (const { type, pattern } of TYPE_KEYWORDS) {
    if (pattern.test(title)) return type;
  }

  const rest = `${purpose} ${doneWhen}`.slice(0, MAX_CLASSIFICATION_TEXT);
  for (const { type, pattern } of TYPE_KEYWORDS) {
    if (pattern.test(rest)) return type;
  }

  return "chore";
}

/* ---------------------------------------------------------------------------
 * Scope classification (PART D)
 * ------------------------------------------------------------------------ */

/**
 * Business surface → scope. Vibe's own vocabulary, mapped once.
 *
 * Only surfaces with a confident, stable human category get a row. A surface
 * left out here still resolves — through `public_pages`/`authenticated_pages`
 * below, or the keyword tier — or the scope is correctly omitted.
 */
const SURFACE_SCOPE: Partial<Record<BusinessSurfaceId, CommitScope>> = {
  seo_metadata: "seo",
  sitemap: "seo",
  robots: "seo",
  pricing_page: "billing",
  checkout_billing: "billing",
  payments: "billing",
  authentication: "auth",
  analytics: "analytics",
  dashboard_app: "ui",
  contact: "marketing",
  docs_help: "marketing",
  legal: "marketing",
  blog_content: "marketing",
  onboarding: "marketing",
};

/**
 * Domain keywords, the tier below evidence. Only consulted when the evidence
 * ids resolved nothing at all (`requirement.derivedFrom.length === 0`) — the
 * same "nothing recognised" signal `compiler.ts` already reads to decide
 * whether to trust its evidence-derived surfaces over its prose fallback.
 *
 * This is the tier that lets `agent`, `validation`, `ui`, `github` and `infra`
 * exist at all: none of them is a customer business surface, so no evidence id
 * will ever name one. They are reachable only through the step's own trusted
 * text, title first and purpose/doneWhen second, exactly like type.
 */
const SCOPE_KEYWORDS: readonly { scope: CommitScope; pattern: RegExp }[] = [
  { scope: "seo", pattern: /\b(seo|canonical|sitemap|robots\.txt|open graph|meta tags?)\b/i },
  { scope: "marketing", pattern: /\b(landing page|call to action|\bcta\b|hero section|marketing)\b/i },
  { scope: "auth", pattern: /\b(auth(?:entication)?|sign[\s-]?in|sign[\s-]?up|login|session)\b/i },
  { scope: "billing", pattern: /\b(billing|credits?|stripe|invoice|reservation)\b/i },
  {
    scope: "agent",
    pattern: /\b(coding agent|agent execution|sandbox agent|completion budget|verification plan|diff review)\b/i,
  },
  { scope: "validation", pattern: /\b(independent validation|validation (?:run|sandbox|profile))\b/i },
  { scope: "github", pattern: /\b(github|repository probe|octokit|installation token)\b/i },
  { scope: "infra", pattern: /\b(migration|deployment|infrastructure|ci pipeline)\b/i },
  { scope: "ui", pattern: /\b(\bui\b|component|front-?end|polling|render(?:ing)?)\b/i },
  { scope: "analytics", pattern: /\b(analytics|tracking|telemetry)\b/i },
];

function scopeFromKeywords(title: string, purpose: string, doneWhen: string): CommitScope | null {
  for (const { scope, pattern } of SCOPE_KEYWORDS) {
    if (pattern.test(title)) return scope;
  }
  const rest = `${purpose} ${doneWhen}`.slice(0, MAX_CLASSIFICATION_TEXT);
  for (const { scope, pattern } of SCOPE_KEYWORDS) {
    if (pattern.test(rest)) return scope;
  }
  return null;
}

/**
 * The scope, evidence first.
 *
 * Three tiers, in order:
 *
 * 1. A resolved business surface — the strongest signal, because it is
 *    Vibe-minted and validated, never text.
 * 2. `public_pages` with no named surface — the marketing-CTA shape (PART D's
 *    own example: "public marketing / CTA → marketing"). A step whose only
 *    signal is "this touches the public pages" is a marketing-flavoured step
 *    even when nothing else about it names a business surface.
 * 3. Keyword classification of the trusted text, and only when the evidence
 *    ids resolved *nothing at all* — never as a tiebreaker against evidence
 *    that did resolve, which would let prose override Vibe's own minted ids.
 *
 * Omits rather than guesses when none of the three produces an answer.
 */
function classifyScope(
  requirement: ExecutionSurfaceRequirement,
  title: string,
  purpose: string,
  doneWhen: string,
): CommitScope | null {
  for (const surface of requirement.surfaces) {
    const scope = SURFACE_SCOPE[surface];
    if (scope) return scope;
  }

  if (requirement.scopes.includes("public_pages")) return "marketing";

  if (requirement.derivedFrom.length === 0) {
    return scopeFromKeywords(title, purpose, doneWhen);
  }

  return null;
}

/* ---------------------------------------------------------------------------
 * The compiler (PART B)
 * ------------------------------------------------------------------------ */

export type CommitMessageInput = {
  /** Planner-authored, from `ExecutionSpec.objective`. Already secret-scanned. */
  title: string;
  purpose: string;
  doneWhen: string;
  /** Vibe-minted, from the trusted Action Step — never model prose. */
  changeKind: StepChangeKind;
  evidenceIds: readonly string[];
};

/** The identifiers that move to the body instead of the title (PART G). */
export type CommitTrailers = {
  executionId: string;
  stepKey: string;
  preparedChangeId: string;
};

export type CompiledCommitMessage = {
  compilerVersion: typeof COMMIT_MESSAGE_COMPILER_VERSION;
  type: CommitType;
  scope: CommitScope | null;
  subject: string;
  /** No prose body in v1 — see the sprint doc. Trailers carry traceability. */
  body: string | null;
  trailers: Readonly<Record<string, string>>;
  fallback: boolean;
  fallbackReason: CommitMessageFallbackReason | null;
};

const FALLBACK_TYPE: CommitType = "chore";
const FALLBACK_SUBJECT = "apply prepared product change";

function trailerLines(trailers: CommitTrailers): Record<string, string> {
  return {
    "Vibe-Execution": trailers.executionId,
    "Vibe-Step": trailers.stepKey,
    "Vibe-Prepared-Change": trailers.preparedChangeId,
  };
}

/**
 * Compiles one Prepared Change's commit message.
 *
 * `input` is null exactly when no trusted step could be loaded at all — the
 * fixture registry had nothing and the database had nothing either. That is
 * the one case PART J calls a fallback: not "the classifier landed on chore",
 * which is an ordinary, specific result, but "there was no trusted text to
 * classify in the first place".
 */
export function compileCommitMessage(
  input: CommitMessageInput | null,
  trailers: CommitTrailers,
): CompiledCommitMessage {
  const rendered = trailerLines(trailers);

  if (!input) {
    return {
      compilerVersion: COMMIT_MESSAGE_COMPILER_VERSION,
      type: FALLBACK_TYPE,
      scope: null,
      subject: FALLBACK_SUBJECT,
      body: null,
      trailers: rendered,
      fallback: true,
      fallbackReason: "no_trusted_step",
    };
  }

  const subject = toSubject(input.title);
  if (!subject) {
    return {
      compilerVersion: COMMIT_MESSAGE_COMPILER_VERSION,
      type: FALLBACK_TYPE,
      scope: null,
      subject: FALLBACK_SUBJECT,
      body: null,
      trailers: rendered,
      fallback: true,
      fallbackReason: "subject_not_meaningful",
    };
  }

  const requirement = deriveExecutionSurfaceRequirement({
    changeKind: input.changeKind,
    evidenceIds: input.evidenceIds,
  });

  return {
    compilerVersion: COMMIT_MESSAGE_COMPILER_VERSION,
    type: classifyType(input.title, input.purpose, input.doneWhen),
    scope: classifyScope(requirement, input.title, input.purpose, input.doneWhen),
    subject,
    body: null,
    trailers: rendered,
    fallback: false,
    fallbackReason: null,
  };
}

/**
 * Renders the compiled message to the exact bytes `git commit` receives.
 *
 * `type(scope): subject`, or `type: subject` when there is no scope — PART D's
 * explicit preference for an absent scope over an invented one, applied at the
 * only point that actually assembles the string. Trailers follow one blank
 * line, `Key: value` per line, in the order they were compiled — real Git
 * trailer syntax, never parsed back out of anything a model wrote.
 */
export function renderCommitMessage(message: CompiledCommitMessage): string {
  const header = message.scope
    ? `${message.type}(${message.scope}): ${message.subject}`
    : `${message.type}: ${message.subject}`;

  const trailerBlock = Object.entries(message.trailers)
    .map(([key, value]) => `${key}: ${sanitizeLine(value)}`)
    .join("\n");

  const body = [message.body, trailerBlock].filter((part) => part && part.length > 0).join("\n\n");

  return body.length > 0 ? `${header}\n\n${body}` : header;
}

/** The soft target PART E asks for, exported so a test can hold it honest. */
export const TARGET_SUBJECT_LINE_LENGTH = TARGET_SUBJECT_LENGTH;
