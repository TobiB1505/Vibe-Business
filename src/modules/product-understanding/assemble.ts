import type { AuthenticatedProductIntelligenceSnapshot } from "@/modules/authenticated-product-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { buildBrandProfile } from "./brand";
import {
  deriveBusinessSignals,
  deriveCapabilities,
  deriveJourney,
  deriveTechnicalProfile,
} from "./deterministic";
import { evidenceId, readLiveBrand, safeText } from "./evidence";
import {
  CAPABILITY_LABELS,
  MAX_CORRECTION_LENGTH,
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
  SOURCE_PRIORITY,
  unknown,
  type Attributed,
  type EditableField,
  type EvidenceSource,
  type ProductCapability,
  type ProductProfile,
  type ProfileConfidence,
  type ProfileCorrections,
  type SourceStatus,
} from "./schema";
import type { ValidatedUnderstanding } from "./validate";

/**
 * Assembling one Product Profile from every source (CORE-1 §16, §25).
 *
 * Three inputs meet here and they do not have equal authority:
 *
 *   user correction  →  a person said so. Nothing overrides it.
 *   direct evidence  →  a source states it. `og:site_name` is the product's
 *                       name because the product said so.
 *   model inference  →  a reading of the evidence. Useful, and the weakest
 *                       thing in the room.
 *
 * `preferBySource` is the only place that ordering is applied, so
 * "user-confirmed facts are not blindly overwritten" is one function rather
 * than a convention every caller has to remember.
 *
 * This module is pure. It takes snapshots, an optional validated synthesis and
 * optional corrections, and returns a profile — no database, no provider, no
 * clock beyond the caller-supplied timestamp.
 */

const PRIORITY_RANK = new Map<EvidenceSource, number>(
  SOURCE_PRIORITY.map((source, index) => [source, index]),
);

const CONFIDENCE_RANK: Record<ProfileConfidence, number> = {
  confirmed: 0,
  likely: 1,
  unclear: 2,
  not_found: 3,
};

/**
 * Picks the strongest claim among candidates for one field.
 *
 * Three rules, applied in order, and the order is the whole design:
 *
 *  1. **A user's own words always win.** Nothing derived may displace them,
 *     whatever it thinks it knows (CORE-1 §25).
 *  2. **Then confidence.** A confirmed claim beats a likely one regardless of
 *     which source it came from. Ranking purely by source would let a
 *     repository's folder name — an unavoidably weak signal — beat a name the
 *     live site states outright, which was exactly the defect this ordering
 *     was written to avoid.
 *  3. **Then source**, as a tie-break: served beats declared beats inferred.
 *
 * A candidate with a null value never wins at any step. "The model had nothing
 * to say" must not beat "the site states its name".
 */
export function preferBySource<T>(candidates: Attributed<T>[]): Attributed<T> {
  const usable = candidates.filter((candidate) => candidate.value !== null);
  if (usable.length === 0) {
    // Report the most informative absence: `unclear` (we looked and it was
    // ambiguous) is more useful than `not_found` (nothing spoke to it).
    const ambiguous = candidates.find((candidate) => candidate.confidence === "unclear");
    return ambiguous ?? candidates[0] ?? unknown<T>();
  }

  const authored = usable.find((candidate) => candidate.sources.includes("user_confirmed"));
  if (authored) return authored;

  const sourceRank = (entry: Attributed<T>) =>
    Math.min(...entry.sources.map((source) => PRIORITY_RANK.get(source) ?? SOURCE_PRIORITY.length));

  return usable.reduce((best, candidate) => {
    const byConfidence = CONFIDENCE_RANK[candidate.confidence] - CONFIDENCE_RANK[best.confidence];
    if (byConfidence !== 0) return byConfidence < 0 ? candidate : best;
    return sourceRank(candidate) < sourceRank(best) ? candidate : best;
  });
}

/** A correction the user typed. The strongest claim there is (CORE-1 §25). */
function fromCorrection(value: string | undefined): Attributed<string> | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text === "" || text.length > MAX_CORRECTION_LENGTH) return null;
  return { value: text, confidence: "confirmed", sources: ["user_confirmed"], evidence: [] };
}

