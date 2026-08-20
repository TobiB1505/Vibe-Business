import { classifyExecutionPricingClass, type ExecutionPricingClass } from "@/modules/economy/execution-class";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { BenchmarkFixture } from "./fixtures";
import { BENCHMARK_FIXTURE_VERSION } from "./fixture-version";

/**
 * The five calibration moves (Sprint 0055).
 *
 * ## What this is for
 *
 * Sprint 0054 built an estimator and then measured it against the only evidence
 * that existed: seven runs, six of them the same kind of work, none carrying
 * repository size. It came out at 24.3% mean absolute error with `complex`
 * never once observed. The engine is not the problem; the evidence is.
 *
 * These five fixtures exist to produce that evidence deliberately rather than
 * waiting for it to accumulate. Each one is chosen so its **Execution Pricing
 * Class is known before the run**, and `calibration.test.ts` asserts every one
 * of them — because a calibration set whose classes turn out wrong after the
 * money is spent has measured nothing.
 *
 * ## Why the class is a property of the evidence, not of the prose
 *
 * `classifyExecutionPricingClass` reads risk class, change kind, evidence ids
 * and the surfaces those ids imply. Nothing else. So a fixture's class is
 * decided entirely by which Vibe-minted evidence ids it cites, and the titles
 * below cannot talk it up or down. That is what makes these predictions
 * falsifiable in advance.
 *
 * ## Why `complex` is reached by surface count and never by risk
 *
 * The classifier escalates to `complex` on high or prohibited risk — but
 * `MAX_AGENTIC_V1_RISK` is `moderate`, so an agentic run at high risk is
 * *refused* rather than executed. A high-risk fixture would produce a blocked
 * run and no cost data at all.
 *
 * It also escalates on sensitive evidence (payments, checkout, authentication),
 * and those are exactly the surfaces Vibe should not be practising on.
 *
 * That leaves surface count, which is the honest route: two named business
 * surfaces make a change genuinely broader, and the class says so. Both
 * `complex` fixtures below get there that way.
 *
 * ## What this file does not do
 *
 * It starts nothing and spends nothing. A fixture is a description; the run is
 * started by a human through the internal dogfood surface, which is gated by
 * the operator allowlist. There is no code path from here to a provider.
 */

export const CALIBRATION_SET_VERSION = "calibration-set.v1" as const;

/**
 * A fixture plus the class it is expected to produce.
 *
 * The expectation is written down rather than computed so the test compares two
 * independently-authored things. A fixture that derived its own expectation
 * would agree with itself no matter what the classifier did.
 */
export type CalibrationFixture = BenchmarkFixture & {
  calibrationRun: 1 | 2 | 3 | 4 | 5;
  /** What this run is supposed to teach the estimator. Never sent to a model. */
  calibrationIntent: string;
  /** The risk class the execution contract will resolve. Never `high` — that would be refused. */
  expectedRiskClass: Extract<ExecutionRiskClass, "low" | "moderate">;
  expectedPricingClass: ExecutionPricingClass;
  /** The named business surfaces the cited evidence implies, in vocabulary order. */
  expectedSurfaces: readonly string[];
};

/**
 * RUN 1 — the cheap floor.
 *
 * Cites `live.conversion.primary_cta`, which implies the public page set and no
 * named surface at all, so the classifier's narrowest branch applies:
 * `public_pages_only` → `small`.
 *
 * It is deliberately the same evidence id as the existing `low-ui-primary-cta`
 * fixture, which run #8 executed. That is not duplication — it is the only way
 * to get a second observation of `small`, and it repeats a known step against a
 * repository that has grown substantially since, which is precisely the
 * comparison that made run #6 → #9 the most informative pair in the dataset.
 */
