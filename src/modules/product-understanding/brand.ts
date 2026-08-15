import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { evidenceId, readLiveBrand, readRepositoryBrand, safeText } from "./evidence";
import {
  unknown,
  type BrandAsset,
  type BrandAssetRole,
  type BrandColor,
  type BrandColorRole,
  type BrandProfile,
  type BrandTypeface,
  type ProfileConfidence,
} from "./schema";

/**
 * Resolving one brand from two collectors (CORE-1 §11–§13, §29, §30).
 *
 * The repository says what a design system *declares*; the live site says what
 * a visitor is *served*. This decides what to believe when they differ, and the
 * rule is the same one the rest of the profile uses: **being served beats being
 * declared**, because a customer only ever sees what is served.
 *
 * ## Why `displayUrl` is so restrictive
 *
 * CORE-1 §29 asks for a logo reveal and then immediately constrains it: *"Das
 * Logo darf erst erscheinen, wenn es wirklich erkannt wurde. Keine falschen
 * Assets."* A reveal that renders a broken image is worse than no reveal, and
 * a reveal that renders the wrong image is worse still.
 *
 * So a URL is produced only when the product's own origin is known and the
 * asset lives on it. Two consequences, both accepted deliberately:
 *
 *  - A project with no production URL configured never shows a logo, even
 *    when one is sitting in `public/logo.svg`. Vibe has no origin to serve it
 *    from and will not guess one.
 *  - A logo hosted on a CDN is *recorded* but not *rendered*. Displaying an
 *    arbitrary third-party host in Vibe's own UI is a wider door than a logo
 *    reveal is worth opening.
 *
 * Either way the UI falls back to a neutral product mark, which is honest.
 */

/**
 * Collector confidence → profile confidence.
 *
 * `high` becomes `confirmed` only because the collectors reserve `high` for
 * declarations — a `rel="icon"` link, a token literally named `--color-primary`.
 * A guess never reaches `high` on either side.
 */
function toProfileConfidence(confidence: "high" | "medium" | "low"): ProfileConfidence {
  if (confidence === "high") return "confirmed";
  if (confidence === "medium") return "likely";
  return "unclear";
}

/**
 * Whether an asset reference can safely be rendered in Vibe's UI.
 *
 * Only `https` on the product's own origin. The browser makes this request,
 * not the server, so ADR 0010's safe-fetch boundary does not apply — but the
 * narrow rule keeps Vibe from rendering an arbitrary remote host inside its
 * own pages regardless.
 */
