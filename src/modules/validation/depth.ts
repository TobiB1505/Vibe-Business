import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { ValidationStepName } from "./schema";

/**
 * How much of the profile's own validation a change deserves (Sprint 0047).
 *
 * ## Two axes, not one
 *
 * ```
 * ValidationProfile   which commands does this repository understand?   ← shape
 * ValidationDepth     how many of them does this change deserve?        ← risk
 * ```
 *
 * `resolveValidationProfile` answers the first from the repository snapshot —
 * framework, package manager, workspace layout — and has never had any opinion
 * about the change itself. That is correct and stays correct; this file answers
 * the second, and only ever selects a **subset of the profile's own steps**. No
 * depth can introduce a command the profile does not already define.
 *
 * ## What decides it, and what may not
 *
 * Deterministic, server-owned, and derived from data Vibe minted or observed:
 * the spec's `riskClass`, the trusted Action Step's `changeKind` and
 * `evidenceIds`, and the paths Vibe itself verified as changed. No model call,
 * no commit-message reading, no agent explanation — the agent cannot choose how
 * hard it will be checked, which is the whole point of independent validation.
 *
 * ## The bias, stated once
 *
 * Every uncertain case resolves **upward**. No trusted signal at all is
 * `standard`, never `fast`; an unrecognised evidence family is ignored rather
 * than treated as low risk; and a single sensitive changed path escalates the
 * whole run to `deep` however low the classifier's other inputs read. The cost
 * of over-validating is time. The cost of under-validating is a wrong verdict
 * on a change a human is about to approve.
 */

export const VALIDATION_DEPTHS = ["fast", "standard", "deep"] as const;
export type ValidationDepth = (typeof VALIDATION_DEPTHS)[number];

/**
 * Bumped when a depth's step set or the rules that select it change meaning.
 *
 * Part of the validation identity (`identity.ts`), so a stored `fast` pass can
 * never be reused as though it answered a `deep` question — the same discipline
 * `sandboxPolicyVersion` already enforces for the sandbox rules.
 */
export const VALIDATION_DEPTH_POLICY_VERSION = "validation-depth-v1" as const;

/**
 * Which of the profile's steps each depth runs.
 *
 * ## Why `standard` and `deep` are identical today
 *
 * Because the profile has exactly four steps and both depths need all four.
 * That is stated rather than papered over: `deep` is not currently *more* work
 * than `standard`, and claiming otherwise would be the false optimisation this
 * sprint is explicitly not allowed to make.
 *
 * The distinction is still real and still worth having. It is recorded on every
 * run, it is part of the validation identity, and it is the hook that the first
 * genuinely deeper check attaches to — a lint step, a migration-safety check, a
 * dependency audit. When one exists, `deep` grows and `standard` does not, and
 * every historical run already says which question it answered.
 *
 * ## Why `fast` still runs the build
 *
 * This is the one thing the first dogfood of this policy got wrong, and it is
 * worth stating plainly. `fast` originally ran `install` + `typecheck` only,
 * and the run failed with `validation_not_supported` — because the build is not
 * merely the fourth check.
 *
 * Two things depend on it, both structural rather than stylistic:
 *
 * - `buildSatisfiesProfile` requires a passing build for a run to be recorded
 *   as passed at all. That invariant predates this file and is deliberate: a
 *   pipeline that reached the end without building has not established the
 *   claim a pass makes.
 * - A passing run's filesystem is captured as the artifact a **preview** boots
 *   from — "the exact validated build". Skip the build and the artifact holds
 *   unbuilt bytes, so the next stage of the pipeline starts from something that
 *   was never compiled.
 *
 * There is also a plain engineering reason, independent of both. For a
 * presentational change the unit suite is the *least* likely of the four steps
 * to catch a regression — vitest never renders `src/app/layout.tsx` — while the
 * build prerenders every route and is the *most* likely. Dropping the build to
 * keep the tests would have skipped the step that actually checks the work.
 *
 * So `fast` skips exactly one step: `test`. The saving is smaller than the
 * first draft claimed, and it is the saving that is actually available.
 */
const DEPTH_STEPS: Record<ValidationDepth, readonly ValidationStepName[]> = {
  fast: ["install", "typecheck", "build"],
  standard: ["install", "typecheck", "test", "build"],
  deep: ["install", "typecheck", "test", "build"],
};

export function stepsForDepth(depth: ValidationDepth): readonly ValidationStepName[] {
  return DEPTH_STEPS[depth];
}

