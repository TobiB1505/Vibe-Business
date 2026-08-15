import type {
  LiveProductIntelligenceSnapshot,
  ProductSurfaceId,
} from "@/modules/live-product-intelligence/schema";
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
 * Four comparisons, all deterministic, no model, no scoring, no new engine
 * (§11: "Do not build a large new inference engine in this sprint"). Each is a
 * direct comparison of two facts both snapshots already recorded.
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

export function buildIntelligenceCrossChecks(
  repository: RepositoryIntelligenceSnapshot,
  live: LiveProductIntelligenceSnapshot | null,
): IntelligenceCrossCheck[] {
  if (!live) return [];

  // A check that identified nothing at all is a failed check, not a product
  // with nothing in it. Comparing against it would invent findings.
  const liveSawSomething = live.productSurfaces.some((surface) => surface.detected);
  if (!liveSawSomething) return [];

  const repositoryDetected = (id: string) =>
    repository.businessSurfaces.some((surface) => surface.id === id && surface.detected);
  const routesKnown =
    repository.routes.mode === "app_router" || repository.routes.mode === "pages_router";

  const checks: IntelligenceCrossCheck[] = [];

  const livePricing = liveDetected(live, "pricing");
  const liveCheckout = liveDetected(live, "checkout_billing");
  const liveSignIn = liveDetected(live, "login") || liveDetected(live, "signup");

  if (routesKnown && repositoryDetected("pricing_page") && !livePricing) {
    checks.push({
      id: "pricing-not-reachable",
      title: "Your pricing exists in the product, but visitors may not be able to find it.",
      detail:
        "The code has a pricing page. When Vibe visited your live product as a visitor would, it could not reach one.",
      nextStep: CHECK_LIVE,
    });
  }

  if (repositoryDetected("payments") && !livePricing && !liveCheckout) {
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

  return checks;
}
