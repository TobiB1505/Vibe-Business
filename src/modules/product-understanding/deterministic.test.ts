import { describe, expect, it } from "vitest";
import {
  deriveBusinessSignals,
  deriveCapabilities,
  deriveJourney,
  deriveTechnicalProfile,
} from "./deterministic";
import { buildUnderstandingPack, understandingEvidenceIds } from "./evidence";
import { fakeLiveSnapshot, fakeRepositorySnapshot } from "./test-support";

const both = () => ({
  repository: fakeRepositorySnapshot(),
  liveProduct: fakeLiveSnapshot(),
  signedInProduct: null,
});

const codeOnly = () => ({
  repository: fakeRepositorySnapshot(),
  liveProduct: null,
  signedInProduct: null,
});

describe("capabilities", () => {
  it("confirms what the live product actually serves", () => {
    const capabilities = deriveCapabilities(both());
    const signIn = capabilities.find((capability) => capability.id === "sign_in");

    expect(signIn).toMatchObject({ confidence: "confirmed" });
    expect(signIn?.sources).toContain("live_product");
  });

  it("will not confirm a capability that only exists in code", () => {
    // Code containing a dashboard is not a visitor reaching one — this is the
    // whole reason the two collectors stay separate.
    const capabilities = deriveCapabilities(codeOnly());
    const dashboard = capabilities.find((capability) => capability.id === "use_dashboard");

    expect(dashboard).toMatchObject({ confidence: "likely", sources: ["repository"] });
  });

  it("omits capabilities nothing supports rather than listing them as absent", () => {
    const ids = deriveCapabilities(both()).map((capability) => capability.id);

    expect(ids).not.toContain("book_appointment");
    expect(ids).not.toContain("browse_catalog");
  });

  it("orders the most certain first", () => {
    const capabilities = deriveCapabilities(both());
    const confidences = capabilities.map((capability) => capability.confidence);
    const rank = { confirmed: 0, likely: 1, unclear: 2, not_found: 3 } as const;

    expect(confidences).toEqual([...confidences].sort((a, b) => rank[a] - rank[b]));
  });

  it("describes a booking tool without SaaS vocabulary", () => {
    // The vocabulary has to fit a product Vibe Business is nothing like.
    const bookingSite = fakeLiveSnapshot({
      pages: [
        {
          path: "/book",
          status: 200,
          redirectedTo: null,
          title: "Book a table",
          headingCount: 2,
          formCount: 1,
          linkCount: 4,
          ctas: ["Book a table"],
          surfaces: [],
          bytes: 8_000,
        },
      ],
      productSurfaces: [],
      conversionSignals: {
        primaryCta: null,
        ctas: [],
        signupCtaPresent: false,
        pricingCtaPresent: false,
        contactCtaPresent: false,
        formCount: 1,
        forms: [],
        conversionPathLinks: [],
      },
    });

    const capabilities = deriveCapabilities({
      repository: null,
      liveProduct: bookingSite,
      signedInProduct: null,
    });

    expect(capabilities.map((capability) => capability.id)).toContain("book_appointment");
  });

  it("cites only evidence ids that exist in the pack", () => {
    const input = both();
    const known = understandingEvidenceIds(buildUnderstandingPack(input));

    for (const capability of deriveCapabilities(input)) {
      for (const id of capability.evidence) {
        expect(known.has(id), `${capability.id} cites unknown evidence ${id}`).toBe(true);
      }
    }
  });
});

describe("journey", () => {
  it("returns every stage, including the empty ones", () => {
    const journey = deriveJourney(both());
    expect(journey).toHaveLength(8);
  });

  it("reports a stage with nothing behind it as not found, with no detail", () => {
    const journey = deriveJourney(both());
    const checkout = journey.find((stage) => stage.id === "checkout");

    expect(checkout).toMatchObject({ confidence: "not_found", detail: null, evidence: [] });
  });

  it("names the primary action from the live call to action", () => {
    const journey = deriveJourney(both());
    const primary = journey.find((stage) => stage.id === "primary_action");

    expect(primary?.detail).toBe('The main call to action is "Start free".');
    expect(primary?.confidence).toBe("confirmed");
  });

  it("keeps a code-only pricing page out of confirmed", () => {
    const journey = deriveJourney(both());
    const pricing = journey.find((stage) => stage.id === "pricing");

    // The repository has one; the live site does not serve it.
    expect(pricing).toMatchObject({ confidence: "likely", sources: ["repository"] });
  });

  it("cites only evidence ids that exist in the pack", () => {
    const input = both();
    const known = understandingEvidenceIds(buildUnderstandingPack(input));

    for (const stage of deriveJourney(input)) {
      for (const id of stage.evidence) {
        expect(known.has(id), `${stage.id} cites unknown evidence ${id}`).toBe(true);
      }
    }
  });
});

describe("business signals", () => {
  it("states an observation, never a verdict", () => {
    const statements = deriveBusinessSignals(both()).map((signal) => signal.statement);
    const joined = statements.join(" ").toLowerCase();

    for (const verdict of ["weak", "poor", "bad", "should", "you need to", "missing opportunity"]) {
      expect(joined, `a signal reads as a verdict: ${verdict}`).not.toContain(verdict);
    }
  });

  it("does not claim revenue from a payments dependency", () => {
    const payment = deriveBusinessSignals(both()).find(
      (signal) => signal.id === "payment_capability",
    );

    expect(payment?.statement).toBe("Payment functionality appears to be present.");
    // A dependency is not a working checkout, so nothing confirms it.
    expect(payment?.confidence).toBe("likely");
  });

  it("says Vibe found nothing rather than that the thing does not exist", () => {
    const analytics = deriveBusinessSignals(both()).find((signal) => signal.id === "analytics");

    expect(analytics?.statement).toContain("Vibe found no analytics signals");
    expect(analytics?.confidence).toBe("not_found");
  });

  it("phrases a missing pricing path as a search that found nothing", () => {
    const pricingless = deriveBusinessSignals({
      repository: fakeRepositorySnapshot({
        businessSurfaces: fakeRepositorySnapshot().businessSurfaces.map((surface) =>
          surface.id === "pricing_page" ? { ...surface, detected: false } : surface,
        ),
      }),
      liveProduct: fakeLiveSnapshot(),
      signedInProduct: null,
    });

    expect(pricingless.find((signal) => signal.id === "pricing_surface")?.statement).toBe(
      "Vibe could not identify a pricing path in the sources it read.",
    );
  });
});

describe("technical profile", () => {
  it("reads the stack from the repository", () => {
    expect(deriveTechnicalProfile(both())).toEqual({
      framework: "Next.js",
      languages: ["TypeScript"],
      database: "Supabase",
      authProvider: null,
      paymentProvider: "Stripe",
      analyticsProvider: null,
      deployment: null,
      integrations: ["Supabase", "Stripe"],
      hasTestInfrastructure: true,
    });
  });

  it("is empty rather than guessed when there is no repository", () => {
    const technical = deriveTechnicalProfile({
      repository: null,
      liveProduct: fakeLiveSnapshot(),
      signedInProduct: null,
    });

    expect(technical.framework).toBeNull();
    expect(technical.integrations).toEqual([]);
  });
});
