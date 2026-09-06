import type {
  LiveProductIntelligenceSnapshot,
  ProductSurfaceId,
} from "@/modules/live-product-intelligence/schema";
import type {
  AuthenticatedProductIntelligenceSnapshot,
  AuthenticatedSurfaceId,
} from "@/modules/authenticated-product-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "./schema";
import type { CapabilityNextStep } from "./human-view";

/**
 * Code says one thing, the live product says another (Sprint UI-3.6 §11).
 *
 * A disagreement between the two intelligence layers is one of the most
 * valuable things this product can notice, and it is worthless in the form the
 * two snapshots hold it:
 *
 *     repository: surface.pricing_page = true
 *     live:       surface.pricing      = false
 *
 * Said to the person who has to act: *your pricing exists in the product, but
 * visitors may not be able to find it.*
 *
 * ## Deliberately small
 *
 * Six comparisons, all deterministic, no model, no scoring, no new engine
 * (§11: "Do not build a large new inference engine in this sprint"). Each is a
 * direct comparison of two facts the snapshots already recorded.
 *
 * ## The third layer
 *
 * Four of the six compare code against the public site. Two compare the public
 * site against the **signed-in product**, which is where the monetization
 * question actually lives: a Deep Scan can see a billing surface that no
 * visitor is ever offered, and a public pricing page for a product whose
 * signed-in half has no way to pay. Neither is visible from code, because both
 * layers involved are runtime.
 *
 * They are kept separate from the repository comparisons rather than folded in:
 * a Deep Scan is optional, so its absence must produce silence and never an
 * absence-shaped finding.
 *
 * ## When it says nothing
 *
 * Silence is the default, and two guards produce it:
 *
 *  - **A live check that saw nothing** cannot contradict anything. A site
 *    behind Cloudflare, or one that failed to load, reports every surface as
 *    undetected — which would fabricate a contradiction for every capability
 *    the repository has.
 *  - **A repository whose routes were not readable** has no page surfaces to
 *    compare. For frameworks that declare routes in code the analyzer returns
 *    none, so "no pricing page in the code" means "not looked at".
 */

export type IntelligenceCrossCheck = {
  id: string;
  /** The conclusion, as a business fact rather than two booleans. */
  title: string;
  /** What each layer actually saw. */
  detail: string;
  nextStep: CapabilityNextStep | null;
};

const CHECK_LIVE: CapabilityNextStep = { label: "Check the live product", target: "live-product" };
const NEXT_MOVES: CapabilityNextStep = { label: "Review next moves", target: "next-moves" };

function liveDetected(live: LiveProductIntelligenceSnapshot, id: ProductSurfaceId): boolean {
  return live.productSurfaces.some((surface) => surface.id === id && surface.detected);
}

function authDetected(
  authenticated: AuthenticatedProductIntelligenceSnapshot,
  id: AuthenticatedSurfaceId,
): boolean {
  return authenticated.productSurfaces.some((surface) => surface.id === id && surface.detected);
}

/**
 * Whether a comparison happened at all, and what it found.
 *
 * `buildIntelligenceCrossChecks` returns an empty array for two situations a
 * reader cannot tell apart: nothing was compared, and everything compared
 * agreed. On screen those are opposite statements. "Your code and your live
 * product agree" is a finding; saying it because no live scan has ever run
 * would be the invented reassurance rule 44 exists to prevent.
 *
 * So the guards report themselves. `compared: false` means silence is the only
 * honest output.
 */
export type IntelligenceCrossCheckResult =
  | { compared: false; reason: "no_live_scan" | "live_scan_detected_nothing"; checks: [] }
  | { compared: true; checks: IntelligenceCrossCheck[] };

export function crossCheckIntelligence(
  repository: RepositoryIntelligenceSnapshot,
  live: LiveProductIntelligenceSnapshot | null,
  authenticated: AuthenticatedProductIntelligenceSnapshot | null = null,
): IntelligenceCrossCheckResult {
  if (!live) return { compared: false, reason: "no_live_scan", checks: [] };

  // A check that identified nothing at all is a failed check, not a product
  // with nothing in it. Comparing against it would invent findings.
  const liveSawSomething = live.productSurfaces.some((surface) => surface.detected);
  if (!liveSawSomething) {
    return { compared: false, reason: "live_scan_detected_nothing", checks: [] };
  }

  return { compared: true, checks: comparisons(repository, live, authenticated) };
}

/** The checks themselves, for callers that only weigh how many there are. */
export function buildIntelligenceCrossChecks(
  repository: RepositoryIntelligenceSnapshot,
  live: LiveProductIntelligenceSnapshot | null,
  authenticated: AuthenticatedProductIntelligenceSnapshot | null = null,
): IntelligenceCrossCheck[] {
  return crossCheckIntelligence(repository, live, authenticated).checks;
}