export function resolveDisplayUrl(reference: string, origin: string | null): string | null {
  if (origin === null) return null;

  try {
    const base = new URL(origin);
    if (base.protocol !== "https:") return null;

    const resolved = new URL(reference, base);
    if (resolved.protocol !== "https:") return null;
    if (resolved.origin !== base.origin) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------

const ASSET_ROLE_ORDER: BrandAssetRole[] = [
  "logo",
  "logo_alternate",
  "favicon",
  "app_icon",
  "open_graph_image",
];

const CONFIDENCE_ORDER: Record<ProfileConfidence, number> = {
  confirmed: 0,
  likely: 1,
  unclear: 2,
  not_found: 3,
};

function buildAssets(
  repository: RepositoryIntelligenceSnapshot | null,
  liveProduct: LiveProductIntelligenceSnapshot | null,
  origin: string | null,
): BrandAsset[] {
  const assets: BrandAsset[] = [];

  if (liveProduct) {
    for (const asset of readLiveBrand(liveProduct).assets) {
      // The live collector has a role the profile does not model: a web
      // manifest is a file, not a mark, and nothing in the profile shows one.
      if (asset.role === "web_manifest") continue;
      assets.push({
        role: asset.role,
        reference: asset.path,
        displayUrl: resolveDisplayUrl(asset.path, origin),
        confidence: toProfileConfidence(asset.confidence),
        sources: ["live_product"],
        evidence: [evidenceId.liveBrandAsset(asset.role)],
      });
    }
  }

  if (repository) {
    for (const asset of readRepositoryBrand(repository).assets) {
      const existing = assets.find((candidate) => candidate.role === asset.role);
      const displayUrl = asset.servedPath ? resolveDisplayUrl(asset.servedPath, origin) : null;

      if (existing) {
        // Both collectors saw it. That is corroboration, not a second asset —
        // and the *live* reference wins, because it is the one a visitor gets.
        if (!existing.sources.includes("repository")) existing.sources.push("repository");
        existing.evidence.push(evidenceId.repoBrandAsset(asset.role));
        if (existing.confidence !== "confirmed") existing.confidence = "confirmed";
        continue;
      }

      assets.push({
        role: asset.role,
        reference: asset.path,
        displayUrl,
        // Declared in code but never seen being served: a step below whatever
        // the collector thought, because reachability is precisely what was
        // not established.
        confidence: asset.confidence === "high" ? "likely" : "unclear",
        sources: ["repository"],
        evidence: [evidenceId.repoBrandAsset(asset.role)],
      });
    }
  }

  return assets.sort(
    (a, b) =>
      ASSET_ROLE_ORDER.indexOf(a.role) - ASSET_ROLE_ORDER.indexOf(b.role) ||
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence],
  );
}

// ---------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------

function buildColors(
  repository: RepositoryIntelligenceSnapshot | null,
  liveProduct: LiveProductIntelligenceSnapshot | null,
): BrandColor[] {
  const colors: BrandColor[] = [];
  const takenRoles = new Set<BrandColorRole>();
  const takenValues = new Set<string>();

  function add(color: BrandColor) {
    if (takenRoles.has(color.role) || takenValues.has(color.value)) return;
    takenRoles.add(color.role);
    takenValues.add(color.value);
    colors.push(color);
  }

  // A `theme-color` meta tag exists for exactly one purpose — to tell a
  // browser what colour this product is — so it outranks everything else.
  if (liveProduct) {
    const live = readLiveBrand(liveProduct);
    live.colors.forEach((color, index) => {
      if (color.source !== "theme_color_meta") return;
      add({
        role: "primary",
        value: color.value,
        confidence: "confirmed",
        sources: ["live_product"],
        evidence: [evidenceId.liveBrandColor(index)],
      });
    });
  }

  if (repository) {
    for (const color of readRepositoryBrand(repository).colors) {
      add({
        role: color.role,
        value: color.value,
        confidence: toProfileConfidence(color.confidence),
        sources: ["repository"],
        evidence: [evidenceId.repoBrandColor(color.role)],
      });
    }
  }

  if (liveProduct) {
    const live = readLiveBrand(liveProduct);
    live.colors.forEach((color, index) => {
      if (color.source === "theme_color_meta") return;
      add({
        role: takenRoles.has("primary") ? "accent" : "primary",
        value: color.value,
        confidence: toProfileConfidence(color.confidence),
        sources: ["live_product"],
        evidence: [evidenceId.liveBrandColor(index)],
      });
    });
  }

  return colors;
}

// ---------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------

/**
 * The repository knows a typeface's *role*, the live site knows its *spelling*.
 *
 * Neither alone is enough. A `next/font` loader variable gives us
 * `--font-jetbrains-mono`, which title-cases to "Jetbrains Mono" — not what the
 * foundry, or the founder, calls it. The live page's `font-family` stack
 * carries the real string. So role comes from code and spelling from the page,
 * matched case-insensitively.
 */
function buildTypefaces(
  repository: RepositoryIntelligenceSnapshot | null,
  liveProduct: LiveProductIntelligenceSnapshot | null,
): BrandTypeface[] {
  const liveFamilies = liveProduct ? readLiveBrand(liveProduct).typefaces : [];

  function preferredSpelling(family: string): { family: string; corroborated: boolean } {
    const match = liveFamilies.find(
      (candidate) => candidate.toLowerCase() === family.toLowerCase(),
    );
    return match ? { family: match, corroborated: true } : { family, corroborated: false };
  }

  const typefaces: BrandTypeface[] = [];
  const takenRoles = new Set<BrandTypeface["role"]>();

  if (repository) {
    for (const typeface of readRepositoryBrand(repository).typefaces) {
      if (takenRoles.has(typeface.role)) continue;
      takenRoles.add(typeface.role);
      const { family, corroborated } = preferredSpelling(typeface.family);
      typefaces.push({
        role: typeface.role,
        family,
        confidence: corroborated ? "confirmed" : toProfileConfidence(typeface.confidence),
        sources: corroborated ? ["repository", "live_product"] : ["repository"],
        evidence: [evidenceId.repoBrandType(typeface.role)],
      });
    }
  }

  // Families the live page named that the code did not. Role is genuinely
  // unknown, so it is reported as body rather than guessed at, with the
  // confidence that guess deserves.
  liveFamilies.forEach((family, index) => {
    const known = typefaces.some(
      (candidate) => candidate.family.toLowerCase() === family.toLowerCase(),
    );
    if (known || takenRoles.has("body")) return;
    takenRoles.add("body");
    typefaces.push({
      role: "body",
      family,
      confidence: "likely",
      sources: ["live_product"],
      evidence: [evidenceId.liveBrandType(index)],
    });
  });

  return typefaces;
}

// ---------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------

const MAX_PHRASES = 6;

/**
 * Phrases the product repeats about itself (CORE-1 §14).
 *
 * Deterministic and deliberately shallow: these are call-to-action labels the
 * live site actually uses, deduplicated. No tone analysis, no archetype, no
 * brand psychology — those either come from the model as a short, cited
 * judgement, or not at all.
 */
export function deriveRecurringPhrases(
  liveProduct: LiveProductIntelligenceSnapshot | null,
): string[] {
  if (!liveProduct) return [];

  const counts = new Map<string, number>();
  for (const page of liveProduct.pages) {
    for (const raw of page.ctas) {
      const text = safeText(raw);
      if (!text || text.length > 60) continue;
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_PHRASES)
    .map(([phrase]) => phrase);
}

// ---------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------

export function buildBrandProfile(input: {
  repository: RepositoryIntelligenceSnapshot | null;
  liveProduct: LiveProductIntelligenceSnapshot | null;
}): BrandProfile {
  const origin = input.liveProduct?.source.effectiveOrigin ?? null;

  return {
    assets: buildAssets(input.repository, input.liveProduct, origin),
    colors: buildColors(input.repository, input.liveProduct),
    typefaces: buildTypefaces(input.repository, input.liveProduct),
    voice: {
      // Filled in by synthesis when a model runs; `not_found` otherwise, which
      // is the correct state for a deterministic-only profile.
      tone: unknown<string>(),
      positioningLine: unknown<string>(),
      recurringPhrases: deriveRecurringPhrases(input.liveProduct),
    },
  };
}
