import { describeCompletenessReasons } from "./budgets";
import type {
  LiveProductIntelligenceSnapshot,
  ProductSurfaceId,
  SeoSignalId,
} from "./schema";

/**
 * The human-facing view of a live product check (Sprint UI-3.5).
 *
 * ## What this is
 *
 * A **deterministic** translation from the scanner's own vocabulary into the
 * customer's. No model, no generation, no paraphrasing at render time — every
 * sentence below is a lookup or a small conditional over facts the snapshot
 * already contains.
 *
 * The product's audience built something with an AI tool and now wants a
 * business around it. `canonical: absent` is a true statement and a useless
 * one to them. "Search engines don't know which version of a page is the real
 * one" is the same fact, said to the person who has to decide something.
 *
 * ## What it must never do
 *
 * - **Soften a gap.** A missing pricing path is reported as missing. Softening
 *   is the failure mode this whole product is built against — "human-friendly"
 *   here means understandable, never reassuring.
 * - **Invent a finding.** Every field is derived from the snapshot. Nothing is
 *   inferred, estimated, or filled in from a default.
 * - **Lose the technical value.** The raw signals stay on the snapshot and are
 *   rendered underneath by `TechnicalDetails`. This reorders; it does not
 *   redact.
 */

/** How a section reads at a glance. Never carried by colour alone in the UI. */
export type FindingTone = "good" | "attention" | "neutral";

export type HumanFinding = {
  id: string;
  /** The conclusion, in plain language. Always a full sentence. */
  title: string;
  /** Why it matters for the business. Omitted when there is nothing to add. */
  whyItMatters?: string;
  tone: FindingTone;
  /** Concrete, readable observations — the middle disclosure layer. */
  found: string[];
  missing: string[];
};

export type LiveProductHumanView = {
  /** One sentence answering "is my product working and reachable". */
  headline: string;
  subhead: string;
  tone: FindingTone;
  findings: HumanFinding[];
  /** Pages the check actually looked at, by their readable names. */
  pagesChecked: string[];
  /** Exact values for the bottom layer. Never shown by default. */
  technical: { key: string; value: string | number | boolean | null }[];
  /** Present only when the check could not finish. Stated, never hidden. */
  incompleteReason: string | null;
};

/** Readable names for the pages the scanner looks for. */
/**
 * What each public surface is called when a person reads it (UI-7 §2).
 *
 * Deliberately different from `classifier.ts`'s `SURFACE_NAMES`, and the
 * difference is the audience: that table names surfaces for the evidence pack
 * a model reads ("Dashboard / app"), this one names them for a founder ("The
 * product itself"). Two tables, two readers — which is why this one is now
 * exported and the evidence layer reads it instead of the id.
 */
export const PRODUCT_SURFACE_LABELS: Record<ProductSurfaceId, string> = {
  homepage: "Homepage",
  pricing: "Pricing page",
  login: "Sign-in page",
  signup: "Sign-up page",
  dashboard_app: "The product itself",
  checkout_billing: "Checkout or billing",
  onboarding: "Onboarding",
  contact: "Contact page",
  docs_help: "Help or documentation",
  blog_content: "Blog or articles",
  privacy: "Privacy policy",
  terms: "Terms",
};

/**
 * Search signals in the words of someone who has to care about the outcome
 * rather than the mechanism.
 *
 * Exported for the same reason `PRODUCT_SURFACE_LABELS` is: `evidence-labels.ts`
 * has to render a `live.seo.*` citation, and a second table written there would
 * be a second set of words for the same ten signals.
 */
export const SEO_LABELS: Record<SeoSignalId, string> = {
  title: "A page title",
  meta_description: "A description for search results",
  canonical: "Which version of a page is the real one",
  language: "The page's language",
  viewport: "Mobile support",
  open_graph: "A preview when shared on social media",
  structured_data: "Extra context for search engines",
  robots_txt: "Instructions for search engines",
  sitemap: "A map of your pages",
  robots_meta: "Per-page search engine instructions",
};

