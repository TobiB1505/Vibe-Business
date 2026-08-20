import { AUTHENTICATED_SURFACE_LABELS } from "@/modules/authenticated-product-intelligence/schema";
import type { AuthenticatedSurfaceId } from "@/modules/authenticated-product-intelligence/schema";
import { PRODUCT_SURFACE_LABELS } from "@/modules/live-product-intelligence/human-view";
import type { ProductSurfaceId } from "@/modules/live-product-intelligence/schema";
import { BUSINESS_SURFACE_LABELS } from "@/modules/repository-intelligence/schema";
import type { BusinessSurfaceId } from "@/modules/repository-intelligence/schema";

/**
 * Human-readable resolution of a cited evidence id (Sprint 6 §12, UI-7 §2).
 *
 * An audit stores the ids it cited, not the pack it was given, so this resolves
 * from the id alone — which works because evidence ids are deliberately
 * self-describing (`auth.surface.billing_not_observed` says both what and
 * which way round).
 *
 * It exists so "Why?" can answer in the product's language instead of showing
 * an internal identifier, and it never reaches for the snapshot: no page paths,
 * no headings, no JSON.
 *
 * ## What was wrong with the first version
 *
 * It recognised two families and sent everything else through `humanize()` —
 * which takes the dots out of an id and capitalises it. So opening "Why?"
 * showed "Signal pricing surface", "Surface payments", "Conversion primary
 * cta": the plumbing, rendered as prose, underneath a sentence written in a
 * founder's own words. The evidence layer is where a person goes when they
 * want to check whether to believe the headline, and it answered in the
 * schema.
 *
 * ## Where the words came from
 *
 * Almost none of them are new. `BUSINESS_SURFACE_LABELS`, the *human-view*
 * `PRODUCT_SURFACE_LABELS` and `AUTHENTICATED_SURFACE_LABELS` already existed,
 * written for exactly this reader — they were simply not reachable from here.
 * Two of the three had to be exported; that was the whole fix for the surface
 * families.
 *
 * ## The fallback is monitored, not removed
 *
 * `humanize()` stays, because a stored audit from six months ago may cite an
 * id no producer emits any more, and a readable rendering of it beats an empty
 * row. What changed is that falling through is now *visible*: every
 * description says whether it was `curated` or `derived`, and a test walks
 * every id the evidence builders can emit and requires all of them to be
 * curated. A new family reaching the screen as a machine string is a failing
 * test rather than a thing somebody notices in a screenshot.
 */

export type EvidenceIdDescription = {
  /** Which source the fact came from. */
  source: string;
  /** What the fact was about. */
  detail: string;
  /**
   * `curated` — resolved through a table written for a founder.
   * `derived` — the id itself, made readable. Correct for a citation the
   * product no longer produces; never correct for one it does.
   */
  certainty: "curated" | "derived";
};

/**
 * Named from where a founder thinks the fact came from, not from the module
 * that produced it. "Repository" and "Authenticated product" are Vibe's words
 * for these places; "your code" and "your signed-in product" are theirs.
 */
const SOURCE_LABELS: Record<string, string> = {
  repo: "Your code",
  live: "Your public site",
  business: "What you told Vibe",
  auth: "Your signed-in product",
};

/** Ids emitted exactly once, each naming one specific observation. */
const LITERAL_DETAILS: Record<string, string> = {
  "repo.analysis.completeness": "How much of your code Vibe could read",
  "repo.routes.pages": "The pages Vibe found in your code",
  "repo.routes.detection_limited": "Vibe could not list your pages from the code",
  "repo.structure.monorepo": "Your project holds more than one app",

  "live.site.origin": "The address Vibe looked at",
  "live.site.title": "Your homepage title",
  "live.site.description": "Your homepage description",
  "live.conversion.primary_cta": "The main button on your public site",
  "live.conversion.pricing_cta": "A link to pricing on your public site",
  "live.conversion.signup_cta": "A way to sign up on your public site",
  "live.conversion.contact_cta": "A way to get in touch on your public site",
  "live.crawl.pages_inspected": "How many pages Vibe opened",
  "live.access.protected_surface": "A part of your site that needs signing in",
  "live.analysis.completeness": "How much of your public site Vibe could read",

  "auth.analysis.completeness": "How much of your signed-in product Vibe could read",
  "auth.area.reached": "A part of your signed-in product Vibe reached",
  "auth.area.not_reached": "A part of your signed-in product Vibe could not reach",
  "auth.navigation.labels": "The menu inside your product",
  "auth.pages.inspected": "How many signed-in pages Vibe opened",
  "auth.surface.reachable_count": "How many parts of your product Vibe could reach",

  // The four answers the founder gave Vibe themselves. Said as "you said", so
  // a citation of their own words never reads as something Vibe discovered.
  "business.primary_goal": "The goal you gave Vibe",
  "business.stage": "The stage you said you are at",
  "business.target_customer": "Who you said this is for",
  "business.monetization_model": "How you said you make money",
  "business.product_summary": "Your own description of the product",
};