export function depthRunsStep(depth: ValidationDepth, step: ValidationStepName): boolean {
  return DEPTH_STEPS[depth].includes(step);
}

/**
 * Why a run got the depth it got. A closed vocabulary, so the UI can explain
 * a five-minute validation without anyone writing prose per case.
 */
export const VALIDATION_DEPTH_REASONS = [
  /** A changed path touches a domain that is always validated deeply. */
  "sensitive_domain_changed",
  /** The spec's own risk class is high or prohibited. */
  "high_risk_class",
  /** A cited evidence family names a sensitive business surface. */
  "sensitive_surface_evidence",
  /** Every cited signal is presentational and the risk class is low. */
  "presentational_low_risk",
  /** The step changes no application code. */
  "no_code_change",
  /** An ordinary product change at moderate risk. */
  "moderate_risk_change",
  /** Nothing trusted resolved. The safe default, never `fast`. */
  "unclassified_default",
] as const;
export type ValidationDepthReason = (typeof VALIDATION_DEPTH_REASONS)[number];

/**
 * Test files, which are never shipped.
 *
 * These are held apart from both path judgements below, in opposite directions,
 * and the historical benchmark is what forced the distinction:
 *
 * - They do **not** escalate on the domain they name. Run #8 changed
 *   `e2e/auth.spec.ts` and was classified `deep` for touching "auth" — but a
 *   Playwright spec is not an authentication flow, and no edit to it can put a
 *   flaw into the product. That was a false escalation.
 * - They do **not** buy `fast` either. A change that touches a test file is
 *   exactly the change whose test step must run, so a test file is absent from
 *   the presentational set below and blocks the skip.
 */
const TEST_FILE_PATTERN = /(^|\/)(e2e\/.*\.spec\.[cm]?[jt]sx?|.*\.test\.[cm]?[jt]sx?)$/i;

/**
 * Repository areas that are always validated deeply, whatever else is true.
 *
 * Matched against the paths **Vibe itself verified as changed** — not against a
 * plan's description of what it intended to change. That distinction is the
 * reason this rule is trustworthy: it reads the artifact, so a change that
 * wandered into a sensitive area escalates even when every upstream classifier
 * said it would not.
 *
 * Deliberately broad. A false escalation costs four minutes; a missed one lets
 * a billing or auth change be approved on a two-step verdict.
 */
const SENSITIVE_PATH_RULES: readonly { domain: string; pattern: RegExp }[] = [
  { domain: "billing", pattern: /(^|\/)(billing|credits|stripe|payments?)(\/|\.|$)/i },
  { domain: "auth", pattern: /(^|\/)(auth|session|login|signup|password|permissions?)(\/|\.|$)/i },
  { domain: "database", pattern: /(^|\/)(migrations?|supabase\/migrations)(\/|$)/i },
  { domain: "database", pattern: /\.sql$/i },
  {
    domain: "execution-core",
    pattern:
      /(^|\/)(coding-agent|execution|execution-contract|execution-context|operations|validation)(\/|$)/i,
  },
  { domain: "security", pattern: /(^|\/)(secrets?|credentials?|tokens?|middleware)(\/|\.|$)/i },
  /** Anything that changes what gets installed changes what everything else runs. */
  {
    domain: "build-identity",
    pattern:
      /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|next\.config\.[cm]?[jt]s|tsconfig\.json)$/i,
  },
  /** Repository-controlled automation. A workflow change is a supply-chain change. */
  { domain: "ci", pattern: /(^|\/)\.github\/workflows(\/|$)/i },
];

/**
 * Evidence families that name a sensitive business surface.
 *
 * Keyed on the Vibe-minted evidence-id namespace, exactly as `risk.ts` and
 * `execution-context/surface.ts` already are — never on prose.
 *
 * Exported (Sprint 0052, Credit Economics v1) so `economy/execution-class.ts`
 * can reuse the identical list rather than defining a second one that could
 * silently drift from this one. One taxonomy, two consumers — not two lists
 * that happen to agree today.
 */
