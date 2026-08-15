import { businessRationaleFor } from "./business-rationale";
import { outcomeProfileForCapability } from "./outcome-contract";
import { capabilityBasenames } from "./paths";
import {
  CURRENT_SEO_FOUNDATIONS_CAPABILITY,
  EXECUTION_CAPABILITIES,
  capabilityVersionFor,
  type ExecutionCapability,
} from "./schema";

/**
 * What makes a capability executable, in one place (Sprint 13A §13, §39, §44).
 *
 * ## The problem this solves
 *
 * A capability's definition is currently spread across eight modules, each
 * keyed by the same union: the version map, the write allowlist, the outcome
 * profile, the measurement profile, the rationale, the generator, the view and
 * the outcome-verification schema. Nothing forces them to agree.
 *
 * That was survivable with one capability. With four it is a trap, and the
 * failure is silent in the worst way: a capability could ship with a generator
 * and no rationale, or with an outcome profile that verifies paths its
 * generator never writes. Both produce a product that executes and then
 * explains itself wrongly.
 *
 * ## What this is, deliberately
 *
 * An **index and a completeness contract**, not a plugin framework. It does not
 * move the existing modules or wrap them in an abstraction — each still owns
 * its own logic, which is where that logic belongs. What it adds is a single
 * place that can answer "is this capability complete?" and a test that fails
 * when the answer is no.
 *
 * The thing to optimise for is adding capability #5 cleanly. Not supporting
 * hypothetical third-party extensions, and not making every lookup go through
 * one object because symmetry felt tidy.
 *
 * ## The write budget, which is new here
 *
 * `paths.ts` already answers *which* files a capability may write. It does not
 * answer *how many*. A deterministic generator that suddenly emits nine files
 * is a defect whatever their names, and a diff that size stops being reviewable
 * — which is the property the whole human-approval gate depends on (§44).
 */

export type CapabilityCompleteness =
  | { complete: true }
  | { complete: false; missing: string[] };

export type CapabilityDefinition = {
  id: ExecutionCapability;
  /** The generator version this capability emits. */
  version: string;
  /**
   * Whether new preparations may resolve to this capability.
   *
   * `historical` capabilities keep their definitions because real customer
   * artifacts were produced by them and must stay interpretable — a
   * PreparedChange from v1 means what it meant when it was written (§40).
   */
  status: "current" | "historical";
  /** Exact basenames the generator may create. Owned by `paths.ts`. */
  basenames: readonly string[];
  /**
   * The most files this capability may ever change.
   *
   * A ceiling rather than an expectation: exceeding it fails the preparation
   * *before* any repository write, so a generator defect cannot become a broad
   * refactor in somebody's repository.
   */
  maxChangedFiles: number;
};

/**
 * Per-capability facts that have no other home.
 *
 * Everything else is read from the module that owns it, so this map cannot
 * drift from the version, the write allowlist, the rationale or the profiles —
 * it has no copy of them to drift from.
 */
const BUDGETS: Record<ExecutionCapability, number> = {
  // Two files, always: robots.ts and sitemap.ts. The budget is the real number
  // rather than a round one, because a budget with headroom is a budget that
  // never fires.
  nextjs_seo_foundations_v1: 2,
  nextjs_seo_foundations_v2: 2,
};

export function capabilityDefinition(capability: ExecutionCapability): CapabilityDefinition {
  return {
    id: capability,
    version: capabilityVersionFor(capability),
    status: capability === CURRENT_SEO_FOUNDATIONS_CAPABILITY ? "current" : "historical",
    basenames: capabilityBasenames(capability),
    maxChangedFiles: BUDGETS[capability],
  };
}

export function allCapabilityDefinitions(): CapabilityDefinition[] {
  return EXECUTION_CAPABILITIES.map(capabilityDefinition);
}

/**
 * Whether a capability has everything execution requires (§59).
 *
 * The list is the sprint's own definition of production-ready, expressed as
 * something a test can run rather than as a paragraph somebody has to remember:
 *
 *  - a **rationale**, because a change nobody can explain should not be offered;
 *  - a **product outcome profile**, because a change whose success cannot be
 *    checked afterwards is a change nobody can be held to;
 *  - a **write allowlist** and a **budget**, because scope has to be bounded
 *    before a generator runs, not after;
 *  - a **version**, because historical artifacts must stay interpretable.
 *
 * A measurement profile is deliberately *not* required. Business measurement is
 * optional evidence that may never arrive, and requiring it would make
 * executability depend on analytics — which is exactly the coupling the 12C
 * cleanup removed.
 */
export function capabilityCompleteness(capability: ExecutionCapability): CapabilityCompleteness {
  const missing: string[] = [];

  if (!businessRationaleFor(capability)) missing.push("businessRationale");
  if (!outcomeProfileForCapability(capability)) missing.push("outcomeProfile");
  if (capabilityBasenames(capability).length === 0) missing.push("writeAllowlist");
  if (!(BUDGETS[capability] > 0)) missing.push("maxChangedFiles");
  if (!capabilityVersionFor(capability)) missing.push("version");

  return missing.length === 0 ? { complete: true } : { complete: false, missing };
}

/**
 * Whether a set of generated files fits the capability's budget (§44).
 *
 * Checked against the *generator's output*, before anything is written. A
 * capability cannot raise its own ceiling at runtime — the number lives here,
 * not in the generator that would be exceeding it.
 */
export function withinWriteBudget(
  capability: ExecutionCapability,
  fileCount: number,
): { ok: true } | { ok: false; budget: number; attempted: number } {
  const budget = BUDGETS[capability];
  if (fileCount <= budget) return { ok: true };
  return { ok: false, budget, attempted: fileCount };
}

/** Whether new preparations may resolve to this capability. */
export function isCurrentCapability(capability: ExecutionCapability): boolean {
  return capabilityDefinition(capability).status === "current";
}