export function buildLiveProductHumanView(
  snapshot: LiveProductIntelligenceSnapshot,
): LiveProductHumanView {
  const detected = snapshot.productSurfaces.filter((surface) => surface.detected);
  const undetected = snapshot.productSurfaces.filter((surface) => !surface.detected);
  const detectedIds = new Set(detected.map((surface) => surface.id));

  const { conversionSignals: conversion } = snapshot;

  /**
   * "Can someone become a paying customer" — the question the product exists
   * to ask. A signup path with no route to paying is the single most common
   * gap in this audience's products, so it is named explicitly rather than
   * left to be inferred from two booleans.
   */
  const canSignUp = conversion.signupCtaPresent || detectedIds.has("signup");
  const canPay =
    conversion.pricingCtaPresent || detectedIds.has("pricing") || detectedIds.has("checkout_billing");

  const conversionFinding: HumanFinding = {
    id: "becoming-a-customer",
    title: canPay
      ? "Visitors can find their way to becoming a paying customer."
      : canSignUp
        ? "People can sign up, but the path to paying is unclear."
        : "There is no clear way for a visitor to act.",
    whyItMatters: canPay
      ? undefined
      : canSignUp
        ? "Interested visitors may sign up and never find out how to pay you."
        : "Visitors who are interested have nothing obvious to do next, so most will leave.",
    tone: canPay ? "good" : "attention",
    found: [
      conversion.primaryCta ? `A main action: “${conversion.primaryCta.label}”` : null,
      conversion.signupCtaPresent ? "A way to sign up" : null,
      conversion.pricingCtaPresent ? "A way to see pricing" : null,
      conversion.contactCtaPresent ? "A way to get in touch" : null,
      conversion.formCount > 0
        ? `${conversion.formCount} form${conversion.formCount === 1 ? "" : "s"} people can fill in`
        : null,
    ].filter((item): item is string => item !== null),
    missing: [
      conversion.signupCtaPresent ? null : "a way to sign up",
      conversion.pricingCtaPresent ? null : "a way to see pricing",
      conversion.contactCtaPresent ? null : "a way to get in touch",
    ].filter((item): item is string => item !== null),
  };

  const presentSeo = snapshot.seoSignals.filter((signal) => signal.present);
  const missingSeo = snapshot.seoSignals.filter((signal) => !signal.present);

  const searchFinding: HumanFinding = {
    id: "being-found",
    title:
      missingSeo.length === 0
        ? "Search engines have everything they need."
        : presentSeo.length >= missingSeo.length
          ? "The basics for being found are in place."
          : "Search engines are missing most of what they need.",
    whyItMatters:
      missingSeo.length === 0
        ? undefined
        : "Without these, people mostly have to already know your product exists to find it.",
    tone: missingSeo.length === 0 ? "good" : presentSeo.length >= missingSeo.length ? "neutral" : "attention",
    found: presentSeo.map((signal) => SEO_LABELS[signal.id] ?? signal.name),
    missing: missingSeo.map((signal) => SEO_LABELS[signal.id] ?? signal.name),
  };

  const surfaceFinding: HumanFinding = {
    id: "what-exists",
    title:
      detected.length === 0
        ? "Vibe could not find the pages customers would normally use."
        : `Vibe found ${detected.length} of the pages customers normally look for.`,
    whyItMatters:
      detected.length === 0
        ? "Either the site is not reachable the way a visitor would reach it, or it is built in a way this check cannot read."
        : undefined,
    tone: detected.length === 0 ? "attention" : "good",
    found: detected.map((surface) => PRODUCT_SURFACE_LABELS[surface.id] ?? surface.name),
    missing: undetected.map((surface) => PRODUCT_SURFACE_LABELS[surface.id] ?? surface.name),
  };

  const attentionCount = [conversionFinding, searchFinding, surfaceFinding].filter(
    (finding) => finding.tone === "attention",
  ).length;

  /**
   * The headline never says "everything looks great" while gaps exist. It
   * counts them — friendly is not the same as flattering.
   */
  const headline =
    detected.length === 0
      ? "Vibe could not read your product."
      : attentionCount === 0
        ? "Your product is online and the basics are in place."
        : `Your product is online. ${attentionCount} thing${attentionCount === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} attention.`;

  return {
    headline,
    subhead:
      detected.length === 0
        ? `Vibe checked ${snapshot.source.effectiveOrigin} and could not identify the pages a visitor would use.`
        : `Vibe looked at ${snapshot.crawl.pagesInspected} page${snapshot.crawl.pagesInspected === 1 ? "" : "s"} on ${snapshot.source.effectiveOrigin}, the way a visitor would.`,
    tone: detected.length === 0 ? "attention" : attentionCount === 0 ? "good" : "neutral",
    findings: [conversionFinding, searchFinding, surfaceFinding],
    pagesChecked: snapshot.pages.slice(0, 20).map((page) => page.path),
    technical: [
      { key: "origin", value: snapshot.source.effectiveOrigin },
      { key: "redirected", value: snapshot.source.redirected },
      { key: "pagesInspected", value: snapshot.crawl.pagesInspected },
      { key: "requests", value: snapshot.metrics.requestCount },
      { key: "bytesFetched", value: snapshot.metrics.bytesFetched },
      { key: "durationMs", value: snapshot.metrics.durationMs },
      { key: "completeness", value: snapshot.completeness.status },
      { key: "title", value: snapshot.siteMetadata.title },
      { key: "description", value: snapshot.siteMetadata.description },
      { key: "language", value: snapshot.siteMetadata.language },
      // Every raw signal keeps its own identifier and its own boolean, so the
      // exact scanner output is still readable here. Namespaced because the
      // signal ids collide with the metadata keys above — `title` is both a
      // page's title and a signal about whether one exists, and an unprefixed
      // list would silently show one where the reader expected the other.
      ...snapshot.seoSignals.map((signal) => ({
        key: `signal.${signal.id}`,
        value: signal.present,
      })),
      ...snapshot.productSurfaces.map((surface) => ({
        key: `surface.${surface.id}`,
        value: surface.detected,
      })),
    ],
    incompleteReason: describeIncompleteness(snapshot),
  };
}