export const SENSITIVE_EVIDENCE_PREFIXES: readonly string[] = [
  "repo.surface.payments",
  "repo.surface.checkout_billing",
  "repo.surface.authentication",
  "live.surface.checkout_billing",
  "live.surface.login",
  "live.surface.signup",
  "live.access.protected_surface",
  /*
   * The same surfaces, cited as absent (`business-evidence.v4`).
   *
   * Listed rather than matched loosely, and that is the design working as
   * intended. Polarity lives in its own namespace precisely so that
   * `repo.surface_absent.payments` does *not* satisfy a `repo.surface.payments`
   * prefix — which means every place where absence should also count has to say
   * so out loud. It does count here: a step that exists because there is no
   * checkout yet is a step that will build one.
   */
  "repo.surface_absent.payments",
  "repo.surface_absent.checkout_billing",
  "repo.surface_absent.authentication",
  "live.surface_absent.checkout_billing",
  "live.surface_absent.login",
  "live.surface_absent.signup",
];

/**
 * Evidence families whose implementation is presentational.
 *
 * The same list `execution-context/verification.ts` uses to decide how much the
 * *agent* checks its own work, reused here deliberately: if a change is shallow
 * enough that the agent only had to review its own diff, it is shallow enough
 * that independent validation can skip the production build. One definition of
 * "presentational", two consumers — not two lists that drift.
 */
const PRESENTATIONAL_EVIDENCE_PREFIXES: readonly string[] = [
  "live.seo.",
  "live.site.",
  "live.conversion.",
  "repo.surface.seo_metadata",
  "repo.surface.sitemap",
  "repo.surface.robots",
  "repo.surface.legal",
  "repo.surface.docs_help",
  "repo.surface.contact",
];

/**
 * File shapes whose contents can only affect what a page renders.
 *
 * ## Why this exists at all
 *
 * Because presentational *evidence* alone was not enough to justify skipping a
 * step, and the historical benchmark proved it: an Action Step citing
 * `live.seo.*` describes what the change is *for*, not what it touched. The
 * changed paths describe the artifact, so the two are required together — one
 * says the intent was cosmetic, the other says the result stayed cosmetic.
 *
 * ## Why `.tsx` and not `.ts`
 *
 * That single character is the whole guard. Under the App Router, route
 * handlers (`route.ts`), server actions (`actions.ts`) and every library module
 * are `.ts`; components, pages and layouts are `.tsx`. Requiring `.tsx` means a
 * change that reaches server logic is never presentational-confined, without
 * needing to enumerate the file names that carry logic.
 *
 * `src/app/api/**` is excluded anyway, belt and braces, because a `.tsx` under
 * an API route would be a surprising thing to trust.
 */
const PRESENTATIONAL_PATH_PATTERNS: readonly RegExp[] = [
  /^src\/app\/(?!api\/).*\.tsx$/i,
  /^src\/components\/.*\.tsx$/i,
  /\.(css|scss|svg)$/i,
];

/**
 * True when every changed path can only affect rendered output.
 *
 * Empty is false, deliberately: "no files changed" is not evidence that a
 * change is cosmetic, and `no_code_change` is the branch that handles it.
 */
export function isPresentationalConfined(changedPaths: readonly string[]): boolean {
  return (
    changedPaths.length > 0 &&
    changedPaths.every((path) => PRESENTATIONAL_PATH_PATTERNS.some((p) => p.test(path)))
  );
}

/** Change kinds that actually alter the product. The same set `risk.ts` uses. */
const MUTATING_CHANGE_KINDS: readonly StepChangeKind[] = ["product_change", "external_setup"];

export type ResolveValidationDepthInput = {
  /**
   * The spec's own risk class, when one could be resolved. Null degrades to the
   * safe default rather than to `fast`.
   */
  riskClass: ExecutionRiskClass | null;
  /** The trusted Action Step's change kind, when one was found. */
  changeKind: StepChangeKind | null;
  /** Vibe-minted evidence ids the step cites. Never free text. */
  evidenceIds: readonly string[];
  /**
   * Repository-relative paths Vibe verified as changed by this prepared change.
   *
   * The strongest signal here, because it describes the artifact rather than
   * anyone's intention for it.
   */
  changedPaths: readonly string[];
};

export type ValidationDepthResolution = {
  depth: ValidationDepth;
  steps: readonly ValidationStepName[];
  reason: ValidationDepthReason;
  policyVersion: typeof VALIDATION_DEPTH_POLICY_VERSION;
  /** The sensitive domains that forced an escalation, if any. Deduped, sorted. */
  escalatedBy: readonly string[];
};

