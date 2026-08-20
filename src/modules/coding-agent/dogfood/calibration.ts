import { classifyExecutionPricingClass, type ExecutionPricingClass } from "@/modules/economy/execution-class";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import { BENCHMARK_FIXTURE_VERSION, type BenchmarkFixture } from "./fixtures";

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
 * `live.surface.pricing` implies `pricing_page`. Two named surfaces, so rule 4
 * fires: `multi_surface` → `complex`.
 *
 * Neither id is in `SENSITIVE_EVIDENCE_PREFIXES`, so this reaches `complex`
 * without touching payments, checkout or authentication.
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
  expectedSurfaces: ["pricing_page", "seo_metadata"],

  benchmarkIntent:
    "Two named business surfaces in one step, which is what the `complex` class is meant to price.",

  goal: "Give the pricing page a meta description that matches what the page actually offers.",
  expectedChangedState:
    "The pricing page carries a meta description written for it specifically, rather than " +
    "inheriting a generic site-wide one or having none.",

  title: "Give the pricing page its own meta description",
  description:
    "Add a page-specific meta description to the public pricing page, describing what the page " +
    "shows rather than repeating the site-wide description.",
  purpose:
    "The pricing page is the page a visitor reaches when they are deciding whether to pay, and " +
    "it is described to search engines in words written for the site as a whole.",
  doneWhen:
    "The pricing page exports its own metadata description; the site-wide default is left in " +
    "place for pages that have no override; no pricing figure, plan or entitlement is changed; " +
    "and no checkout or billing code is touched.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.seo.meta_description_missing", "live.surface.pricing"],
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
 * `repo.surface.legal` and `repo.surface.docs_help` are two named surfaces, so
 * `multi_surface` → `complex` again. A second observation on a *different* pair
 * is what separates "complex costs more" from "that one pair costs more" —
 * with n=1 the two are indistinguishable.
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
  expectedSurfaces: ["docs_help", "legal"],

  benchmarkIntent:
    "Two named surfaces that share a structural problem, so the change is genuinely broader " +
    "rather than one edit cited twice.",

  goal: "Give the legal and help pages a consistent way of stating when they were last updated.",
  expectedChangedState:
    "The legal and help pages state when they were last updated, from one shared source rather " +
    "than from a date written separately into each page.",

  title: "State when the legal and help pages were last updated",
  description:
    "Give the legal and help pages a shared way of showing a last-updated date, so the value is " +
    "defined once rather than written into each page by hand.",
  purpose:
    "A legal page with no last-updated date leaves a reader unable to tell whether the terms " +
    "they are agreeing to are current, and a date copied into each page drifts the moment one " +
    "page is edited and the other is not.",
  doneWhen:
    "The legal and help pages show a last-updated date drawn from a single shared definition; no " +
    "legal wording is altered; the existing page structure and design system are preserved; and " +
    "no authenticated screen is changed.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["repo.surface.legal", "repo.surface.docs_help"],
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
