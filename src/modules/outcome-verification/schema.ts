/**
 * The production outcome verification domain (Sprint 12A §1, §2, §6, §7).
 *
 * ## Three questions, kept apart
 *
 * ```
 * DELIVERY          did the repository state change as intended?
 *                   → Sprint 11C. `main` points at the approved commit.
 *
 * PRODUCT OUTCOME   did the intended observable behaviour appear publicly?
 *                   → this sprint. `/robots.txt` is reachable, the sitemap
 *                     lists the homepage and not the login form.
 *
 * BUSINESS OUTCOME  did traffic, conversion, activation or revenue move?
 *                   → not this sprint, and not implied by either of the above.
 * ```
 *
 * Collapsing any two of them is the failure this module exists to prevent. A
 * verified product outcome is not evidence of business impact, and neither is
 * evidence of a deployment.
 *
 * ## Why this is not "deployment verified" (§3, §34)
 *
 * Vibe controls no deployment provider and reads no deployment API. What it can
 * honestly say is that it made a bounded set of public HTTP requests and saw the
 * behaviour the merged capability was supposed to produce. That is consistent
 * with the new build having reached production — it is not proof of it, and it
 * carries no provenance for *which* commit is serving.
 *
 * So the vocabulary here is `verified` / `partial` / `not_observed`, never
 * `deployed`, `live`, `released` or `shipped`.
 */

/**
 * What "verified" was checked against (§6).
 *
 * Versioned for the same reason the merge, sandbox and approval policies are:
 * it fixes the *rules of observation* — the window, the schedule, the safe-HTTP
 * boundary, how a missing endpoint is classified, and what may be persisted as
 * evidence. Change any of that and a stored `verified` row would come to mean
 * something it was never checked against, so the version is part of the
 * verification's identity and historical rows keep their original meaning.
 */
export const OUTCOME_POLICY_VERSION = "outcome-policy-v1" as const;

/**
 * The shape of the persisted JSONB evidence (§36).
 *
 * Both the expected-outcome snapshot and the per-check results are stored as
 * structured JSON rather than normalized rows, and JSON without a version is a
 * shape nobody can safely read two sprints later.
 */
export const OUTCOME_EVIDENCE_SCHEMA_VERSION = "outcome-evidence-v1" as const;

/**
 * The deterministic outcome profiles that exist (§5, §6).
 *
 * A profile is the *contract*: which public resources are fetched, and which
 * derived facts about them constitute the intended product behaviour. It is
 * owned by the execution capability that produced the change — see
 * `src/modules/execution/outcome-contract.ts` — because the code that knows
 * what it wrote is the only code entitled to say what it expects to see.
 *
 * There is deliberately no generic "measure a change" profile. A profile that
 * could describe any capability would be a profile that describes none.
 */
export const OUTCOME_PROFILES = ["nextjs_seo_foundations_outcome_v1"] as const;
export type OutcomeProfile = (typeof OUTCOME_PROFILES)[number];

/** Profile output versions, bumped whenever the expected facts change meaning. */
export const OUTCOME_PROFILE_VERSIONS: Record<OutcomeProfile, string> = {
  nextjs_seo_foundations_outcome_v1: "nextjs-seo-foundations-outcome-v1",
};

export function outcomeProfileVersionFor(profile: OutcomeProfile): string {
  return OUTCOME_PROFILE_VERSIONS[profile];
}

/**
 * The public resources a profile may fetch (§12, §13).
 *
 * A closed set, and short on purpose. Outcome verification is not a crawl: it
 * fetches the exact deterministic endpoints its contract names and follows no
 * link it finds in them. Adding an endpoint here is a deliberate act with a
 * budget attached, not a consequence of a parser discovering a URL.
 */
export const OUTCOME_RESOURCES = ["robots_txt", "sitemap_xml"] as const;
export type OutcomeResource = (typeof OUTCOME_RESOURCES)[number];

export const OUTCOME_RESOURCE_PATHS: Record<OutcomeResource, string> = {
  robots_txt: "/robots.txt",
  sitemap_xml: "/sitemap.xml",
};

/**
 * The kinds of expectation a profile can state (§5, §8).
 *
 * Closed, so a profile cannot invent a check the evaluator has never been
 * tested against, and so the UI can label every one of them.
 *
 * `sitemap_excludes_private_prefix` carries the whole point of the v2 sitemap
 * capability: a sitemap is a public invitation to index, and the defect that
 * motivated v2 was inviting search engines to index a login form. The check
 * that would have caught it in production is the one that asserts the *absence*
 * of a URL, which is why absence is a first-class expectation here rather than
 * an afterthought.
 */
