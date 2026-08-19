import type { ActionPlanStep, StepActor, StepChangeKind } from "@/modules/action-plans/schema";
import { classifyStep } from "@/modules/action-plans/classify";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";

/**
 * Internal benchmark fixtures — the only thing this harness replaces.
 *
 * ## What this is for
 *
 * A controlled agent benchmark needs a specific *execution shape* — a small UI
 * change, a wide metadata change, a change with no evidence at all. The Business
 * Audit and the Planner produce what a real project's evidence justifies, and
 * bending either to manufacture a benchmark step would corrupt the very thing
 * every downstream measurement is taken against.
 *
 * So this replaces exactly one span:
 *
 * ```
 * Audit → Opportunity → Move → Action Plan     ← replaced by a fixture
 * ────────────────────────────────────────
 * Action Step → ExecutionSpec → Context →      ← untouched, real, production
 * Verification → Completion → Sandbox Agent →
 * Billing → Candidate Verification →
 * Prepared Change → Independent Validation
 * ```
 *
 * ## What a fixture may decide, and what it may not
 *
 * A fixture decides **which benchmark step to run**. It does not decide how
 * execution security works, and it structurally cannot: the fields below are
 * exactly the fields the *Planner model* is trusted with, and every server-owned
 * conclusion is derived from them by the same production code that classifies a
 * real plan step.
 *
 * | field | who decides |
 * |---|---|
 * | `title`, `description`, `purpose`, `doneWhen`, `goal`, `expectedChangedState` | the fixture (as the Planner would) |
 * | `actor`, `changeKind`, `evidenceIds` | the fixture (the Planner's three structured fields) |
 * | `executionSupport`, `capability`, `requiresApproval` | `classifyStep`, from a server-owned registry |
 * | `riskClass` | `classifyExecutionRisk`, from `changeKind` + evidence ids |
 * | execution mode (`agentic`/`deterministic`/`unsupported`) | `resolveStepExecution` |
 * | verification mode, completion budget | `classifyAgentVerification`, unchanged |
 * | write scope, tools, sandbox policy, gateway budget | the compiled policy, unchanged |
 *
 * There is no field through which a fixture can name a model, widen a budget,
 * add a tool, choose a verification mode or reach a branch. It picks a task.
 *
 * ## Why the evidence ids are the interesting part
 *
 * They are what the Execution Surface compiler routes on (Sprint 0044), so a
 * fixture is really a way of asking "what does the pipeline do with *this*
 * structured evidence?". `live.conversion.primary_cta` is Vibe-minted by the
 * live analyzer's own conversion detector, and it is the id an evidence-derived
 * public-page surface resolves from with no SEO concept involved — which is the
 * generalization claim run #8 exists to test against a real repository.
 */

export const BENCHMARK_FIXTURE_VERSION = "dogfood-fixture.v1" as const;

/**
 * The namespace that separates a fixture step from a planner step.
 *
 * A real step id is `${order}-${changeKind}-${slug(title)}`, produced
 * deterministically by the Planner's own key builder, so it can never begin
 * with this prefix. That is what lets the durable execution path recognise a
 * fixture-backed step by its key alone, without a lookup that could be confused
 * by a customer's data.
 */
export const BENCHMARK_STEP_PREFIX = "dogfood-fixture:" as const;

export type BenchmarkFixture = {
  /** Stable, human-typed on the command line. */
  id: string;
  fixtureVersion: typeof BENCHMARK_FIXTURE_VERSION;

  /** One sentence on why this fixture exists as a benchmark. Never sent to a model. */
  benchmarkIntent: string;

  /* ---- The plan-level fields a Planner would have produced ---- */
  goal: string;
  expectedChangedState: string;

  /* ---- The step-level fields a Planner would have produced ---- */
  title: string;
  description: string;
  purpose: string;
  doneWhen: string;
  actor: StepActor;
  changeKind: StepChangeKind;
  /** Vibe-minted ids only. Validated against the evidence namespace at load. */
  evidenceIds: readonly string[];
};

/** The step key this fixture executes under. */
export function benchmarkStepKey(fixture: BenchmarkFixture): string {
  return `${BENCHMARK_STEP_PREFIX}${fixture.id}`;
}

export function isBenchmarkStepKey(stepKey: string): boolean {
  return stepKey.startsWith(BENCHMARK_STEP_PREFIX);
}