// ---------------------------------------------------------------------
// Deterministic identity candidates
// ---------------------------------------------------------------------

/**
 * The product's name, from the sources that actually state one.
 *
 * `og:site_name` and `application-name` exist to name a product, so they are
 * `confirmed`. A repository's own name is a real but much weaker claim —
 * plenty of repositories are called `web`, `app`, or `my-project` — so it is
 * offered as `likely`. It stands in when nothing better exists and loses to
 * anything confirmed, including the user.
 */
function nameCandidates(
  repository: RepositoryIntelligenceSnapshot | null,
  liveProduct: LiveProductIntelligenceSnapshot | null,
): Attributed<string>[] {
  const candidates: Attributed<string>[] = [];

  if (liveProduct) {
    const siteName = safeText(readLiveBrand(liveProduct).siteName);
    if (siteName) {
      candidates.push({
        value: siteName,
        confidence: "confirmed",
        sources: ["live_product"],
        evidence: [evidenceId.liveSiteName()],
      });
    }
  }

  if (repository) {
    const repositoryName = safeText(repository.repository.fullName.split("/").pop() ?? null);
    if (repositoryName) {
      candidates.push({
        value: repositoryName,
        // Weak on purpose: what a repository is called is not what a product
        // is called, and this must never outrank the model or the user.
        confidence: "likely",
        sources: ["repository"],
        evidence: [evidenceId.repoName()],
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------

/**
 * Orders the deterministic capabilities by the model's ranking.
 *
 * The model **selects and orders**; it never adds. A capability it names that
 * the deterministic layer did not find is dropped silently — that is the
 * "no invented features" rule (CORE-1 §20), and it is enforced by this
 * intersection rather than by the prompt.
 */
export function rankCapabilities(
  derived: ProductCapability[],
  ranked: { id: ProductCapability["id"]; evidence: string[] }[],
): ProductCapability[] {
  const byId = new Map(derived.map((capability) => [capability.id, capability]));
  const ordered: ProductCapability[] = [];

  for (const entry of ranked) {
    const capability = byId.get(entry.id);
    if (!capability) continue;
    byId.delete(entry.id);
    ordered.push({
      ...capability,
      // The model's citations are added to the deterministic ones rather than
      // replacing them: the deterministic evidence is what makes the
      // capability true, the model's is why it was ranked highly.
      evidence: [...new Set([...capability.evidence, ...entry.evidence])],
    });
  }

  return [...ordered, ...byId.values()];
}

// ---------------------------------------------------------------------
// Sources and completeness
// ---------------------------------------------------------------------

function buildSourceStatuses(input: AssembleInput): SourceStatus[] {
  return [
    {
      source: "repository",
      used: input.repository !== null,
      note: input.repository ? "Your code" : "Your code has not been read yet",
    },
    {
      source: "live_product",
      used: input.liveProduct !== null,
      note: input.liveProduct ? "Your public product" : "Your public product has not been checked yet",
    },
    {
      source: "deep_scan",
      used: input.signedInProduct !== null,
      note: input.signedInProduct
        ? "Your signed-in product"
        : "Your signed-in product has not been checked yet",
    },
  ];
}

// ---------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------

export type AssembleInput = {
  repository: RepositoryIntelligenceSnapshot | null;
  liveProduct: LiveProductIntelligenceSnapshot | null;
  signedInProduct: AuthenticatedProductIntelligenceSnapshot | null;
  /** Null when no model ran — the profile is then fully deterministic. */
  synthesis: ValidatedUnderstanding | null;
  corrections: ProfileCorrections;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  generatedAt: string;
};

export function assembleProfile(input: AssembleInput): ProductProfile {
  const deterministicInput = {
    repository: input.repository,
    liveProduct: input.liveProduct,
    signedInProduct: input.signedInProduct,
  };

  const synthesized = input.synthesis?.fields;

  /** One attributed field, resolved across correction → evidence → model. */
  function resolve(
    field: EditableField | "userType" | "useCase",
    evidenceCandidates: Attributed<string>[] = [],
  ): Attributed<string> {
    const candidates: Attributed<string>[] = [];

    const corrected = fromCorrection(
      input.corrections[field as EditableField],
    );
    if (corrected) candidates.push(corrected);

    candidates.push(...evidenceCandidates);

    const fromModel = synthesized?.[field as keyof typeof synthesized];
    if (fromModel) candidates.push(fromModel);

    return preferBySource(candidates);
  }

  const capabilities = rankCapabilities(
    deriveCapabilities(deterministicInput),
    input.synthesis?.rankedCapabilities ?? [],
  );

  const brand = buildBrandProfile({
    repository: input.repository,
    liveProduct: input.liveProduct,
  });

  if (synthesized) {
    brand.voice.tone = synthesized.tone;
    brand.voice.positioningLine = synthesized.positioningLine;
  }

  const sources = buildSourceStatuses(input);

  const limitations = [...(input.synthesis?.limitations ?? [])];
  if (!input.repository) {
    limitations.unshift("Vibe has not read your code yet, so how the product is built is unknown.");
  }
  if (!input.liveProduct) {
    limitations.unshift(
      "Vibe has not checked your public product yet, so what a visitor sees is unknown.",
    );
  }
  if (!input.signedInProduct) {
    limitations.push("Nothing behind your login has been checked, so the signed-in product is unseen.");
  }
  for (const note of input.synthesis?.notes ?? []) limitations.push(note);

  return {
    schemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    builderVersion: PROFILE_BUILDER_VERSION,
    promptVersion: input.promptVersion,
    provider: input.provider,
    model: input.model,

    identity: {
      name: resolve("name", nameCandidates(input.repository, input.liveProduct)),
      shortDescription: resolve("shortDescription"),
      understanding: resolve("understanding"),
      category: input.synthesis?.category ?? unknown(),
      mainPurpose: resolve("mainPurpose"),
      mainPromise: resolve("mainPromise"),
    },
    audience: {
      primaryAudience: resolve("primaryAudience"),
      userType: resolve("userType"),
      problemSolved: resolve("problemSolved"),
      useCase: resolve("useCase"),
    },
    capabilities,
    journey: deriveJourney(deterministicInput),
    businessSignals: deriveBusinessSignals(deterministicInput),
    brand,
    technical: deriveTechnicalProfile(deterministicInput),

    sources,
    // Deep Scan is optional and its absence is stated rather than counted
    // against the profile — the two public sources are what "complete" means
    // here (CORE-1 §43).
    completeness: input.repository && input.liveProduct ? "complete" : "partial",
    limitations: [...new Set(limitations)].slice(0, 6),
    generatedAt: input.generatedAt,
  };
}

/**
 * Re-applies corrections to an already-derived profile.
 *
 * This is what makes a re-scan safe (CORE-1 §25). New scanner evidence
 * replaces the derived half wholesale, then this puts the person's own words
 * back on top — so a founder who told Vibe their product is for restaurant
 * owners does not find it addressed to freelancers after the next scan.
 */
export function applyCorrections(
  profile: ProductProfile,
  corrections: ProfileCorrections,
): ProductProfile {
  function overlay(current: Attributed<string>, field: EditableField): Attributed<string> {
    const corrected = fromCorrection(corrections[field]);
    return corrected ?? current;
  }

  return {
    ...profile,
    identity: {
      ...profile.identity,
      name: overlay(profile.identity.name, "name"),
      shortDescription: overlay(profile.identity.shortDescription, "shortDescription"),
      understanding: overlay(profile.identity.understanding, "understanding"),
      mainPurpose: overlay(profile.identity.mainPurpose, "mainPurpose"),
      mainPromise: overlay(profile.identity.mainPromise, "mainPromise"),
    },
    audience: {
      ...profile.audience,
      primaryAudience: overlay(profile.audience.primaryAudience, "primaryAudience"),
      problemSolved: overlay(profile.audience.problemSolved, "problemSolved"),
    },
  };
}

/** Label for a capability, honouring a user's own wording when present. */
export function capabilityLabel(capability: ProductCapability): string {
  return capability.label || CAPABILITY_LABELS[capability.id];
}