export const OUTCOME_CHECK_KINDS = [
  "robots_reachable",
  "robots_declares_sitemap",
  "sitemap_reachable",
  "sitemap_parsed",
  "sitemap_includes_public_root",
  "sitemap_includes_path",
  "sitemap_excludes_private_prefix",
] as const;
export type OutcomeCheckKind = (typeof OUTCOME_CHECK_KINDS)[number];

/**
 * One expectation, fixed before observation begins (§9).
 *
 * `target` is the path or prefix the expectation is about, and it is always
 * produced by capability code from structured repository intelligence — never
 * from a model, never from a client, and never from the fetched page itself.
 */
export type OutcomeCheck = {
  kind: OutcomeCheckKind;
  /** Null for whole-resource checks; a normalized path or prefix otherwise. */
  target: string | null;
  /** Which fetched resource this expectation reads. */
  resource: OutcomeResource;
};

/**
 * The stable identity of one check within a verification.
 *
 * Composed rather than free-form so a stored result can always be matched back
 * to the expectation it answers, including after the profile grows a check.
 */
export function outcomeCheckId(check: OutcomeCheck): string {
  return check.target === null ? check.kind : `${check.kind}:${check.target}`;
}

/**
 * The expectation snapshot persisted at the moment verification starts (§9).
 *
 * Once observation begins this is frozen. Production changing afterwards must
 * never rewrite what Vibe said it was looking for — a historical verification
 * has to stay historical, or the record is worth nothing.
 */
export type ExpectedOutcome = {
  profile: OutcomeProfile;
  profileVersion: string;
  /** The origin every expectation is stated relative to. */
  publicOrigin: string;
  /** Endpoints that will actually be requested. Nothing else is fetched. */
  resources: OutcomeResource[];
  checks: OutcomeCheck[];
  /**
   * True when the contract could not enumerate every private prefix within its
   * bound, so absence is asserted over a subset. Recorded rather than silently
   * dropped: a partial expectation that reads as complete is exactly the kind
   * of quiet coverage loss CLAUDE.md rule 27 is about.
   */
  truncated: boolean;
};

/**
 * Verification lifecycle (§7).
 *
 * Deliberately **not** success/failure. Three of these five terminal states are
 * different sentences a user reads completely differently:
 *
 * ```
 * verified       the intended public behaviour was observed
 * partial        some of it was observed and some of it was not
 * not_observed   none of it appeared within the window — production may simply
 *                not have updated, and Vibe does not know why
 * failed         Vibe could not perform a reliable observation at all
 * ```
 *
 * `not_observed` is the one that most invites a wrong word. It is not
 * "deployment failed", because Vibe has no deployment evidence either way (§3,
 * §22).
 */
