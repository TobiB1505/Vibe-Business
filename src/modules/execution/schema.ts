/**
 * The execution domain (Sprint 9 §3, §6, §22).
 *
 * Vibe's first repository write. The whole shape of this module is a reaction
 * to what Sprint 8 taught: a deterministic analyzer reported robots.txt as
 * present when the evidence was our own crawler's parser, the audit believed
 * it, and the Opportunity Engine produced confident wrong advice from it.
 *
 * Advice built on wrong evidence is a wrong sentence. **A repository write
 * built on wrong evidence is a wrong commit.** So execution does not inherit
 * the evidence chain's confidence — it re-establishes the premise from current
 * state immediately before writing, and refuses if anything disagrees.
 */

/**
 * The one supported capability (§6).
 *
 * Versioned in its identifier because the generated output is part of the
 * contract: changing what the generator emits must produce a new capability
 * version rather than silently changing what a "prepared" change means.
 */
export const EXECUTION_CAPABILITIES = [
  /**
   * Historical. Emitted a fixed sitemap that listed `/login` and `/signup`.
   *
   * Retained because the first real Vibe-prepared change (`2f05958` on
   * `vibe/seo-foundations-cc32273131c5`) was produced by it, and its
   * `PreparedChange` row must keep meaning what it meant when it was written.
   * Never resolved for new preparations.
   */
  "nextjs_seo_foundations_v1",
  /** Current. Sitemap derived from structured route intelligence. */
  "nextjs_seo_foundations_v2",
  /**
   * A change produced by the bounded coding agent (EXECUTION CORE-4 §3, §29).
   *
   * ## Why there is exactly one of these, and why there always will be
   *
   * §3 is emphatic: agentic execution exists **so that Vibe does not need a
   * capability per customer task**. `build_login_v1`, `add_pricing_page_v1`,
   * `fix_calendar_v1` — that taxonomy is the thing this value replaces. If a
   * future sprint finds itself adding `agentic_pricing_page_v1`, the design has
   * been misread.
   *
   * So this names the *producer*, not the task: "these bytes came from the
   * bounded coding agent, under a recorded policy and prompt version", which is
   * the only thing a stored `PreparedChange` row needs to know in order to stay
   * interpretable forever.
   *
   * It is versioned for the same reason the SEO capability is: if what the
   * agentic path *means* changes — a wider write scope, a different safety
   * pipeline — that is a new value, because an old row must keep describing
   * what was actually done. The model, the prompt and the budget are **not**
   * part of that meaning; they are recorded per run, where they belong.
   */
  "agentic_execution_v1",
] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

/** The capability new preparations resolve to. */
export const CURRENT_SEO_FOUNDATIONS_CAPABILITY = "nextjs_seo_foundations_v2" as const;

/** The capability every agent-produced change is recorded under (§29). */
export const AGENTIC_EXECUTION_CAPABILITY = "agentic_execution_v1" as const;

/**
 * The capabilities a *plan step* or an *ExecutionSpec* may name.
 *
 * Deliberately excludes the agentic one, and the exclusion is a fact about the
 * domain rather than a narrowing for convenience.
 *
 * A `capability` on a plan step or a spec means "a registry-backed generator
 * matched this work" — `resolveStepExecution` sets it from `matchCapability`
 * and leaves it **null** for every agentic resolution, because there is no
 * generator. The agentic capability exists one layer later, on the
 * `PreparedChange`, where it records what produced the bytes.
 *
 * Storing it upstream would mean a spec could claim a deterministic executor it
 * does not have — which is precisely the confusion between "Vibe has an
 * executor" and "an agent could do this" that Core-3's six-value mode enum was
 * built to keep apart.
 */
export const DETERMINISTIC_EXECUTION_CAPABILITIES = EXECUTION_CAPABILITIES.filter(
  (capability): capability is Exclude<ExecutionCapability, typeof AGENTIC_EXECUTION_CAPABILITY> =>
    capability !== AGENTIC_EXECUTION_CAPABILITY,
);

/**
 * Generator output versions (§10).
 *
 * Bumped whenever the emitted bytes change meaning. Both remain declared: v1 is
 * still the honest description of what the first dogfood commit contains.
 */
export const NEXTJS_SEO_FOUNDATIONS_VERSION = "nextjs-seo-foundations-v1" as const;
export const NEXTJS_SEO_FOUNDATIONS_V2_VERSION = "nextjs-seo-foundations-v2" as const;

/**
 * What "agentic execution v1" produced.
 *
 * There is no generator to version, so this names the *pipeline*: agent output
 * verified against the compiled policy, written by trusted Vibe infrastructure,
 * and validated independently. Bumping it means one of those changed meaning.
 */
export const AGENTIC_EXECUTION_VERSION = "agentic-execution-v1" as const;

/**
 * The generator version a capability produces.
 *
 * A single map rather than a constant read at each call site, because
 * capability and version both feed the execution identity: if they could drift
 * apart, two different generators could share one identity and the second would
 * silently reuse the first one's branch.
 */
