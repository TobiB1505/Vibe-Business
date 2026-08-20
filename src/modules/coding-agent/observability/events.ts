/**
 * What an agent execution did, as it did it (EXECUTION CORE-4 observability).
 *
 * ## Why a new model rather than `agent_activity_events`
 *
 * That table exists and is deliberately narrow: a closed thirteen-value
 * vocabulary, counts and paths, and — as its own comment says — "no message
 * column, deliberately: a schema that cannot express a sentence cannot leak a
 * reasoning trace". It answers *what state is the customer's work in*.
 *
 * It cannot answer the questions runs #1 and #2 had to be reconstructed to
 * answer: which command ran, how long it took, what it exited with, how token
 * usage grew, whether caching was working, what a phase cost. Widening it to
 * carry those would erase the property its comment claims, and adding a second
 * customer-state table would duplicate durable state for no gain.
 *
 * So `agent_execution_events` is the technical record and it *subsumes* the
 * customer one: every event carries an `audience`, and the customer timeline is
 * a projection over the events marked `customer` rather than a separate write.
 * One log, two readings.
 *
 * ## What may never be in here
 *
 * Model reasoning, in any form (Rule 43). There is no `message`, no `text`, no
 * `thought` and no free-form string the harness controls: the closest thing is
 * a bounded command line Vibe itself passed to a shell, and a repository path.
 *
 * Repository file *contents* (Rule 26). A path, a byte count and a line count
 * describe a file; they are not a copy of it. Contents reach a person only
 * through the prepared-change review path, which is a different surface with a
 * different authority.
 *
 * Secrets, in any field. `redactSecrets` runs over every string that reaches a
 * stored event, and it runs at the boundary rather than at each call site so
 * that a new event type cannot forget it.
 *
 * ## Why every bound is here rather than in the database
 *
 * Because the repository is untrusted and its file names, command strings and
 * error text all end up in this table. A check constraint would reject the
 * whole write and lose the event; bounding in code keeps the event and loses
 * only the excess, which is the right trade for a telemetry record. The
 * database still enforces the outer limits as a second line.
 */

/** Where a run is, in terms a person can follow. */
export const EXECUTION_PHASES = [
  "preparing",
  "working",
  "reviewing_change",
  "preparing_branch",
  "validating",
  "finished",
] as const;
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

/**
 * Who an event is for.
 *
 * `customer` events are the handful that describe progress in outcome terms.
 * `internal` events are everything else — the per-file, per-command, per-call
 * detail that makes a run diagnosable. The split is stored rather than derived
 * so that a later production surface renders the customer timeline with a
 * `where audience = 'customer'`, not with a hardcoded list it must keep in sync.
 */
export const EVENT_AUDIENCES = ["customer", "internal"] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

/**
 * The closed vocabulary.
 *
 * Closed, and checked in the database, for the same reason the older table's is:
 * an open `type` column is a free-text column with extra steps, and free text is
 * where narration ends up.
 */
export const EXECUTION_EVENT_TYPES = [
  // Workspace
  "workspace_preparing",
  "workspace_ready",
  "workspace_failed",

  // What Vibe already knew and chose to send, and what the run did with it.
  "context_compiled",
  "context_used",
  /**
   * Which pages the step's own cited evidence resolved to (Sprint 0044).
   *
   * Separate from `context_compiled` because it answers a different question:
   * not "how big was the brief" but "did Vibe understand what the task touches".
   * Run #6 and run #7 had identical `context_compiled` payloads and completely
   * different execution surfaces.
   */
  "execution_surface_resolved",

  // How much the run was allowed to check its own work, and what it did with
  // that (Sprint 0042). A refusal is recorded because a bounded agent that is
  // silently bounded is one nobody can tell from an agent that chose to stop.
  "verification_plan_compiled",
  "verification_check_started",
  "verification_command_refused",
  "verification_escalated",
  "verification_completed",
  /**
   * A required operation a completion budget alone would have refused.
   *
   * The event that would have made run #7's contradiction visible in one line
   * instead of as eight refusals nobody could attribute.
   */
  "required_verification_allowed",

  // Where the requested job ended, and what was refused after it (Sprint 0043).
  "completion_budget_compiled",
  "completion_window_started",
  /** The run stopped changing files. Observed, never claimed (Sprint 0044). */
  "convergence_started",
  "completion_action_refused",
  "completion_repair_started",

  // The harness
  "agent_started",
  "turn_completed",
  "agent_finished",

  // What it did. Observed from the harness's own tool stream — which is what
  // it *executed*, not what it said about itself.
  "file_read",
  "file_written",
  "file_edited",
  "file_searched",
  "command_started",
  "command_completed",
  "command_failed",

  // What it cost. Written from the gateway's usage rows, never from the model.
  "usage_updated",

  // Vibe's own conclusions about the result.
  "change_discovered",
  "change_verified",
  "change_rejected",
  /**
   * The Conventional-Commits message compiled for this change, before the
   * write (Sprint 0046, PART K). `fallback: true` in its metadata is the rare,
   * observable case PART J asks for — no trusted step existed to classify.
   */
  "commit_message_compiled",
  "branch_prepared",

  // Teardown and the independent validation that follows.
  "sandbox_stopping",
  "sandbox_stopped",
  "validation_started",
  "validation_completed",

  "execution_completed",
  "execution_failed",
] as const;
export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

