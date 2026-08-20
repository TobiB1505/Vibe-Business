import { describe, expect, it } from "vitest";
import { describeEvidenceId } from "./evidence-labels";
import { AUTHENTICATED_SURFACE_LABELS } from "@/modules/authenticated-product-intelligence/schema";
import { PRODUCT_SURFACE_LABELS } from "@/modules/live-product-intelligence/human-view";
import { BUSINESS_SURFACE_LABELS } from "@/modules/repository-intelligence/schema";

/**
 * "Why?" resolution (Sprint 6 §12, UI-7 §2).
 *
 * Two rules, and the second is the one this sprint added.
 *
 * **A citation must never read as the opposite of what it says.**
 * `auth.surface.billing_not_observed` states that billing was not seen, and
 * rendering it as "Billing detected" would turn a limitation into a finding.
 *
 * **A citation the product still produces must never reach the screen as a
 * machine string.** The evidence layer is where a person goes to check whether
 * to believe the headline; answering "Surface payments" there spends the trust
 * the headline just earned. The fallback still exists for ids no producer
 * emits any more — it is simply no longer reachable by accident.
 */

describe("polarity survives", () => {
  it("resolves an authenticated surface to its product name", () => {
    expect(describeEvidenceId("auth.surface.dashboard")).toEqual({
      source: "Your signed-in product",
      detail: "Dashboard detected",
      certainty: "curated",
    });
  });

  it("preserves the polarity of an unobserved surface", () => {
    expect(describeEvidenceId("auth.surface.billing_not_observed")).toEqual({
      source: "Your signed-in product",
      detail: "Billing not observed",
      certainty: "curated",
    });
  });

  it("carries absence through a family label too", () => {
    expect(describeEvidenceId("repo.surface.payments_not_observed").detail).toBe(
      "Payments, in your code — not observed",
    );
  });

  it("describes an action control as present, never as working", () => {
    expect(describeEvidenceId("auth.action.run_business_audit").detail).toBe(
      "Action control present: Run business audit",
    );
  });

  it("calls an integration a sign, never a working service", () => {
    // The pack itself is explicit that a detected integration is not a claim
    // the service is live or configured (Sprint 2 §13).
    expect(describeEvidenceId("repo.integration.stripe").detail).toBe(
      "A sign of Stripe in your code",
    );
  });
});

describe("the source is named from where the founder thinks it came from", () => {
  it.each([
    ["repo.integration.github", "Your code"],
    ["live.surface.pricing", "Your public site"],
    ["business.primary_goal", "What you told Vibe"],
    ["auth.surface.dashboard", "Your signed-in product"],
  ])("%s → %s", (id, source) => {
    expect(describeEvidenceId(id).source).toBe(source);
  });
});

/**
 * Every id the evidence builders can emit.
 *
 * Gathered by reading `evidence.ts` and `evidence-v2.ts` rather than sampled:
 * twenty-five literal ids and eight templated families is the entire surface,
 * which is small enough to hold in one list and therefore small enough to hold
 * the product to.
 */
const LITERAL_IDS = [
  "repo.analysis.completeness",
  "repo.routes.pages",
  "repo.routes.detection_limited",
  "repo.structure.monorepo",
  "live.site.origin",
  "live.site.title",
  "live.site.description",
  "live.conversion.primary_cta",
  "live.conversion.pricing_cta",
  "live.conversion.signup_cta",
  "live.conversion.contact_cta",
  "live.crawl.pages_inspected",
  "live.access.protected_surface",
  "live.analysis.completeness",
  "auth.analysis.completeness",
  "auth.area.reached",
  "auth.area.not_reached",
  "auth.navigation.labels",
  "auth.pages.inspected",
  "auth.surface.reachable_count",
  "business.primary_goal",
  "business.stage",
  "business.target_customer",
  "business.monetization_model",
  "business.product_summary",
] as const;

const FAMILY_IDS = [
  ...Object.keys(BUSINESS_SURFACE_LABELS).map((id) => `repo.surface.${id}`),
  ...Object.keys(PRODUCT_SURFACE_LABELS).map((id) => `live.surface.${id}`),
  ...Object.keys(AUTHENTICATED_SURFACE_LABELS).flatMap((id) => [
    `auth.surface.${id}`,
    `auth.surface.${id}_not_observed`,
  ]),
  "repo.framework.nextjs",
  "repo.language.typescript",
  "repo.integration.supabase",
  "auth.action.open_settings",
];

describe("nothing the product still emits falls through to the fallback", () => {
  it.each([...LITERAL_IDS, ...FAMILY_IDS])("%s is curated", (id) => {
    expect(describeEvidenceId(id).certainty).toBe("curated");
  });

  it("says something a person could read, not an identifier", () => {
    // A real filename is not a leaked identifier: `robots.txt` is what the
    // thing is called, and spelling it "Robots txt" to satisfy a regex would
    // make the label worse. Underscores have no such excuse — nothing a person
    // reads contains one, so every occurrence is an id showing through.
    const FILENAME = /\b[a-z-]+\.(?:txt|xml|json|js|ts|tsx|md)\b/g;

    for (const id of [...LITERAL_IDS, ...FAMILY_IDS]) {
      const { detail } = describeEvidenceId(id);
      const prose = detail.replace(FILENAME, "");

      expect(prose, id).not.toMatch(/_/);
      expect(prose, id).not.toMatch(/[a-z]\.[a-z]/);
      expect(detail.split(" ").length, id).toBeGreaterThan(1);
    }
  });
});

describe("the fallback still exists, for citations nothing produces any more", () => {
  it("degrades readably rather than guessing", () => {
    // A stored audit from before a family was renamed still has to render.
    expect(describeEvidenceId("auth.something.new_thing")).toEqual({
      source: "Your signed-in product",
      detail: "Something new thing",
      certainty: "derived",
    });
    expect(describeEvidenceId("mystery")).toEqual({
      source: "Evidence",
      detail: "Mystery",
      certainty: "derived",
    });
  });

  it("marks itself, so falling through is visible rather than quiet", () => {
    expect(describeEvidenceId("live.brand.new_family").certainty).toBe("derived");
  });
});