export const CALIBRATION_1_SMALL_COPY: CalibrationFixture = {
  id: "calibration-1-small-copy",
  fixtureVersion: BENCHMARK_FIXTURE_VERSION,
  calibrationRun: 1,
  calibrationIntent:
    "A second observation of the `small` class, and a repeat of run #8's evidence against a " +
    "repository that has grown since — so repository drift can be measured against a known step.",
  expectedRiskClass: "moderate",
  expectedPricingClass: "small",
  expectedSurfaces: [],

  benchmarkIntent:
    "The narrowest real change: public-page copy, one named signal, no business surface implied.",

  goal: "Make the public landing page's supporting copy state plainly who the product is for.",
  expectedChangedState:
    "The public landing page's supporting copy names the reader it is written for, in the " +
    "product's existing voice, without changing layout or components.",

  title: "Say who the landing page is written for",
  description:
    "Adjust the supporting copy beneath the primary call to action on the public landing page so " +
    "a first-time visitor can tell whether the product is meant for them.",
  purpose:
    "The supporting copy describes what the product does without saying who it is for, so a " +
    "visitor has to guess whether they are the intended reader before deciding to act.",
  doneWhen:
    "The supporting copy on the public landing page names its intended reader; the existing " +
    "design system, components and layout are unchanged; no signed-in application screen is " +
    "touched; and no other page's copy is rewritten.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.conversion.primary_cta"],
};

/**
 * RUN 2 — the first `complex`, by surface count.
 *
 * `live.seo.meta_description_missing` implies the `seo_metadata` surface;
 * `repo.surface.legal` implies `legal`. Two named surfaces, so rule 4 fires:
 * `multi_surface` → `complex`. Neither id is in `SENSITIVE_EVIDENCE_PREFIXES`.
 *
 * ## Why not the pricing page, which the first draft cited
 *
 * Because this repository has no pricing page. The classifier would still have
 * answered `complex` — it reads evidence ids, not the filesystem — so the class
 * assertions passed while the *work* was impossible. The agent would have found
 * nothing to edit, or invented a pricing page, and either way the run would
 * have cost real money and measured nothing.
 *
 * `calibration.test.ts` now checks every fixture's surfaces against paths that
 * exist on disk, which is the guard that was missing.
 */
export const CALIBRATION_2_COMPLEX_MULTI_SURFACE: CalibrationFixture = {
  id: "calibration-2-complex-multi-surface",
  fixtureVersion: BENCHMARK_FIXTURE_VERSION,
  calibrationRun: 2,
  calibrationIntent:
    "The first observation of `complex` in Vibe's history. Reached by surface count rather than " +
    "by risk, because a high-risk agentic run is refused and would produce no cost data.",
  expectedRiskClass: "moderate",
  expectedPricingClass: "complex",
  expectedSurfaces: ["seo_metadata", "legal"],

  benchmarkIntent:
    "Two named business surfaces in one step, on two pages that genuinely exist and genuinely " +
    "share the defect.",

  goal: "Give the legal pages meta descriptions that say what each one covers.",
  expectedChangedState:
    "The privacy and terms pages each carry their own meta description, written for that page, " +
    "rather than inheriting the site-wide default.",

  title: "Give the privacy and terms pages their own meta descriptions",
  description:
    "Add a page-specific meta description to the public privacy page and to the public terms " +
    "page, each describing what that document covers.",
  purpose:
    "Both legal pages are described to search engines in words written for the site as a whole, " +
    "so a visitor searching for Vibe's terms sees a summary of the product instead.",
  doneWhen:
    "The privacy page and the terms page each export their own metadata description; the " +
    "site-wide default is left in place for pages with no override; no legal wording is altered; " +
    "and no other page is changed.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.seo.meta_description_missing", "repo.surface.legal"],
};

/**
 * RUN 3 — `standard`, and the first calibration change that is logic.
 *
 * `live.seo.sitemap_missing` implies exactly one surface, `sitemap`, so rule 5
 * applies: `single_surface` → `standard`.
 *
 * Chosen because a sitemap is generated rather than written: the change lands
 * in code that runs, not in copy. Every previous run in the dataset was
 * presentational, so this is the first data point on whether logic costs
 * differently at the same class.
 */
