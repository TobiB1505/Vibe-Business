import { AUTHENTICATED_SURFACE_LABELS } from "@/modules/authenticated-product-intelligence/schema";
import type { AuthenticatedSurfaceId } from "@/modules/authenticated-product-intelligence/schema";
import { PRODUCT_SURFACE_LABELS, SEO_LABELS } from "@/modules/live-product-intelligence/human-view";
import type { ProductSurfaceId, SeoSignalId } from "@/modules/live-product-intelligence/schema";
import {
  CAPABILITY_LABELS,
  JOURNEY_STAGE_LABELS,
} from "@/modules/product-understanding/schema";
import type {
  BusinessSignalId,
  CapabilityId,
  JourneyStageId,
} from "@/modules/product-understanding/schema";
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
export const EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  repo: "Your code",
  live: "Your live site",
  business: "What you told Vibe",
  intent: "Your answers",
  auth: "Your signed-in product",
  profile: "What Vibe understood",
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
  "live.conversion.primary_cta": "The main button on your live site",
  "live.conversion.pricing_cta": "A link to pricing on your live site",
  "live.conversion.signup_cta": "A way to sign up on your live site",
  "live.conversion.contact_cta": "A way to get in touch on your live site",
  "live.crawl.pages_inspected": "How many pages Vibe opened",
  "live.access.protected_surface": "A part of your site that needs signing in",
  "live.analysis.completeness": "How much of your public site Vibe could read",

  "auth.analysis.completeness": "How much of your signed-in product Vibe could read",
  "auth.area.reached": "A part of your signed-in product Vibe reached",
  "auth.area.not_reached": "A part of your signed-in product Vibe could not reach",
  "auth.navigation.labels": "The menu inside your product",
  "auth.pages.inspected": "How many signed-in pages Vibe opened",
  "auth.surface.reachable_count": "How many parts of your product Vibe could reach",

  /*
   * `profile.*` and `intent.*` — Vibe's own understanding of the product, and
   * the founder's answers (UI-7 §2).
   *
   * These two prefixes produced all three examples the audit quoted — "Signal
   * pricing surface", "Journey checkout not found", "Payments none" — and the
   * first pass of this file did not know they existed. `map-view.ts` did: it
   * carries its own prefix table listing all six, which is how the caption
   * under a citation said "from what Vibe understood" while the citation
   * itself said "Signal pricing surface".
   */
  "profile.completeness": "How much Vibe could work out about your product",
  "profile.identity.name": "What your product is called",
  "profile.identity.category": "What kind of product this is",
  "profile.identity.description": "What your product does",
  "profile.identity.promise": "What your product promises",
  "profile.identity.purpose": "What your product is for",
  "profile.identity.understanding": "Vibe's overall read of your product",
  "profile.identity.audience": "Who Vibe thinks this is for",
  "profile.audience.primary": "Who your product is mainly for",
  "profile.audience.user_type": "The kind of person who uses it",
  "profile.audience.problem": "The problem it solves for them",
  "profile.audience.use_case": "What they use it for",

  "intent.primary_goal": "The goal you gave Vibe",
  "intent.stage": "The stage you said you are at",
  "intent.how_it_earns": "How you said your product earns",
  "intent.monetization_model": "How you said you make money",

  // The four answers the founder gave Vibe themselves. Said as "you said", so
  // a citation of their own words never reads as something Vibe discovered.
  "business.primary_goal": "The goal you gave Vibe",
  "business.stage": "The stage you said you are at",
  "business.target_customer": "Who you said this is for",
  "business.monetization_model": "How you said you make money",
  "business.product_summary": "Your own description of the product",
};

/**
 * The eight business signals, said as signs rather than findings.
 *
 * A `BusinessSignal` is "a statement of fact, phrased with its own
 * uncertainty" (CORE-1 §42) — *"subscription pricing appears to exist"*, never
 * *"monetisation is weak"*. The labels keep that: each names a thing Vibe saw
 * a sign of, and none of them says whether it is good.
 */
const BUSINESS_SIGNAL_DETAILS: Record<BusinessSignalId, string> = {
  pricing_surface: "A sign of pricing in your product",
  payment_capability: "A sign that you can take payments",
  subscription_capability: "A sign of recurring payments",
  analytics: "A sign that something is being measured",
  conversion_path: "A sign of a path from visitor to customer",
  acquisition_surface: "A sign of a way people find you",
  retention_capability: "A sign of a reason to come back",
  account_system: "A sign that people can have accounts",
};