/** How long one recorded string may be. Names are data, and data can be hostile. */
export const MAX_EVENT_STRING = 240;

/** How many keys one event's metadata may carry. */
export const MAX_METADATA_KEYS = 16;

/** How large one event's serialized metadata may be. */
export const MAX_METADATA_BYTES = 4096;

/**
 * How many events one run may record.
 *
 * A run that reads two hundred files and runs forty commands is a few hundred
 * events. Two thousand is far above any legitimate run and far below a storage
 * amplification: a repository cannot turn a twenty-minute execution into an
 * unbounded table by making the agent touch files in a loop.
 */
export const MAX_EVENTS_PER_RUN = 2000;

/**
 * Where Vibe's own lifecycle milestones are numbered from.
 *
 * The harness numbers its feed from 1 and that numbering is the idempotency key
 * for everything it emits. Vibe's milestones come from a different producer,
 * running in a different process, sometimes before the harness exists — so they
 * take a reserved band instead of a shared counter neither could coordinate on.
 *
 * `MAX_EVENTS_PER_RUN` bounds the *feed*, which is the half a repository can
 * influence. It deliberately does not bound this band: there are sixteen
 * milestones, Vibe writes all of them, and applying the feed's cap here would
 * silently drop every one — which is exactly what it did until a test caught it.
 */
export const LIFECYCLE_SEQUENCE_BASE = 90_000;

/** How many milestones the reserved band holds. */
export const MAX_LIFECYCLE_EVENTS = 64;

/** Whether a sequence is one this log will store at all. */
export function isAdmissibleSequence(sequence: number): boolean {
  if (!Number.isInteger(sequence) || sequence <= 0) return false;
  if (sequence <= MAX_EVENTS_PER_RUN) return true;

  return (
    sequence > LIFECYCLE_SEQUENCE_BASE &&
    sequence <= LIFECYCLE_SEQUENCE_BASE + MAX_LIFECYCLE_EVENTS
  );
}

export type ExecutionEventMetadata = Record<string, string | number | boolean | null>;

export type ExecutionEventInput = {
  /** Monotonic within a run. The idempotency key for a re-entered poll. */
  sequence: number;
  type: ExecutionEventType;
  phase: ExecutionPhase;
  audience: EventAudience;
  occurredAt: string;
  /** A short label composed by Vibe from a closed vocabulary — never by a model. */
  summary: string;
  metadata?: ExecutionEventMetadata;
};

export type StoredExecutionEvent = ExecutionEventInput & {
  metadata: ExecutionEventMetadata;
};

/* ---------------------------------------------------------------------------
 * Redaction
 * ------------------------------------------------------------------------ */

/**
 * Secret shapes, removed from anything that reaches a stored event.
 *
 * Two kinds of rule, and both are needed. The first matches a *carrier* — an
 * `Authorization` header, a `--token` flag, an assignment whose name says what
 * it holds — and takes the value regardless of what it looks like. The second
 * matches known *shapes*, so a bare key pasted into a command is caught even
 * with nothing around it to identify it.
 *
 * The agent runs with a gateway bearer token on its environment (ADR 0029), so
 * a command it composes really can contain one. That is the reason this is not
 * a formality.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /*
   * Carriers: a name that says "secret" followed by its value.
   *
   * The authorization rule consumes an optional scheme word before the token,
   * because `Authorization: Bearer <jwt>` has a space in the middle of its
   * value — a rule that stopped at the first whitespace redacted the word
   * "Bearer" and left the credential standing right behind it.
   */
  /\b(authorization|proxy-authorization)\s*[:=]\s*(?:[A-Za-z]+\s+)?[^\s'"]+/gi,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*\S+/gi,
  /--(?:token|password|secret|api-key|apikey)(?:[= ])\S+/gi,
  // Shapes: recognisable credential formats, with or without a carrier.
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  // A JWT. Short segments are allowed on purpose: the shape is distinctive
  // enough that a false positive costs a redacted word, and a real one that
  // slipped past the carrier rule is a credential in a table.
  /\bey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  /\bvibe_agt_[A-Za-z0-9._-]{8,}/g,
  // A URL's userinfo, which is how a clone credential travels.
  /\/\/[^/\s:@]+:[^/\s@]+@/g,
];

