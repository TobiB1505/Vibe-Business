import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import {
  ROBOTS_ABSENCE_EVIDENCE,
  SITEMAP_ABSENCE_EVIDENCE,
} from "@/modules/execution/capabilities";
import {
  CURRENT_SEO_FOUNDATIONS_CAPABILITY,
  capabilityVersionFor,
  type ExecutionCapability,
} from "@/modules/execution/schema";
import type { StepChangeKind } from "./schema";

/**
 * The **server-owned** capability registry (CORE-2b §10, §46, §47).
 *
 * ## The rule this file is
 *
 * A model may propose a business action. It may not tell us what Vibe can do.
 *
 * The temptation is a wire field — `capability: "nextjs_seo_foundations_v2"` —
 * and it is the worst available design: the model would be inventing system
 * authority from a name it saw in a prompt, and a hallucinated capability id
 * would arrive looking exactly like a real one. So there is no such field
 * anywhere in `wire-schema.ts`, and this registry is the only thing in the
 * system that can produce an `ExecutionCapability` for a plan step.
 *
 * ## What matching is allowed to read
 *
 * Structured step fields and current deterministic repository evidence. Never
 * the step's title, description, purpose, or completion criteria — model
 * wording is not a machine API, and keying on it would mean a prompt tweak or a
 * translation silently changed what Vibe is willing to execute. That is the
 * lesson `execution/capabilities.ts` already records; this is the same rule one
 * layer earlier, so the two agree by construction rather than by luck.
 *
 * ## What a match is *not*
 *
 * A match says an executor exists for this shape of work. It says nothing about
 * whether running it now is safe: the premise is revalidated against live state
 * immediately before any write (ADR 0014, Rule 55), and this sprint executes
 * nothing at all. A registry match here is a routing signal and a truthful
 * label — never permission.
 */

/** Everything matching may look at. Deterministic; no model prose. */
export type CapabilityMatchContext = {
  /** The newest successful repository snapshot, or null when none exists. */
  repository: RepositoryIntelligenceSnapshot | null;
};

/** The structured half of a step — the only part matching may read. */
export type CapabilityMatchStep = {
  changeKind: StepChangeKind;
  evidenceIds: string[];
};

type RegistryEntry = {
  capability: ExecutionCapability;
  /**
   * Change kinds this capability could possibly serve.
   *
   * Checked first because it is the cheapest and the most categorical: a
   * capability that writes files can never serve a founder's decision, whatever
   * evidence the step happens to cite.
   */
  changeKinds: readonly StepChangeKind[];
  matches(step: CapabilityMatchStep, context: CapabilityMatchContext): boolean;
};

function detectsFramework(repository: RepositoryIntelligenceSnapshot, id: string): boolean {
  return repository.frameworks.some((framework) => framework.id === id);
}

/** True when the snapshot says this surface was *not* found. */
function surfaceAbsent(repository: RepositoryIntelligenceSnapshot, id: string): boolean {
  const surface = repository.businessSurfaces.find((entry) => entry.id === id);
  return surface !== undefined && !surface.detected;
}

function citesAny(step: CapabilityMatchStep, ids: readonly string[]): boolean {
  return step.evidenceIds.some((cited) => ids.includes(cited));
}

/**
 * Every capability Vibe actually has (§11).
 *
 * One entry, and that is the honest state of the product. Vibe cannot rewrite
 * a landing page, implement pricing, integrate Stripe, change authentication,
 * migrate a database or author arbitrary React — so nothing here claims it can,
 * and a plan step proposing any of those resolves to `not_yet_supported` rather
 * than to a capability that does not exist.
 *
 * Adding an entry is a deliberate act with an executor behind it. It is not
 * something a prompt change can do.
 */
export const CAPABILITY_REGISTRY: readonly RegistryEntry[] = [
  {
    capability: CURRENT_SEO_FOUNDATIONS_CAPABILITY,
    changeKinds: ["product_change"],
    matches(step, context) {
      const repository = context.repository;
      if (!repository) return false;

      // Both halves must be in scope: this capability writes robots.txt *and* a
      // sitemap, and matching a step that only ever concerned one of them would
      // be Vibe volunteering work nobody planned.
      if (!citesAny(step, ROBOTS_ABSENCE_EVIDENCE)) return false;
      if (!citesAny(step, SITEMAP_ABSENCE_EVIDENCE)) return false;

      // The generator emits Next.js App Router metadata routes. Anything else
      // is a different capability, and it does not exist.
      if (!detectsFramework(repository, "nextjs")) return false;

      // The snapshot must still agree the surfaces are missing. Preparing a
      // robots.txt for a project that has one is not an improvement.
      return surfaceAbsent(repository, "robots") && surfaceAbsent(repository, "sitemap");
    },
  },
];

export type CapabilityMatch = {
  capability: ExecutionCapability;
  capabilityVersion: string;
};

/**
 * The capability backing a step, or null.
 *
 * Null is the overwhelmingly common answer and is not a failure — it is the
 * product telling the truth about what it can automate today (§28).
 */
export function matchCapability(
  step: CapabilityMatchStep,
  context: CapabilityMatchContext,
): CapabilityMatch | null {
  for (const entry of CAPABILITY_REGISTRY) {
    if (!entry.changeKinds.includes(step.changeKind)) continue;
    if (!entry.matches(step, context)) continue;
    return {
      capability: entry.capability,
      capabilityVersion: capabilityVersionFor(entry.capability),
    };
  }
  return null;
}

/** True when the id names a capability this system actually has (§84). */
export function isKnownCapability(value: unknown): value is ExecutionCapability {
  return CAPABILITY_REGISTRY.some((entry) => entry.capability === value);
}