/** Sensitive domains among the changed paths, deduped and ordered. */
export function sensitiveDomainsIn(changedPaths: readonly string[]): string[] {
  const found = new Set<string>();
  for (const path of changedPaths) {
    if (TEST_FILE_PATTERN.test(path)) continue;
    for (const rule of SENSITIVE_PATH_RULES) {
      if (rule.pattern.test(path)) found.add(rule.domain);
    }
  }
  return [...found].sort();
}

function resolution(
  depth: ValidationDepth,
  reason: ValidationDepthReason,
  escalatedBy: readonly string[] = [],
): ValidationDepthResolution {
  return {
    depth,
    steps: DEPTH_STEPS[depth],
    reason,
    policyVersion: VALIDATION_DEPTH_POLICY_VERSION,
    escalatedBy,
  };
}

/**
 * The depth for one prepared change.
 *
 * Order is the policy. Escalation is checked before anything that could lower
 * the answer, so no combination of inputs can talk a sensitive change down to
 * `fast`:
 *
 * 1. a sensitive changed path                    → `deep`, always
 * 2. a high or prohibited risk class             → `deep`
 * 3. sensitive evidence cited                    → `deep`
 * 4. no code change at all                       → `fast`
 * 5. presentational evidence *and* confined to
 *    presentational files                        → `fast`
 * 6. an ordinary moderate-risk change            → `standard`
 * 7. nothing resolved                            → `standard`
 *
 * Steps 4 and 5 are the only two that can produce `fast`, and both require a
 * trusted signal to have positively resolved — silence never buys speed.
 *
 * ## Why step 5 reads both the intent and the artifact
 *
 * It originally read only the evidence, plus a `riskClass !== "moderate"`
 * guard, and the historical benchmark (PART I) showed that combination could
 * never fire: `classifyExecutionRisk` returns `low` **only** for a non-mutating
 * change kind, which step 4 has already caught. Every real product change is
 * `moderate` or above, so the branch was unreachable and `fast` was dead.
 *
 * The guard that replaced the risk check is stricter where it matters. Instead
 * of asking the risk classifier a question it cannot answer at this
 * granularity, it asks the artifact directly: every changed path must be a file
 * whose contents can only affect rendered output. Intent *and* result must both
 * be cosmetic, and either one alone is not enough.
 */
export function resolveValidationDepth(
  input: ResolveValidationDepthInput,
): ValidationDepthResolution {
  const sensitiveDomains = sensitiveDomainsIn(input.changedPaths);
  if (sensitiveDomains.length > 0) {
    return resolution("deep", "sensitive_domain_changed", sensitiveDomains);
  }

  if (input.riskClass === "high" || input.riskClass === "prohibited") {
    return resolution("deep", "high_risk_class");
  }

  const citesSensitive = input.evidenceIds.some((id) =>
    SENSITIVE_EVIDENCE_PREFIXES.some((prefix) => id.startsWith(prefix)),
  );
  if (citesSensitive) return resolution("deep", "sensitive_surface_evidence");

  // Nothing trusted to reason from. Never `fast` (PART H, case 5).
  if (input.changeKind === null && input.riskClass === null) {
    return resolution("standard", "unclassified_default");
  }

  if (input.changeKind !== null && !MUTATING_CHANGE_KINDS.includes(input.changeKind)) {
    return resolution("fast", "no_code_change");
  }

  const allEvidencePresentational =
    input.evidenceIds.length > 0 &&
    input.evidenceIds.every((id) =>
      PRESENTATIONAL_EVIDENCE_PREFIXES.some((prefix) => id.startsWith(prefix)),
    );

  if (allEvidencePresentational && isPresentationalConfined(input.changedPaths)) {
    return resolution("fast", "presentational_low_risk");
  }

  return resolution("standard", "moderate_risk_change");
}

/** Human-readable, for the panel. Vibe's words, never a model's. */
export const VALIDATION_DEPTH_LABELS: Record<ValidationDepth, string> = {
  fast: "Fast",
  standard: "Standard",
  deep: "Deep",
};

export const VALIDATION_DEPTH_REASON_LABELS: Record<ValidationDepthReason, string> = {
  sensitive_domain_changed: "A changed file touches a sensitive area",
  high_risk_class: "High-risk change",
  sensitive_surface_evidence: "The step cites a sensitive business surface",
  presentational_low_risk: "Low-risk presentational change",
  no_code_change: "This step changes no application code",
  moderate_risk_change: "Moderate-risk product change",
  unclassified_default: "Change not classified; validated in full",
};