export const REDACTED = "[redacted]";

/**
 * Removes credential material from one string.
 *
 * Applied to every string in every event, at the boundary. Doing it per call
 * site would mean a new event type could forget, and "the one that forgot" is
 * how a token reaches a log.
 *
 * Deliberately blunt: it will sometimes redact something that was not a secret.
 * A command line that reads `npm test --token [redacted]` is a small loss; the
 * alternative failure is a bearer token in a table a browser can read.
 */
export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/** Redacted, collapsed and cut to length — in that order, so a cut cannot expose. */
function boundString(value: string): string {
  const cleaned = redactSecrets(value).replace(/\s+/g, " ").trim();
  return cleaned.length <= MAX_EVENT_STRING ? cleaned : `${cleaned.slice(0, MAX_EVENT_STRING)}…`;
}

/**
 * One event, made safe to store.
 *
 * Every string bounded and redacted, every number finite, the key count capped,
 * and the whole payload capped again by serialized size — because sixteen keys
 * of two hundred characters is still four kilobytes a repository chose.
 */
export function boundEvent(input: ExecutionEventInput): StoredExecutionEvent {
  const metadata: ExecutionEventMetadata = {};

  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (Object.keys(metadata).length >= MAX_METADATA_KEYS) break;

    const safeKey = boundString(key).slice(0, 48);
    if (safeKey.length === 0) continue;

    if (typeof value === "string") metadata[safeKey] = boundString(value);
    else if (typeof value === "number") metadata[safeKey] = Number.isFinite(value) ? value : 0;
    else if (typeof value === "boolean") metadata[safeKey] = value;
    else metadata[safeKey] = null;

    if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > MAX_METADATA_BYTES) {
      delete metadata[safeKey];
      break;
    }
  }

  return {
    sequence: input.sequence,
    type: input.type,
    phase: input.phase,
    audience: input.audience,
    occurredAt: input.occurredAt,
    summary: boundString(input.summary),
    metadata,
  };
}

/* ---------------------------------------------------------------------------
 * Commands
 * ------------------------------------------------------------------------ */

export const COMMAND_CATEGORIES = [
  "install",
  "typecheck",
  "test",
  "build",
  "lint",
  "format",
  "read",
  "search",
  "git",
  "other",
] as const;
export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/**
 * The rules, as data, in priority order.
 *
 * ## Why data rather than a chain of `if`s
 *
 * Because two places have to agree on the answer and only one of them can
 * import this file. The timeline classifies a command *after* it ran, here, in
 * Vibe's process; the agent harness has to classify it *before* it runs, inside
 * the sandbox, where nothing of Vibe's is importable — the runtime program is a
 * string constant with no interpolation (ADR 0029).
 *
 * So the rules travel into the VM as JSON, in the run request, and are rebuilt
 * there with `new RegExp`. That keeps one source of truth and keeps the program
 * free of interpolation. The patterns are Vibe's own constants — nothing from a
 * repository, a model or a customer ever reaches this array.
 *
 * Order is significant and is part of the contract: `pnpm build` must classify
 * as `build` rather than as whatever a later rule would also match.
 */
/** `pnpm test`, `npm run build`, `npx vitest` — a script actually being invoked. */
const RUNNER = String.raw`(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?`;