export const OUTCOME_STATUSES = [
  /** Requested; the durable observation has not started. */
  "queued",
  /** Inside the observation window, polling on a bounded schedule. */
  "observing",
  /** Every expected behaviour was observed. */
  "verified",
  /** Some expectations held and others did not, by the end of the window. */
  "partial",
  /** Nothing expected appeared before the deadline. */
  "not_observed",
  /** Vibe could not observe reliably — not a statement about the product. */
  "failed",
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export function isOutcomeTerminal(status: OutcomeStatus): boolean {
  return status === "verified" || status === "partial" || status === "not_observed" || status === "failed";
}

/**
 * The result of one expectation against one observation (§8).
 *
 * The distinction between the last three is the load-bearing part:
 *
 * ```
 * passed        the expected behaviour is present
 * failed        the resource was read and contradicts the expectation
 * not_observed  the resource is not there (yet)
 * error         Vibe could not read it reliably — a Vibe/network fact, not a
 *               product fact (§19, §23)
 * ```
 *
 * Folding `error` into `failed` would let a DNS outage be reported as the
 * customer's product misbehaving, which is the single most damaging thing this
 * module could say.
 */
export const OUTCOME_CHECK_STATUSES = ["passed", "failed", "not_observed", "error"] as const;
export type OutcomeCheckStatus = (typeof OUTCOME_CHECK_STATUSES)[number];

/**
 * Bounded, derived evidence for one check (§8, §14, §15).
 *
 * Numbers, booleans and short closed-set tokens only. No response body, no
 * HTML, no XML, no sitemap contents, no headers beyond a normalized content
 * type, and no query strings — the same evidence policy live product
 * intelligence works under (CLAUDE.md rule 37).
 */
export type OutcomeObservedValue = {
  /** HTTP status of the resource this check reads, when one was received. */
  httpStatus?: number;
  /** Normalized content type token, e.g. `text/plain`. Never a full header. */
  contentType?: string;
  /** How many `<loc>` values the sitemap yielded, after budgeting. */
  urlCount?: number;
  /** Whether the specific path or prefix this check names was present. */
  present?: boolean;
  /** Whether the document parsed as the expected kind of document. */
  parsed?: boolean;
  /** Redirect hops followed, each independently revalidated. */
  redirects?: number;
  /** Bytes read from the resource, after the size budget. */
  bytes?: number;
  /** True when a budget cut the resource short. */
  truncated?: boolean;
  /** Typed transport failure. Never provider prose. */
  transportError?: string;
};

export type OutcomeCheckResult = {
  /** `outcomeCheckId` of the expectation this answers. */
  checkId: string;
  kind: OutcomeCheckKind;
  target: string | null;
  status: OutcomeCheckStatus;
  observedValue: OutcomeObservedValue;
  observedAt: string;
};

/**
 * Every way a verification can refuse or fail (§10, §11, §23).
 *
 * A closed set, each mapping to copy that says what happened. Provider prose
 * never reaches a user and never reaches this union.
 */
export const OUTCOME_FAILURE_CODES = [
  /** The change was never merged, or the merge is not terminal `merged` (§10). */
  "outcome_merge_required",
  /** The merge's read-back does not equal the approved commit (§10). */
  "outcome_merge_unverified",
  /** No deterministic outcome verifier exists for this capability (§10). */
  "outcome_not_supported",
  /** No safe public origin is configured for this project (§11). */
  "outcome_public_origin_unavailable",
  /**
   * The expected outcome could not be derived from the evidence the capability
   * needs. Distinct from `outcome_not_supported`: Vibe *has* a verifier, but
   * cannot state what it should expect, and guessing would make the record
   * meaningless.
   */
  "outcome_expectation_unavailable",
  /** The caller does not hold verification authority over this project. */
  "outcome_not_authorized",
  /** The public origin could not be reached at all, throughout the window (§23). */
  "outcome_origin_unreachable",
  /** A redirect left the safe boundary, or a destination was refused (§23, §40). */
  "outcome_unsafe_destination",
  /** The durable observation could not be enqueued. */
  "outcome_execution_start_failed",
  /** The result could not be recorded. */
  "outcome_persistence_failed",
  "outcome_verification_failed",
] as const;
export type OutcomeFailureCode = (typeof OUTCOME_FAILURE_CODES)[number];

/**
 * One durable attempt to observe the public product after one merge.
 *
 * Everything that says *what was expected, of which origin, under which rules*
 * is copied onto the row rather than joined later — the same discipline the
 * merge and approval records follow, and for the same reason: a record that
 * answers "what happened?" with a join changes its answer when something else
 * changes.
 */
export type ChangeOutcomeVerification = {
  id: string;
  projectId: string;
  userId: string;

  changeMergeId: string;
  preparedChangeId: string;
  changeApprovalId: string;

  /** The commit the default branch was moved to and read back at (§10). */
  mergedCommitSha: string;

  capability: string;
  capabilityVersion: string;

  outcomeProfile: OutcomeProfile;
  outcomeProfileVersion: string;
  outcomePolicyVersion: string;
  evidenceSchemaVersion: string;

  /** Resolved server-side from trusted project state. Never client-chosen (§11). */
  publicOrigin: string;
  /**
   * The origin actually served after redirects, once observed.
   *
   * Recorded because "we asked example.com and www.example.com answered" is a
   * fact a reader of this record needs, and because every hop was revalidated
   * to get there.
   */
  effectiveOrigin: string | null;

  /** Frozen before observation begins (§9). */
  expectedOutcome: ExpectedOutcome;
  /** The latest observation's per-check truth. Null until the first attempt. */
  checkResults: OutcomeCheckResult[] | null;

  verificationIdentity: string;
  operationRunId: string | null;

  status: OutcomeStatus;
  failureCode: OutcomeFailureCode | null;

  attemptCount: number;

  startedAt: string | null;
  completedAt: string | null;
  observationStartedAt: string | null;
  observationCompletedAt: string | null;
  verificationWindowStartedAt: string | null;
  verificationWindowEndsAt: string | null;

  createdAt: string;
  updatedAt: string;
};

/**
 * **A verified product outcome is not a deployment, and not a business result**
 * (§2, §3, §33, §34).
 *
 * Named as a function so the distinction lives in code rather than only in
 * prose, and so anything tempted to render `verified` as "live", "shipped" or
 * "it worked" walks past this comment first.
 *
 * `verified` means one sentence: *Vibe requested a small, fixed set of public
 * URLs on this project's own origin and observed the behaviour the merged
 * capability was built to produce.*
 *
 * It does not identify which build is serving, it does not mean a deployment
 * happened, and it says nothing whatsoever about traffic, conversion, revenue,
 * activation or retention.
 */
export function outcomeIsNotDeploymentOrBusinessImpact(): true {
  return true;
}
