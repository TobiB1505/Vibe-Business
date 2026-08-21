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
 * `live.seo.canonical_missing` implies the `seo_metadata` surface;
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
 *
 * ## Why not the meta description, which the second draft cited
 *
 * That guard checks that a *surface* exists — it never checks that the
 * *defect* a live evidence id claims is still true. Run 2's first real attempt
 * cited `live.seo.meta_description_missing`, and the agent correctly found
 * nothing to do: `privacy/page.tsx` and `terms/page.tsx` already export their
 * own `metadata.description`. Two independent runs (`8c14b567`-adjacent
 * dogfood attempts) reproduced `agent_produced_no_change` before this was
 * caught. Checked directly against the live site and the repository before
 * choosing canonical links as the replacement — see
 * `docs/business/calibration/README.md`'s "Known open issue" section for the
 * full finding, including the production-scale version of this risk.
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
    "Two named business surfaces in one step, on pages that genuinely exist and genuinely share " +
    "the defect — checked live and in source, not assumed from an older dataset.",

  goal: "Add canonical link tags to the homepage, and to the privacy and terms pages.",
  expectedChangedState:
    "The homepage and both legal pages each emit a canonical link tag pointing at their own " +
    "resolved URL, computed from the app's base URL rather than hard-coded.",

  title: "Add canonical link tags to the homepage and the legal pages",
  description:
    "Add a canonical link tag to the public homepage, the privacy page and the terms page, each " +
    "computed from the application's own base URL rather than a hard-coded literal.",
  purpose:
    "None of these pages states its own canonical URL, so a search engine has no signal for which " +
    "address is authoritative when the same content is reachable at more than one URL.",
  doneWhen:
    "The homepage, the privacy page and the terms page each emit a canonical link tag derived " +
    "from the application's base URL; no page hard-codes its own origin; and no other page is " +
    "changed.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.seo.canonical_missing", "repo.surface.legal"],
};

/**
 * RUN 3 — `standard`, and the first calibration change that is logic.
 *
 * `live.seo.open_graph_missing` implies exactly one surface, `seo_metadata`,
 * so rule 5 applies: `single_surface` → `standard`.
 *
 * Originally built on `live.seo.sitemap_missing`. That evidence turned out to
 * be false — `src/app/sitemap.ts` already exists and `/sitemap.xml` already
 * resolves live — discovered while diagnosing run 2's identical failure mode
 * (see run 2's docblock and `docs/business/calibration/README.md`). Open
 * Graph tags are confirmed missing both live (zero `og:*` tags on the
 * rendered homepage) and in source (no `openGraph` metadata anywhere under
 * `src/app/`).
 *
 * Still the first data point on non-presentational work at this class: an
 * Open Graph block is generated from values the app already holds (title,
 * description, base URL), not typed by hand, the same "logic, not copy"
 * property the sitemap task was chosen for.
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
  expectedSurfaces: ["seo_metadata"],

  benchmarkIntent:
    "One named surface, and a change that lands in generated metadata rather than in copy.",

  goal: "Give the homepage Open Graph metadata generated from its existing title and description.",
  expectedChangedState:
    "The homepage emits `og:title`, `og:description` and `og:url`, each derived from the page's " +
    "existing metadata values rather than duplicated as new literals.",

  title: "Add Open Graph metadata to the homepage",
  description:
    "Add Open Graph tags to the public homepage, generated from the title, description and base " +
    "URL the application's existing metadata already defines.",
  purpose:
    "The homepage has no Open Graph metadata, so a link to it shared anywhere — Slack, X, " +
    "iMessage — renders with no title, no description and no preview image.",
  doneWhen:
    "The homepage emits `og:title`, `og:description` and `og:url`; every value is derived from " +
    "the application's existing metadata rather than a new hard-coded string; and no other page " +
    "is changed.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.seo.open_graph_missing"],
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
 * RUN 5 — the second `complex`, on a different pair of surfaces, and the
 * first calibration run outside SEO entirely.
 *
 * `repo.surface.dashboard_app` implies `dashboard_app`; `repo.surface.legal`
 * implies `legal`. Two named surfaces, and a *different* pair from run 2
 * (`seo_metadata` + `legal`) — which is what separates "complex costs more"
 * from "that one pair costs more". `deriveExecutionSurfaceRequirement` orders
 * surfaces by `BUSINESS_SURFACE_IDS`, not by citation order, so the resolved
 * order is `["legal", "dashboard_app"]` — verified against the real
 * classifier, not assumed.
 *
 * ## Why not robots + sitemap, which the previous draft cited
 *
 * Because that pair is the one thing Vibe does **deterministically**.
 * `CAPABILITY_REGISTRY`'s single entry matches a step citing both
 * `ROBOTS_ABSENCE_EVIDENCE` and `SITEMAP_ABSENCE_EVIDENCE`, and the resolver
 * checks the registry *before* it considers an agentic route. See
 * `calibration.test.ts`'s "no fixture can route to a deterministic
 * capability" guard.
 *
 * ## Why not sitemap + canonical, the draft after that
 *
 * `live.seo.sitemap_missing` turned out false — `/sitemap.xml` already
 * resolves live. See run 2's docblock for the full story; the short version
 * is that a live evidence id can go stale between when it was minted and
 * when a fixture cites it, and nothing in this repository re-verifies it.
 *
 * ## Why outside SEO at all
 *
 * Every other calibration run stays inside `seo_metadata` / `sitemap` /
 * `robots` / `legal`. Deliberately, this run reaches into `dashboard_app` —
 * the authenticated application, not a public page — to see whether the
 * agent's cost and behaviour on real app code differs from presentational
 * public-page work. `dashboard_app` and `onboarding` are not in
 * `SENSITIVE_EVIDENCE_PREFIXES`; only payments, checkout billing and
 * authentication are. Nothing about the write-scope or capability machinery
 * treats an authenticated surface differently from a public one — the
 * `authenticated_pages` scope is already resolved and already counted
 * (`authenticatedPagesResolved` in `execution_surface_resolved`) on every run,
 * just never included until a step's own evidence asks for it.
 */