export const CAPABILITY_VERSIONS: Record<ExecutionCapability, string> = {
  nextjs_seo_foundations_v1: NEXTJS_SEO_FOUNDATIONS_VERSION,
  nextjs_seo_foundations_v2: NEXTJS_SEO_FOUNDATIONS_V2_VERSION,
  agentic_execution_v1: AGENTIC_EXECUTION_VERSION,
};

export function capabilityVersionFor(capability: ExecutionCapability): string {
  return CAPABILITY_VERSIONS[capability];
}

/**
 * Why a preflight refused (§3).
 *
 * A closed set. Each maps to user-facing copy that says what happened and,
 * where it is true, what the user can do — never an internal exception.
 */
export const EXECUTION_BLOCK_REASONS = [
  /** The opportunity set is older than the audit it should derive from. */
  "stale_opportunity",
  /** The audit is older than the evidence that exists now. */
  "stale_audit",
  /** The repository snapshot is not the newest successful one. */
  "stale_repository_intelligence",
  /** The default branch moved since the snapshot was taken (§4). */
  "repository_changed",
  /** The concrete claim behind this capability is no longer true (§8). */
  "premise_no_longer_true",
  "unsupported_framework",
  "unsupported_repository_layout",
  /** No trustworthy production origin to write into the generated files (§12). */
  "missing_required_context",
  "github_write_permission_required",
  /** A target file already exists — never overwritten (§13). */
  "conflicting_files_exist",
  /** This opportunity has no executor, whatever the model said about it (§33). */
  "unsupported_opportunity",
  "execution_not_available",
] as const;
export type ExecutionBlockReason = (typeof EXECUTION_BLOCK_REASONS)[number];

/** Failures that only arise once writing has begun. */
export const EXECUTION_FAILURE_REASONS = [
  /** A Vibe branch exists but points at something we did not prepare (§21). */
  "branch_conflict",
  /** GitHub accepted the write but the read-back did not match (§25). */
  "write_verification_failed",
  "github_unavailable",
  "change_preparation_failed",
] as const;
export type ExecutionFailureReason = (typeof EXECUTION_FAILURE_REASONS)[number];

export type ExecutionFailureCode = ExecutionBlockReason | ExecutionFailureReason;

/**
 * Where a prepared change stands.
 *
 * `discarded` is a human rejection and the only way to reject one. It replaces
 * a `superseded` that lived in this union from the table's first day and never
 * existed in the database: no CHECK admitted it, nothing wrote it, nothing read
 * it. What it cost was not a stray word — it was that a change a founder did
 * not want stayed `prepared` forever, kept answering "this Move already has a
 * prepared change", and held the single-active index against its own execution
 * identity so the step could not be run again.
 *
 * Nothing sets `discarded` automatically. A newer preparation for the same Move
 * does not supersede an older one, because the unique index refuses the second
 * insert while the first is still active — which is the same fact stated by the
 * database instead of by a status.
 */
export const PREPARED_CHANGE_STATUSES = [
  "preparing",
  "prepared",
  "failed",
  "discarded",
] as const;

export type PreparedChangeStatus = (typeof PREPARED_CHANGE_STATUSES)[number];

/** One file the capability generated. Content lives on the branch, not here (§23). */
export type PreparedFile = {
  /** Repository-relative, produced only by capability code (§13). */
  path: string;
  /** sha256 of the generated content, for post-write verification (§25). */
  contentHash: string;
  bytes: number;
  /**
   * How many lines this file gained and lost.
   *
   * Derived counts, not content — rule 26 forbids storing a copy of a
   * customer's repository, and nothing about the source can be reconstructed
   * from two integers. The content itself stays on the branch.
   *
   * Absent when Vibe did not observe both sides. The deterministic capability
   * generates files without reading what was there, so it knows what it wrote
   * and not what it replaced; reporting `removed: 0` for that would be a
   * measurement nobody made (rule 44). Absent is carried to the screen as
   * nothing shown, never as zero.
   */
  linesAdded?: number;
  linesRemoved?: number;
};

export type PreparedChange = {
  id: string;
  projectId: string;
  operationRunId: string;
  opportunitySetId: string;
  opportunityId: string;
  capability: ExecutionCapability;
  capabilityVersion: string;
  repositorySnapshotId: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  commitSha: string | null;
  files: PreparedFile[];
  status: PreparedChangeStatus;
  failureCode: ExecutionFailureCode | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * How far verification actually got (§27).
 *
 * `repository_write_verified` means the branch and the file contents were read
 * back and matched. It explicitly does **not** mean the change was built,
 * tested, or run — Vibe has no sandbox, so claiming otherwise would be a lie
 * the user would reasonably act on.
 */
export type VerificationLevel = "repository_write_verified";

/** What the UI may offer for one opportunity (§33). */
export type OpportunityExecutionState =
  /** Vibe has an executor and the preflight passed. */
  | { kind: "executable"; capability: ExecutionCapability }
  /** The model called it ready; Vibe has no executor for it. */
  | { kind: "no_executor" }
  /** There is an executor, but something must change first. */
  | { kind: "blocked"; reason: ExecutionBlockReason }
  /** The model itself said this needs a human decision. */
  | { kind: "needs_user_input" }
  /** The model said this is not automatable. */
  | { kind: "not_automated" };