/**
 * Why the results above may not be the whole picture.
 *
 * The client-rendered case gets its own sentence rather than joining the list,
 * because "some of the results may be incomplete" is far too mild for it: on a
 * page that builds itself in the browser, almost everything above is *unread*
 * rather than absent, and a founder told only that the check "did not finish
 * completely" would reasonably conclude their product has no calls to action.
 */
export function describeIncompleteness(snapshot: LiveProductIntelligenceSnapshot): string | null {
  if (snapshot.completeness.status === "complete") return null;

  const clientRendered = snapshot.readability?.clientRendered ?? 0;
  const others = snapshot.completeness.reasons.filter((reason) => reason !== "client_rendered");

  if (clientRendered === 0) {
    return `This check did not finish completely (${describeCompletenessReasons(snapshot.completeness.reasons)}), so some of the results above may be incomplete.`;
  }

  const pages = clientRendered === 1 ? "One page" : `${clientRendered} pages`;
  const verb = clientRendered === 1 ? "builds" : "build";
  const tail = others.length > 0 ? ` This check also stopped short: ${describeCompletenessReasons(others)}.` : "";

  return (
    `${pages} on your site ${verb} themselves in your visitor's browser. Vibe reads the page a server sends ` +
    `and does not run a browser, so for ${clientRendered === 1 ? "that page" : "those pages"} it saw an empty shell. ` +
    `Treat anything reported as missing above as "Vibe could not see it", not as "your product does not have it".${tail}`
  );
}