/**
 * The two ways an id says "this was looked for and not there".
 *
 * Three dialects, because three places mint absence and none agreed:
 * `_not_observed` is the **authenticated** vocabulary (`evidence-v2.ts`'s
 * `auth.surface.*`, and only that — the claim this comment used to make, that
 * it was also the repository vocabulary, was false; no minter has ever emitted
 * `repo.surface.*_not_observed`). `_missing` is the live-SEO vocabulary
 * (`buildLiveEvidence`, the one place polarity was put in the id). `_not_found`
 * and `.not_found` are the product-understanding ones, which spell the same
 * idea with a dot and an underscore in different builders.
 *
 * Recognising only the first two is why `profile.journey.checkout_not_found`
 * reached the screen as "Journey checkout not found" — the id fell out the
 * bottom with its suffix still attached, which is also why it read as prose
 * and nobody noticed for a sprint. `live.seo.*_missing` was falling out the
 * same way until this list learned it.
 */
const ABSENCE_SUFFIXES = ["_not_observed", "_not_found", ".not_found", "_missing"] as const;

function splitAbsence(rest: string): { observed: boolean; body: string } {
  for (const suffix of ABSENCE_SUFFIXES) {
    if (rest.endsWith(suffix)) return { observed: false, body: rest.slice(0, -suffix.length) };
  }
  return { observed: true, body: rest };
}

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

function isSeoSignal(value: string): value is SeoSignalId {
  return Object.hasOwn(SEO_LABELS, value);
}

function isJourneyStage(value: string): value is JourneyStageId {
  return Object.hasOwn(JOURNEY_STAGE_LABELS, value);
}

function isCapability(value: string): value is CapabilityId {
  return Object.hasOwn(CAPABILITY_LABELS, value);
}

function isBusinessSignal(value: string): value is BusinessSignalId {
  return Object.hasOwn(BUSINESS_SIGNAL_DETAILS, value);
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
      // Deliberately does not say "in your code". `buildRepositoryEvidence`
      // mints `repo.surface.<id>` for a surface it found *and* for one it
      // looked for and did not find — the polarity is only in the pack's
      // label, which this function cannot see (it resolves from the id alone,
      // by design, so a stored citation stays readable). Asserting presence
      // therefore inverted the meaning outright: a repository with no payments
      // surface produced the id, and the founder was shown "Payments, in your
      // code" as a `curated` fact. Naming the check rather than its outcome is
      // the only honest sentence available from a polarity-free id.
      if (isRepoSurface(id)) return curated(source, `${BUSINESS_SURFACE_LABELS[id]}, checked in your code`);
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

  if (prefix === "profile") {
    if (body.startsWith("journey.")) {
      const stage = body.slice("journey.".length);
      if (isJourneyStage(stage))
        return curated(source, `${JOURNEY_STAGE_LABELS[stage]} — a step in using your product`);
    }
    if (body.startsWith("capability.")) {
      const id = body.slice("capability.".length);
      if (isCapability(id)) return curated(source, `${CAPABILITY_LABELS[id]}, in your product`);
    }
    if (body.startsWith("signal.")) {
      const id = body.slice("signal.".length);
      if (isBusinessSignal(id)) return curated(source, BUSINESS_SIGNAL_DETAILS[id]);
    }
    if (body.startsWith("technical."))
      return curated(source, `${humanize(body.slice("technical.".length))}, in your stack`);
  }

  if (prefix === "live") {
    if (body.startsWith("surface.")) {
      const id = body.slice("surface.".length);
      // Same polarity-free id as `repo.surface.*` above, same inversion, same
      // reason for naming the check instead of its outcome.
      if (isLiveSurface(id))
        return curated(source, `${PRODUCT_SURFACE_LABELS[id]}, checked on your live site`);
    }

    /*
     * The one live family whose polarity really is in the id.
     *
     * `buildLiveEvidence` mints `live.seo.<signal>` only when the signal is
     * present and `live.seo.<signal>_missing` only when it is absent, so —
     * unlike the surfaces above — a bare positive reading is honest here and
     * the caller's "— not observed" suffix lands on the right half.
     *
     * The words come from `SEO_LABELS`, which the live module already wrote for
     * exactly this audience. Until now nothing consulted it from here, so a
     * founder opening "Why?" on a technical-SEO Move read `Seo sitemap` and
     * `Seo canonical — not observed`: the id with its punctuation removed,
     * capitalised, presented as prose. "Seo" is not a word.
     */
    if (body.startsWith("seo.")) {
      const id = body.slice("seo.".length);
      if (isSeoSignal(id)) return curated(source, SEO_LABELS[id]);
    }
  }

  return null;
}

export function describeEvidenceId(id: string): EvidenceIdDescription {
  const separator = id.indexOf(".");
  const prefix = separator === -1 ? "" : id.slice(0, separator);
  const rest = separator === -1 ? id : id.slice(separator + 1);
  const source = EVIDENCE_SOURCE_LABELS[prefix] ?? "Evidence";

  const literal = LITERAL_DETAILS[id];
  if (literal !== undefined) return curated(source, literal);

  // Absence is stated as absence. Rendering an absence id as if it were a
  // detection would invert the meaning of the citation.
  const { observed, body } = splitAbsence(rest);

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