export const CALIBRATION_3_STANDARD_LOGIC: CalibrationFixture = {
  id: "calibration-3-standard-logic",
  fixtureVersion: BENCHMARK_FIXTURE_VERSION,
  calibrationRun: 3,
  calibrationIntent:
    "The first non-presentational calibration change. Same class as most of the dataset, " +
    "different kind of work, so `standard` can be tested for internal spread.",
  expectedRiskClass: "moderate",
  expectedPricingClass: "standard",
  expectedSurfaces: ["sitemap"],

  benchmarkIntent:
    "One named surface, and a change that lands in generated output rather than in copy.",

  goal: "Make the sitemap reflect the pages the site actually publishes.",
  expectedChangedState:
    "The generated sitemap lists the public pages the site serves, with a last-modified value " +
    "that is derived rather than hard-coded.",

  title: "Make the sitemap list the pages the site actually has",
  description:
    "Extend the generated sitemap so it covers the public routes the application serves, instead " +
    "of a hand-maintained subset.",
  purpose:
    "A sitemap that lists fewer pages than the site publishes tells search engines the product " +
    "is smaller than it is, and it drifts silently every time a page is added.",
  doneWhen:
    "The sitemap is derived from the routes the application defines rather than from a hand-kept " +
    "list; every entry it emits corresponds to a page that exists; no authenticated route is " +
    "listed; and the existing sitemap route contract is preserved.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.seo.sitemap_missing"],
};

/**
 * RUN 4 — `standard`, chosen so validation does more work.
 *
 * `live.seo.structured_data_missing` implies `seo_metadata` alone, so this is
 * `standard` like run 3 — deliberately. Holding the class fixed while changing
 * how much the change has to be checked is the only way to separate validation
 * cost from pricing class, which Sprint 0054 could only assume at 0.15 of a run.
 */
export const CALIBRATION_4_STANDARD_VALIDATION_HEAVY: CalibrationFixture = {
  id: "calibration-4-standard-validation-heavy",
  fixtureVersion: BENCHMARK_FIXTURE_VERSION,
  calibrationRun: 4,
  calibrationIntent:
    "Same class as run 3, more to validate. Holds pricing class fixed so validation effort can be " +
    "measured as its own variable rather than inferred from the assumed 0.15 share.",
  expectedRiskClass: "moderate",
  expectedPricingClass: "standard",
  expectedSurfaces: ["seo_metadata"],

  benchmarkIntent:
    "One named surface, and a change whose correctness is checkable by tests rather than by eye.",

  goal: "Describe the product to search engines in the structured form they read.",
  expectedChangedState:
    "The public landing page emits valid structured data describing the product, generated from " +
    "the values the application already holds rather than from duplicated literals.",

  title: "Emit structured data for the public landing page",
  description:
    "Add structured data to the public landing page, built from the application's existing " +
    "metadata values rather than from a second hand-written copy of them.",
  purpose:
    "Search engines read structured data to describe a product in results, and the site emits " +
    "none, so it is described only by whatever text happens to be scraped from the page.",
  doneWhen:
    "The public landing page emits structured data describing the product; the values come from " +
    "the application's existing metadata rather than being duplicated; the output is covered by a " +
    "test that would fail if the shape broke; and no other page is changed.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.seo.structured_data_missing"],
};

/**
 * RUN 5 — the second `complex`, on a different pair of surfaces.
 *
 * `live.seo.sitemap_missing` implies `sitemap`; `live.seo.canonical_missing`
 * implies `seo_metadata`. Two named surfaces again, and a *different* pair from
 * run 2 — which is what separates "complex costs more" from "that one pair
 * costs more". With n=1 the two are indistinguishable.
 *
 * ## Why not robots + sitemap, which the previous draft cited
 *
 * Because that pair is the one thing Vibe does **deterministically**.
 * `CAPABILITY_REGISTRY`'s single entry matches a step citing both
 * `ROBOTS_ABSENCE_EVIDENCE` and `SITEMAP_ABSENCE_EVIDENCE`, and the resolver
 * checks the registry *before* it considers an agentic route. So that fixture
 * would have resolved to `mode: "deterministic"` and been refused as
 * `not_agentic` — or, if the snapshot happened to report the surfaces present,
 * would have squeaked through as agentic on a technicality.
 *
 * Either outcome is wrong for a calibration: this set exists to measure what an
 * *agent* costs, and a fixture whose route depends on how a snapshot classified
 * two files measures nothing reliably. Every sitemap and robots evidence id is
 * in one of those two lists, so the pair is unavailable at any price and the
 * surface had to change rather than the wording.
 *
 * The work is still structural, still spans two surfaces, and still lands in
 * code that runs rather than in copy.
 */