/**
 * The one initial fixture (PART F).
 *
 * Small on purpose. The Execution Surface will resolve every public page,
 * because that is what the evidence's scope *is* — but the task is one CTA, and
 * the brief's own framing ("a starting point, not the answer") is what keeps
 * those two facts separate. Knowing where the public surfaces are is not an
 * instruction to edit all of them, and the Done When says so in the plan's own
 * words rather than relying on the agent to infer it.
 */
export const LOW_UI_PRIMARY_CTA: BenchmarkFixture = {
  id: "low-ui-primary-cta",
  fixtureVersion: BENCHMARK_FIXTURE_VERSION,
  benchmarkIntent:
    "Exercises evidence-derived public-page surface resolution on a non-SEO signal, " +
    "with a task whose real change surface is one page and possibly one shared component.",

  goal: "Make the primary call to action clearer and more action-oriented for a first-time visitor.",
  expectedChangedState:
    "The primary public landing-page call to action clearly communicates what happens when a " +
    "visitor starts with Vibe, in the product's existing voice and visual design.",

  title: "Improve the primary landing-page call to action",
  description:
    "Rewrite the copy of the primary call to action on the public landing page so a first-time " +
    "visitor can tell what happens when they click it.",
  purpose:
    "The live site's primary call to action does not say what the visitor gets, so the strongest " +
    "moment of intent on the page is spent on a label that could belong to any product.",
  doneWhen:
    "The primary landing-page call-to-action copy is clearer about what happens next; the " +
    "existing design system and component structure are preserved; no signed-in application " +
    "screen is changed; and no unrelated page copy is rewritten.",
  actor: "vibe",
  changeKind: "product_change",
  evidenceIds: ["live.conversion.primary_cta"],
};

const FIXTURES: readonly BenchmarkFixture[] = [LOW_UI_PRIMARY_CTA];

export function listBenchmarkFixtures(): readonly BenchmarkFixture[] {
  return FIXTURES;
}

export function findBenchmarkFixture(id: string): BenchmarkFixture | null {
  return FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

/** The fixture a benchmark step key names, or null. */
export function fixtureForStepKey(stepKey: string): BenchmarkFixture | null {
  if (!isBenchmarkStepKey(stepKey)) return null;
  return findBenchmarkFixture(stepKey.slice(BENCHMARK_STEP_PREFIX.length));
}

/**
 * Where an execution's step came from, read off the immutable spec's step key.
 *
 * Derived rather than passed, so a caller cannot mislabel a run and a fixture
 * cannot hide that it is one. The key is the same field durable execution
 * resolves the step from, so this reads the fact the pipeline itself acts on.
 */
export function executionOriginForStepKey(stepKey: string): {
  executionOrigin: "planner" | "dogfood_fixture";
  dogfoodFixtureId: string | null;
} {
  const fixture = fixtureForStepKey(stepKey);
  return fixture
    ? { executionOrigin: "dogfood_fixture", dogfoodFixtureId: fixture.id }
    : { executionOrigin: "planner", dogfoodFixtureId: null };
}

/**
 * A fixture as the canonical domain object, with every server conclusion derived.
 *
 * This is the whole trust argument in one function. It does not build an
 * `ActionPlanStep` literal — it builds the Planner-authored half and hands it to
 * `classifyStep`, the same production classifier a real plan goes through, with
 * the same server-owned capability registry and the project's real repository
 * snapshot. A fixture that tried to assert `executionSupport: "vibe_executes_now"`
 * would find that the field it set is overwritten by the one the server derived.
 *
 * `order` is 1 and `dependsOn` is empty because a benchmark is one step with no
 * prerequisites; the resolver's dependency gate then passes for the honest
 * reason that there is nothing to wait for, not because anything was bypassed.
 */
export function benchmarkStep(
  fixture: BenchmarkFixture,
  snapshot: RepositoryIntelligenceSnapshot | null,
): ActionPlanStep {
  const authored = {
    actor: fixture.actor,
    changeKind: fixture.changeKind,
    evidenceIds: [...fixture.evidenceIds],
  };

  const classification = classifyStep(authored, { repository: snapshot });

  return {
    id: benchmarkStepKey(fixture),
    order: 1,
    title: fixture.title,
    description: fixture.description,
    purpose: fixture.purpose,
    completionCriteria: fixture.doneWhen,
    dependsOn: [],
    ...authored,
    // Server-derived, always. Listed last so no spread above can reach them.
    executionSupport: classification.executionSupport,
    capability: classification.capability,
    requiresApproval: classification.requiresApproval,
  };
}