const NOT_OBSERVED_SUFFIX = "_not_observed";

/** The last resort: an id with its punctuation taken out. */
function humanize(value: string): string {
  const words = value.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isAuthSurface(value: string): value is AuthenticatedSurfaceId {
  return Object.hasOwn(AUTHENTICATED_SURFACE_LABELS, value);
}

function isRepoSurface(value: string): value is BusinessSurfaceId {
  return Object.hasOwn(BUSINESS_SURFACE_LABELS, value);
}

function isLiveSurface(value: string): value is ProductSurfaceId {
  return Object.hasOwn(PRODUCT_SURFACE_LABELS, value);
}

function curated(source: string, detail: string): EvidenceIdDescription {
  return { source, detail, certainty: "curated" };
}

/**
 * A family whose tail names *which* one, inside a sentence that says what kind
 * of thing it is. The sentence is curated even though the tail is not: a
 * reader who sees "A sign of Stripe in your code" knows what they are looking
 * at, which is the whole job.
 */
function describeFamily(prefix: string, body: string, source: string): EvidenceIdDescription | null {
  if (prefix === "repo") {
    if (body.startsWith("surface.")) {
      const id = body.slice("surface.".length);
      if (isRepoSurface(id)) return curated(source, `${BUSINESS_SURFACE_LABELS[id]}, in your code`);
    }
    if (body.startsWith("framework."))
      return curated(source, `Built with ${humanize(body.slice("framework.".length))}`);
    if (body.startsWith("language."))
      return curated(source, `Written in ${humanize(body.slice("language.".length))}`);
    // "Signal", not "configured": the pack is explicit that a detected
    // integration is not a claim that the service works (Sprint 2 §13).
    if (body.startsWith("integration."))
      return curated(source, `A sign of ${humanize(body.slice("integration.".length))} in your code`);
  }

  if (prefix === "live" && body.startsWith("surface.")) {
    const id = body.slice("surface.".length);
    if (isLiveSurface(id)) return curated(source, `${PRODUCT_SURFACE_LABELS[id]}, on your public site`);
  }

  return null;
}

export function describeEvidenceId(id: string): EvidenceIdDescription {
  const separator = id.indexOf(".");
  const prefix = separator === -1 ? "" : id.slice(0, separator);
  const rest = separator === -1 ? id : id.slice(separator + 1);
  const source = SOURCE_LABELS[prefix] ?? "Evidence";

  const literal = LITERAL_DETAILS[id];
  if (literal !== undefined) return curated(source, literal);

  // Absence is stated as absence. Rendering `..._not_observed` as if it were a
  // detection would invert the meaning of the citation.
  const observed = !rest.endsWith(NOT_OBSERVED_SUFFIX);
  const body = observed ? rest : rest.slice(0, -NOT_OBSERVED_SUFFIX.length);

  if (prefix === "auth") {
    const surface = body.startsWith("surface.") ? body.slice("surface.".length) : null;
    if (surface !== null && isAuthSurface(surface)) {
      return curated(
        source,
        observed
          ? `${AUTHENTICATED_SURFACE_LABELS[surface]} detected`
          : `${AUTHENTICATED_SURFACE_LABELS[surface]} not observed`,
      );
    }

    if (body.startsWith("action.")) {
      // Presence only, and the wording says so — a control on a page is not a
      // working feature (Sprint 6 §4).
      return curated(source, `Action control present: ${humanize(body.slice("action.".length))}`);
    }

    if (body.startsWith("signal."))
      return curated(source, `Seen inside your product: ${humanize(body.slice("signal.".length))}`);
  }

  const family = describeFamily(prefix, body, source);
  if (family) {
    return observed
      ? family
      : { ...family, detail: `${family.detail} — not observed` };
  }

  return {
    source,
    detail: observed ? humanize(body) : `${humanize(body)} — not observed`,
    certainty: "derived",
  };
}