export const CALIBRATION_5_COMPLEX_STRUCTURAL: CalibrationFixture = {
  id: "calibration-5-complex-structural",
  fixtureVersion: BENCHMARK_FIXTURE_VERSION,
  calibrationRun: 5,
  calibrationIntent:
    "A second `complex` observation on a different surface pair, and the first observation of " +
    "the agent working outside SEO — on the authenticated dashboard rather than a public page.",
  expectedRiskClass: "moderate",
  expectedPricingClass: "complex",
  expectedSurfaces: ["legal", "dashboard_app"],

  benchmarkIntent:
    "Two unrelated named surfaces in one step — a real shape a founder's plan can take — so the " +
    "class is told apart from run 2's particular pair rather than from a repeat of it.",

  goal:
    "Give the dashboard's Recent Activity section a first-activity empty state, and give the " +
    "privacy and terms pages Open Graph metadata.",
  expectedChangedState:
    "A signed-in user with a project but no activity yet sees an explanatory empty state instead " +
    "of nothing; the privacy and terms pages each emit their own Open Graph tags.",

  title: "Add a first-activity empty state and Open Graph tags for the legal pages",
  description:
    "In `DashboardActivity`, replace the bare `return null` for zero entries with a short " +
    "explanatory empty state, matching the pattern `EmptyDashboard` already uses on the same " +
    "page. Separately, add Open Graph tags to the privacy and terms pages, generated from their " +
    "existing title and description metadata.",
  purpose:
    "A user with one project and no activity yet sees an empty section with no explanation, " +
    "rather than the guidance every other empty state on this page already gives. Unrelated but " +
    "in the same step: the legal pages have no Open Graph tags, so a shared link to either " +
    "renders with no title or description.",
  doneWhen:
    "`DashboardActivity` renders an explanatory empty state instead of `null` when there is at " +
    "least one project and zero activity entries; the privacy and terms pages each emit their " +
    "own `og:title` and `og:description`, derived from their existing metadata; no credit " +
    "balance, onboarding routing or audit logic is touched; and no other page or component is " +
    "changed.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["repo.surface.dashboard_app", "repo.surface.legal"],
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
