import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { CURRENT_SEO_FOUNDATIONS_CAPABILITY, type ExecutionCapability } from "./schema";

/**
 * Deterministic capability resolution (Sprint 9 §7, §33).
 *
 * ## Why this never reads the opportunity's prose
 *
 * The tempting implementation is `title.includes("SEO")`. It is also the worst
 * one available: the title is model output, so a prompt improvement, a
 * rewording, or a translation would silently change which opportunities Vibe
 * is willing to write code for. **Model wording is not a machine API.**
 *
 * So the resolver reads only structured fields and current deterministic
 * evidence. A differently-worded opportunity with the same structure resolves
 * the same way; an identically-worded one without the structure does not
 * resolve at all. Both are tested.
 *
 * ## Readiness is not authority
 *
 * `executionReadiness === "ready"` is the model's opinion that a human could
 * act on this. It says nothing about whether Vibe has an executor. Those are
 * different questions and conflating them is how a product ends up offering a
 * button it cannot honour.
 */

/** Evidence ids that assert the absence this capability exists to fix. */
const ROBOTS_ABSENCE_EVIDENCE = ["live.seo.robots_txt_missing", "repo.surface.robots"];
const SITEMAP_ABSENCE_EVIDENCE = ["live.seo.sitemap_missing", "repo.surface.sitemap"];

export type CapabilityResolutionInput = {
  opportunity: BusinessOpportunity;
  repository: RepositoryIntelligenceSnapshot;
  /** True when the project has a verified production origin (§12). */
  hasProductionOrigin: boolean;
};

export type CapabilityResolution =
  | { supported: true; capability: ExecutionCapability }
  | { supported: false; reason: "not_a_code_change" | "no_matching_capability" | "unsupported_framework" };

function detectsFramework(repository: RepositoryIntelligenceSnapshot, id: string): boolean {
  return repository.frameworks.some((framework) => framework.id === id);
}

/** True when the snapshot says this surface was *not* found. */
function surfaceAbsent(repository: RepositoryIntelligenceSnapshot, id: string): boolean {
  const surface = repository.businessSurfaces.find((entry) => entry.id === id);
  return surface !== undefined && !surface.detected;
}

/**
 * Does the opportunity's own evidence assert the absence this capability
 * addresses?
 *
 * This reads the ids the model cited — which are validated to exist, but were
 * still correct-looking in the Sprint 8 failure. It is therefore a *routing*
 * signal only: it decides which executor might apply, never whether it is safe
 * to run. Safety comes from `preflight.ts`, which re-checks the world.
 */
function citesAbsenceEvidence(opportunity: BusinessOpportunity, ids: string[]): boolean {
  return opportunity.evidenceIds.some((cited) => ids.includes(cited));
}

export function resolveExecutionCapability(
  input: CapabilityResolutionInput,
): CapabilityResolution {
  const { opportunity, repository } = input;

  // Structured, not textual. An opportunity the model classified as a business
  // decision is not something to write code for, whatever its title says.
  if (opportunity.executionType !== "code_change" && opportunity.executionType !== "configuration_change") {
    return { supported: false, reason: "not_a_code_change" };
  }

  const addressesRobots = citesAbsenceEvidence(opportunity, ROBOTS_ABSENCE_EVIDENCE);
  const addressesSitemap = citesAbsenceEvidence(opportunity, SITEMAP_ABSENCE_EVIDENCE);

  // Both halves must be in scope: this capability writes both files, and
  // preparing a sitemap for an opportunity that only ever mentioned robots
  // would be Vibe doing work nobody asked for.
  if (!addressesRobots || !addressesSitemap) {
    return { supported: false, reason: "no_matching_capability" };
  }

  // The generator emits Next.js App Router metadata routes. Anything else is
  // a different capability that does not exist yet.
  if (!detectsFramework(repository, "nextjs")) {
    return { supported: false, reason: "unsupported_framework" };
  }

  // The snapshot must agree the surfaces are missing. `preflight.ts` re-checks
  // this against the live repository before writing; here it only prevents
  // offering an executor for a product that already has them.
  if (!surfaceAbsent(repository, "robots") || !surfaceAbsent(repository, "sitemap")) {
    return { supported: false, reason: "no_matching_capability" };
  }

  // Always the current capability. v1 is still declared for the historical
  // PreparedChange rows that were written by it, but it is never resolved.
  return { supported: true, capability: CURRENT_SEO_FOUNDATIONS_CAPABILITY };
}