export const CALIBRATION_5_COMPLEX_STRUCTURAL: CalibrationFixture = {
  id: "calibration-5-complex-structural",
  fixtureVersion: BENCHMARK_FIXTURE_VERSION,
  calibrationRun: 5,
  calibrationIntent:
    "A second `complex` observation on a different surface pair, so the class can be told apart " +
    "from the particular surfaces run 2 happened to touch.",
  expectedRiskClass: "moderate",
  expectedPricingClass: "complex",
  expectedSurfaces: ["seo_metadata", "sitemap"],

  benchmarkIntent:
    "Two named surfaces that share one structural relationship, so the change is genuinely " +
    "broader rather than one edit cited twice.",

  goal: "Make the sitemap and the pages' canonical URLs agree on one base URL.",
  expectedChangedState:
    "The generated sitemap and the pages' canonical URLs are built from a single base-URL " +
    "source, so the two can no longer disagree about the site's own address.",

  title: "Build the sitemap and the canonical URLs from one base URL",
  description:
    "Derive the sitemap's entries and the pages' canonical URLs from the same base-URL value, " +
    "instead of each route computing the site's address for itself.",
  purpose:
    "The sitemap and the canonical tags each decide what the site's address is, so a change to " +
    "one silently disagrees with the other and search engines are told two different things.",
  doneWhen:
    "The sitemap route and the canonical URLs read the same base-URL source; no route computes " +
    "the site address independently; the existing sitemap and metadata route contracts are " +
    "preserved; and both keep their current tests passing.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.seo.sitemap_missing", "live.seo.canonical_missing"],
};

export const CALIBRATION_FIXTURES: readonly CalibrationFixture[] = [
  CALIBRATION_1_SMALL_COPY,
  CALIBRATION_2_COMPLEX_MULTI_SURFACE,
  CALIBRATION_3_STANDARD_LOGIC,
  CALIBRATION_4_STANDARD_VALIDATION_HEAVY,
  CALIBRATION_5_COMPLEX_STRUCTURAL,
];

export function findCalibrationFixture(id: string): CalibrationFixture | null {
  return CALIBRATION_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

export function calibrationFixtureForRun(run: number): CalibrationFixture | null {
  return CALIBRATION_FIXTURES.find((fixture) => fixture.calibrationRun === run) ?? null;
}

/**
 * The class a fixture actually resolves to, through the production classifier.
 *
 * Exported so the prediction recorder and the test both go through one path.
 * A calibration whose recorded prediction used a different derivation than the
 * run itself would be comparing two different questions.
 */
export function classifyCalibrationFixture(fixture: CalibrationFixture): {
  pricingClass: ExecutionPricingClass | null;
  reason: string;
  surfaces: readonly string[];
} {
  const requirement = deriveExecutionSurfaceRequirement({
    changeKind: fixture.changeKind,
    evidenceIds: fixture.evidenceIds,
  });

  const resolution = classifyExecutionPricingClass({
    riskClass: fixture.expectedRiskClass,
    changeKind: fixture.changeKind,
    evidenceIds: fixture.evidenceIds,
    surfaces: requirement.surfaces,
  });

  return {
    pricingClass: resolution.pricingClass,
    reason: resolution.reason,
    surfaces: requirement.surfaces,
  };
}