export const COMMAND_CATEGORY_RULES: readonly { category: CommandCategory; pattern: string }[] = [
  { category: "install", pattern: String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:install|ci|add)\b` },
  { category: "typecheck", pattern: String.raw`\b(?:tsc)\b|\b${RUNNER}type-?check\b` },
  { category: "test", pattern: String.raw`\b(?:vitest|jest|playwright)\b|\b${RUNNER}test\b` },
  { category: "build", pattern: String.raw`\b(?:next|vite|tsup|rollup|webpack)\s+build\b|\b${RUNNER}build\b` },
  { category: "lint", pattern: String.raw`\beslint\b|\b${RUNNER}lint\b` },
  { category: "format", pattern: String.raw`\bprettier\b|\b${RUNNER}format\b` },
  { category: "read", pattern: String.raw`^\s*(?:cat|head|tail|less|wc)\b` },
  { category: "search", pattern: String.raw`^\s*(?:grep|rg|find|ls|fd)\b` },
  { category: "git", pattern: String.raw`^\s*git\b` },
];

/**
 * What a shell command was for, in one word.
 *
 * A category is what a timeline should lead with — "production build started"
 * reads, `pnpm build --no-lint 2>&1 | tee out.log` does not. The full (bounded,
 * redacted) command is kept alongside it for the inspector, so the category
 * being wrong costs a label rather than the evidence.
 *
 * Matched on the whole line rather than the first token, because the
 * interesting word is usually the script name: `pnpm run typecheck`.
 *
 * Since Sprint 0042 the same answer also *gates* a command inside the sandbox,
 * which raises the cost of a wrong category from a mislabelled row to a refused
 * command. A command that matches nothing is `other`, and `other` is never a
 * check, so an unrecognised command is never refused for being one.
 *
 * ## Why a check must look like an invocation, not like a word
 *
 * Run #6 ran this and Vibe recorded it as a targeted test:
 *
 * ```
 * grep -rn "robots" src/app/landing-contract.test.ts ; find . -iname "*metadata*.test.*"
 * ```
 *
 * The old rule was `\b(vitest|jest|playwright|test)\b`, and `test` appears in
 * both *filenames*. `\bbuild\b` and `\btypecheck\b` had the same flaw: any
 * command that so much as mentioned one would have been classified as running
 * it — and under Sprint 0042 that means refused.
 *
 * So a check now has to look like something being *run*: a known runner binary
 * (`vitest`, `tsc`, `eslint`, `next build`) or a package-manager script
 * invocation (`pnpm test`, `npm run build`). Mentioning a word is not running it.
 *
 * This is a convergence control, not a security boundary (ADR 0033), so the
 * question it answers is "what did this command do", not "what could a hostile
 * caller disguise". A determined evader has simpler options; an ordinary agent
 * grepping for the word `build` should not be told it may not build.
 */
export function classifyCommand(command: string): CommandCategory {
  const text = command.toLowerCase();

  for (const rule of COMMAND_CATEGORY_RULES) {
    if (new RegExp(rule.pattern).test(text)) return rule.category;
  }

  return "other";
}

/* ---------------------------------------------------------------------------
 * Composing events
 * ------------------------------------------------------------------------ */

/** The phase each type belongs to, so a caller cannot put one in the wrong one. */
const PHASE_OF: Record<ExecutionEventType, ExecutionPhase> = {
  workspace_preparing: "preparing",
  workspace_ready: "preparing",
  workspace_failed: "preparing",
  context_compiled: "preparing",
  verification_plan_compiled: "preparing",
  completion_budget_compiled: "preparing",

  agent_started: "working",
  turn_completed: "working",
  agent_finished: "working",
  file_read: "working",
  file_written: "working",
  file_edited: "working",
  file_searched: "working",
  command_started: "working",
  command_completed: "working",
  command_failed: "working",
  usage_updated: "working",
  verification_check_started: "working",
  verification_command_refused: "working",
  verification_escalated: "working",
  verification_completed: "working",
  completion_window_started: "working",
  convergence_started: "working",
  required_verification_allowed: "working",
  execution_surface_resolved: "reviewing_change",
  completion_action_refused: "working",
  completion_repair_started: "working",
  context_used: "reviewing_change",

  change_discovered: "reviewing_change",
  change_verified: "reviewing_change",
  change_rejected: "reviewing_change",
  commit_message_compiled: "preparing_branch",
  branch_prepared: "preparing_branch",

  sandbox_stopping: "finished",
  sandbox_stopped: "finished",
  validation_started: "validating",
  validation_completed: "validating",

  execution_completed: "finished",
  execution_failed: "finished",
};

/**
 * Which types a customer sees.
 *
 * Small on purpose. A founder watching their change being built wants six or
 * seven lines, not four hundred; the four hundred are what the inspector is
 * for. Per-file and per-command events are internal, and the customer sees
 * their *counts* through the phase summaries instead.
 */
const CUSTOMER_TYPES: ReadonlySet<ExecutionEventType> = new Set<ExecutionEventType>([
  "workspace_ready",
  "workspace_failed",
  "agent_started",
  "agent_finished",
  "change_discovered",
  "change_verified",
  "change_rejected",
  "branch_prepared",
  "validation_started",
  "validation_completed",
  "execution_completed",
  "execution_failed",
]);

export function executionEvent(input: {
  sequence: number;
  type: ExecutionEventType;
  occurredAt: string;
  summary: string;
  metadata?: ExecutionEventMetadata;
}): StoredExecutionEvent {
  return boundEvent({
    ...input,
    phase: PHASE_OF[input.type],
    audience: CUSTOMER_TYPES.has(input.type) ? "customer" : "internal",
  });
}

export function phaseOf(type: ExecutionEventType): ExecutionPhase {
  return PHASE_OF[type];
}