function comparisons(
  repository: RepositoryIntelligenceSnapshot,
  live: LiveProductIntelligenceSnapshot,
  authenticated: AuthenticatedProductIntelligenceSnapshot | null,
): IntelligenceCrossCheck[] {

  const repositoryDetected = (id: string) =>
    repository.businessSurfaces.some((surface) => surface.id === id && surface.detected);
  const routesKnown =
    repository.routes.mode === "app_router" || repository.routes.mode === "pages_router";

  const checks: IntelligenceCrossCheck[] = [];

  const livePricing = liveDetected(live, "pricing");
  const liveCheckout = liveDetected(live, "checkout_billing");
  const liveSignIn = liveDetected(live, "login") || liveDetected(live, "signup");

  /*
   * A contradiction says one of two inputs is wrong. It does not say which.
   *
   * These checks read "the code has pricing, the live product does not" as a
   * fact about the *business*, and mint it at the highest evidence priority —
   * so a detector that missed a pricing surface becomes the most heavily
   * weighted finding in the audit. That is exactly what happened to Vibe
   * Business's own audit: an anchor-section pricing page was not classified,
   * `payments-not-reachable` fired, and the founder was told twice that
   * nothing on their site leads to paying, while the page displayed three
   * prices.
   *
   * `observedPricePoints` is the disproof, and it comes from the same
   * snapshot. When Vibe read prices off the live product, "no pricing is
   * reachable" is not a finding — it is a disagreement between two of Vibe's
   * own readings, and the honest response is to stay quiet rather than to
   * accuse the business. `reconcilePricingConfidence` already lowers the
   * surface signal's confidence for this case; this stops the contradiction
   * being minted from the same doubtful input one layer up.
   */
  const livePricesObserved =
    (live.pricing?.observedPricePoints.length ?? 0) > 0 ||
    (live.pricing?.declaredPricePoints.length ?? 0) > 0;

  if (routesKnown && repositoryDetected("pricing_page") && !livePricing && !livePricesObserved) {
    checks.push({
      id: "pricing-not-reachable",
      title: "Your pricing exists in the product, but visitors may not be able to find it.",
      detail:
        "The code has a pricing page. When Vibe visited your live product as a visitor would, it could not reach one.",
      nextStep: CHECK_LIVE,
    });
  }

  if (repositoryDetected("payments") && !livePricing && !liveCheckout && !livePricesObserved) {
    checks.push({
      id: "payments-not-reachable",
      title: "Your product can take payments, but nothing a visitor can reach leads to paying.",
      detail:
        "The code contains payment functionality. Visiting the live product, Vibe found no pricing or checkout page to get there from.",
      nextStep: NEXT_MOVES,
    });
  }

  if (repositoryDetected("authentication") && !liveSignIn) {
    checks.push({
      id: "accounts-not-reachable",
      title: "Your product has accounts, but visitors may not find a way in.",
      detail:
        "The code handles accounts and sign-in. Vibe could not reach a sign-in or sign-up page on the live product.",
      nextStep: CHECK_LIVE,
    });
  }

  // The reverse direction, and it is not an error: it usually means the public
  // site is built somewhere other than this repository.
  if (routesKnown && livePricing && !repositoryDetected("pricing_page")) {
    checks.push({
      id: "pricing-outside-repository",
      title: "Visitors can see a pricing page that isn't in this code.",
      detail:
        "Your live product has a pricing page and this repository does not. It may be built from a different project, which would mean Vibe cannot change it from here.",
      nextStep: null,
    });
  }

  checks.push(...crossCheckSignedInProduct(authenticated, { livePricing, liveCheckout }));

  return checks;
}

/**
 * The public site against the signed-in product.
 *
 * Both layers are runtime, so neither of these is visible from code — which is
 * why the four comparisons above cannot produce them however carefully they
 * read the repository. A product can contain a complete billing implementation
 * and still never offer it to a visitor, and the code alone reports that as
 * healthy.
 */
function crossCheckSignedInProduct(
  authenticated: AuthenticatedProductIntelligenceSnapshot | null,
  publicSurfaces: { livePricing: boolean; liveCheckout: boolean },
): IntelligenceCrossCheck[] {
  // A Deep Scan is optional. Its absence is not evidence of anything, and a
  // finding shaped like one would be fabricated — the same rule the live guard
  // above applies to a check that saw nothing.
  if (!authenticated) return [];

  // And a Deep Scan that reached nothing cannot contradict anything either: a
  // sign-in that failed reports every surface as undetected, which would turn
  // one broken credential into a finding about the founder's product.
  const reachedSomething = authenticated.productSurfaces.some((surface) => surface.detected);
  if (!reachedSomething) return [];

  const checks: IntelligenceCrossCheck[] = [];
  const { livePricing, liveCheckout } = publicSurfaces;

  if (authDetected(authenticated, "billing") && !livePricing && !liveCheckout) {
    checks.push({
      id: "billing-not-offered-publicly",
      title: "Your product can be paid for, but nothing public says so.",
      detail:
        "Signed in, Vibe found a billing area. Visiting your live product as a visitor would, it found no pricing and no checkout — so someone who wants to pay has no way to discover that they can.",
      nextStep: NEXT_MOVES,
    });
  }

  if (livePricing && !authDetected(authenticated, "billing")) {
    checks.push({
      id: "pricing-without-billing",
      title: "Visitors are shown pricing your signed-in product cannot act on.",
      detail:
        "Your live product has a pricing page. Signed in, Vibe found no billing area — so a visitor who decides to pay may arrive somewhere that cannot take the payment.",
      nextStep: CHECK_LIVE,
    });
  }

  return checks;
}
