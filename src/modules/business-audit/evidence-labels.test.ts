import { describe, expect, it } from "vitest";
import { describeEvidenceId } from "./evidence-labels";
import { buildLiveEvidence, buildRepositoryEvidence } from "./evidence";
import { fakeLiveSnapshot, fakeRepositorySnapshot } from "./test-support";
import { AUTHENTICATED_SURFACE_LABELS } from "@/modules/authenticated-product-intelligence/schema";
import { PRODUCT_SURFACE_LABELS, SEO_LABELS } from "@/modules/live-product-intelligence/human-view";
import { BUSINESS_SURFACE_LABELS } from "@/modules/repository-intelligence/schema";
import {
  BUSINESS_SIGNAL_IDS,
  CAPABILITY_LABELS,
  JOURNEY_STAGE_LABELS,
} from "@/modules/product-understanding/schema";
import { evidenceSource } from "./map-view";
import { EVIDENCE_SOURCE_LABELS } from "./evidence-labels";

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

  /**
   * Uses an id a minter really emits.
   *
   * This asserted `repo.surface.payments_not_observed` — a string nothing in
   * the product has ever produced. The repository namespace has no absence
   * suffix of its own: `buildRepositoryEvidence` mints the same
   * `repo.surface.payments` whether it found the surface or not, which is the
   * ambiguity that made "Payments, in your code" render over a pack saying
   * "Repository surface not detected". `product-understanding/evidence.ts` is
   * the one that spells repository absence, and it spells it `.not_found`.
   */
  it("carries absence through a family label too", () => {
    expect(describeEvidenceId("repo.surface.robots.not_found").detail).toBe(
      "robots.txt, checked in your code — not observed",
    );
  });

  /**
   * The inversion itself, pinned.
   *
   * A polarity-free id must not be rendered as a claim of presence. The pack
   * that mints this id for an undetected surface labels it "Repository surface
   * not detected: Payments"; a screen that turned that into "Payments, in your
   * code" told the founder the opposite of what was found, and marked it
   * `curated` while doing so.
   */
  it("does not claim presence from an id that does not encode it", () => {
    expect(describeEvidenceId("repo.surface.payments").detail).toBe("Payments, checked in your code");
    expect(describeEvidenceId("live.surface.homepage").detail).toBe(
      "Homepage, checked on your live site",
    );
  });

  /**
   * The one live family whose polarity is genuinely in the id.
   *
   * `buildLiveEvidence` mints `live.seo.<signal>` only when present and
   * `live.seo.<signal>_missing` only when absent, so a bare positive reading is
   * honest here — unlike `live.surface.*` above, where the same id is minted
   * either way and a positive reading inverts the finding.
   *
   * The words come from `SEO_LABELS`, which `live-product-intelligence` already
   * wrote for this audience. Nothing consulted it from here until now, so the
   * "Why?" disclosure on a technical-SEO Move read `Seo sitemap` — the id with
   * its punctuation removed and a capital on the front.
   */
  it("gives an SEO signal the words the live module already wrote for it", () => {
    expect(describeEvidenceId("live.seo.sitemap").detail).toBe("A map of your pages");
    expect(describeEvidenceId("live.seo.robots_txt_missing").detail).toBe(
      "Instructions for search engines — not observed",
    );
    expect(describeEvidenceId("live.seo.title").certainty).toBe("curated");
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
    ["live.surface.pricing", "Your live site"],
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
  "profile.completeness",
  "profile.identity.name",
  "profile.identity.category",
  "profile.identity.description",
  "profile.identity.promise",
  "profile.identity.purpose",
  "profile.identity.understanding",
  "profile.identity.audience",
  "profile.audience.primary",
  "profile.audience.user_type",
  "profile.audience.problem",
  "profile.audience.use_case",
  "intent.primary_goal",
  "intent.stage",
  "intent.how_it_earns",
  "intent.monetization_model",
] as const;

const FAMILY_IDS = [
  ...Object.keys(BUSINESS_SURFACE_LABELS).map((id) => `repo.surface.${id}`),
  ...Object.keys(PRODUCT_SURFACE_LABELS).map((id) => `live.surface.${id}`),
  ...Object.keys(SEO_LABELS).flatMap((id) => [`live.seo.${id}`, `live.seo.${id}_missing`]),
  ...Object.keys(AUTHENTICATED_SURFACE_LABELS).flatMap((id) => [
    `auth.surface.${id}`,
    `auth.surface.${id}_not_observed`,
  ]),
  ...Object.keys(JOURNEY_STAGE_LABELS).flatMap((id) => [
    `profile.journey.${id}`,
    `profile.journey.${id}_not_found`,
  ]),
  ...Object.keys(CAPABILITY_LABELS).map((id) => `profile.capability.${id}`),
  "repo.framework.nextjs",
  "repo.language.typescript",
  "repo.integration.supabase",
  "auth.action.open_settings",
  ...BUSINESS_SIGNAL_IDS.map((id) => `profile.signal.${id}`),
  "profile.technical.payment_provider",
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

describe("both prefix tables know the same sources", () => {
  /**
   * There are two, and they disagreed (UI-7 §2).
   *
   * `map-view.ts` renders the caption under a citation ("from what Vibe
   * understood"); this module renders the citation itself. The caption table
   * knew all six prefixes and the label table knew four — which is exactly how
   * a row could read "from what Vibe understood · Signal pricing surface",
   * with the caption right and the line above it a raw id.
   *
   * They stay two tables because they are two sentences in two positions. What
   * they may not do again is cover different sets of prefixes.
   */
  it.each(Object.keys(EVIDENCE_SOURCE_LABELS))("%s is known to the caption too", (prefix) => {
    expect(evidenceSource(`${prefix}.anything`)).not.toBeNull();
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

/**
 * The guard the list above cannot be.
 *
 * `FAMILY_IDS` is derived from the same label tables `describeEvidenceId`
 * resolves against, so it is circular: it proves every id built *from* the
 * table is *in* the table. An id a builder mints and the table has never heard
 * of falls straight through to `derived` prose, and this suite passes.
 *
 * These harvest from the real builders instead. That is what turns "the label
 * tables are self-consistent" into "the screen can read what the product
 * actually cites".
 */
describe("every id the builders actually mint is readable", () => {
  const minted = [
    ...buildRepositoryEvidence(fakeRepositorySnapshot()),
    ...buildLiveEvidence(fakeLiveSnapshot()),
  ].map((entry) => entry.id);

  it("mints something to check", () => {
    // Guards the guard: an empty harvest would make every assertion below
    // vacuous and green.
    expect(minted.length).toBeGreaterThan(10);
  });

  it.each(minted)("%s is readable", (id) => {
    const described = describeEvidenceId(id);
    // Not asserting `curated` — some namespaces legitimately have no curated
    // family and read fine derived. What must never happen is an identifier
    // reaching the screen with its shape intact.
    expect(described.detail).not.toMatch(/_/);
    expect(described.detail.length).toBeGreaterThan(0);
  });
});

/**
 * What `business-evidence.v4` bought.
 *
 * Sprint 0073 had to delete the sentence "Payments, in your code" because the
 * id could not support it: `buildRepositoryEvidence` minted
 * `repo.surface.payments` whether it found a payments surface or not, so
 * asserting presence inverted the meaning for every repository that had none.
 * The honest fallback named the check instead.
 *
 * v4 mints that id only when the surface *was* found. The sentence is true now,
 * and this is where it comes back.
 */
describe("a v4 citation may finally claim what a v3 one could not", () => {
  const V4 = "business-evidence.v4";

  it("says a present surface is present", () => {
    expect(describeEvidenceId("repo.surface.payments", V4).detail).toBe("Payments, in your code");
    expect(describeEvidenceId("live.surface.pricing", V4).detail).toBe(
      "Pricing page, on your live site",
    );
  });

  it("still only names the check for a v3 citation", () => {
    // The same id, stored under a pack that could not encode polarity. Reading
    // it as presence is the inversion 0073 existed to fix, so it must not
    // happen just because the code now knows how to say more.
    expect(describeEvidenceId("repo.surface.payments", "business-evidence.v3").detail).toBe(
      "Payments, checked in your code",
    );
  });

  it("reads an unknown version as the weaker claim", () => {
    // Understating a v4 citation costs precision. Overstating a v3 one shows a
    // founder the opposite of what was found, so the default leans that way.
    expect(describeEvidenceId("repo.surface.payments").detail).toBe(
      "Payments, checked in your code",
    );
  });

  /**
   * Absence needs no version at all, which is the point of the namespace.
   * `repo.surface_absent.<id>` has meant one thing in every pack that emits it.
   */
  it.each([null, "business-evidence.v3", "business-evidence.v4"])(
    "reads absence the same way under %s",
    (version) => {
      expect(describeEvidenceId("repo.surface_absent.payments", version).detail).toBe(
        "Payments — not found in your code",
      );
      expect(describeEvidenceId("live.surface_absent.pricing", version).certainty).toBe("curated");
    },
  );
});
