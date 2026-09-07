import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { buildNovaBriefing } from "@/modules/nova/briefing/briefing";
import { buildBriefingView, type BriefingView } from "@/modules/nova/briefing/view";
import type { NovaFocus } from "@/modules/nova/focus";
import { buildProvenanceChain, type ProvenanceInputs } from "@/modules/provenance/chain";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import type { PrimaryGoal } from "@/modules/projects/founder-intent";

/**
 * The briefing, in every state a founder can meet it in.
 *
 * ## Why these need a browser
 *
 * Because the thing under test is not a string, it is what somebody who came
 * back after a week can read in one glance: which link is old, how old, what
 * Vibe suggests, and — the part no unit test can see — whether the panel says
 * one thing or appears to say two. The failure this catches is the one the
 * whole module is shaped around: a panel that reports a broken analyzer *and*
 * a stale date, leaving a founder with two problems where there is one.
 *
 * Everything below is built by the **real** `buildProvenanceChain`,
 * `buildNovaBriefing` and `buildBriefingView`, from a fixed clock. So a
 * changed bucket boundary, a bumped analyzer version or a reworded reason
 * reaches the browser rather than leaving a fixture agreeing with itself.
 */

/** Fixed, so a screenshot taken in March and one taken in October agree. */
const NOW = new Date("2026-09-06T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Everything current and produced today, so each scenario spoils one thing. */
function sound(overrides: Partial<ProvenanceInputs> = {}): ProvenanceInputs {
  return {
    repositoryScan: { producedAt: daysAgo(0), analyzerVersion: REPOSITORY_ANALYZER_VERSION },
    liveScan: { producedAt: daysAgo(0), analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION },
    productProfile: { producedAt: daysAgo(0), current: true },
    businessAudit: { producedAt: daysAgo(0), upToDate: true },
    opportunitySet: { producedAt: daysAgo(0), stale: false },
    ...overrides,
  };
}

/** Nothing open. The Focus Card above would be showing `nothing_to_do`. */
const IDLE = { primary: { kind: "nothing_to_do" }, nextAction: null } as unknown as NovaFocus;

/** Something open, so the briefing points at the card rather than repeating it. */
const WAITING = { primary: { kind: "merge_ready" }, nextAction: null } as unknown as NovaFocus;

const TOP_MOVE = {
  title: "Put a price on the pricing page",
  whyNow:
    "Vibe found a pricing page with no amount on it, and your goal on file is to reach paying customers.",
};

type Scenario = {
  founderName: string | null;
  projectName: string;
  primaryGoal: PrimaryGoal | null;
  chain: ProvenanceInputs;
  focus: NovaFocus;
  topMove: { title: string; whyNow: string } | null;
  /**
   * A stored sentence, as a model would have written it about this exact
   * situation. Absent means no message was ever generated for this identity —
   * the ordinary state, and the one every other scenario is in.
   *
   * Fixed text rather than a live call: the point on screen is that the panel
   * renders a written half in front of a live one, which is a property of the
   * component and not of a provider. What the model actually produces is
   * measured by the eval, not by a browser.
   */
  spoken?: string;
};

const SCENARIOS = {
  /**
   * The founder's own example. Nothing is broken, the audit has been sitting a
   * week, and Nova says so and offers the run that would replace it — as an
   * offer, because she cannot see whether the product moved.
   */
  "briefing-audit-ageing": {
    founderName: "Tobi",
    projectName: "Vibe Business",
    primaryGoal: "get_first_users",
    chain: sound({ businessAudit: { producedAt: daysAgo(5), upToDate: true } }),
    focus: IDLE,
    topMove: TOP_MOVE,
  },

  /**
   * The incident the chain exists for: a live scan from before the pricing
   * classifier was fixed. A broken link outranks an old one *and* outranks the
   * Move — so the panel says one thing, about the scan, with a Move that would
   * otherwise have led sitting unmentioned.
   */
  "briefing-corrected-analyzer": {
    founderName: "Tobi",
    projectName: "Vibe Business",
    primaryGoal: "monetize",
    chain: sound({
      liveScan: { producedAt: daysAgo(19), analyzerVersion: "live-product-analyzer-v3" },
      businessAudit: { producedAt: daysAgo(18), upToDate: true },
      opportunitySet: { producedAt: daysAgo(18), stale: false },
    }),
    focus: IDLE,
    topMove: TOP_MOVE,
  },

  /**
   * Evidence sound and a Move ranked. Nova quotes the engine's own words; she
   * does not rank, re-word or add urgency to them.
   */
  "briefing-move-ready": {
    founderName: "Tobi",
    projectName: "Vibe Business",
    primaryGoal: "monetize",
    chain: sound(),
    focus: IDLE,
    topMove: TOP_MOVE,
  },

  /**
   * A project on its first day. Everything is absent rather than wrong, which
   * is why the rows stay neutral: painting a beginning amber would make an
   * alarm out of it.
   */
  "briefing-nothing-yet": {
    founderName: null,
    projectName: "Untitled product",
    primaryGoal: null,
    chain: {
      repositoryScan: null,
      liveScan: null,
      productProfile: null,
      businessAudit: null,
      opportunitySet: null,
    },
    focus: IDLE,
    topMove: null,
  },

  /**
   * Sound, and nothing ranked. The honest answer is that there is nothing to
   * say, and saying it is better than finding something.
   */
  "briefing-settled": {
    founderName: "Tobi",
    projectName: "Vibe Business",
    primaryGoal: "improve_retention",
    chain: sound(),
    focus: IDLE,
    topMove: null,
  },

  /**
   * Something is waiting on the founder above. The briefing points at it in
   * one clause rather than restating the Focus Card's sentence — two
   * components describing one open item in different words is how a founder
   * comes to believe there are two.
   */
  "briefing-waiting-above": {
    founderName: "Tobi",
    projectName: "Vibe Business",
    primaryGoal: "launch",
    chain: sound({ businessAudit: { producedAt: daysAgo(60), upToDate: true } }),
    focus: WAITING,
    topMove: null,
  },
  /**
   * The same situation as `briefing-audit-ageing`, with a sentence a model
   * wrote about it stored against its identity.
   *
   * Two things have to be visible here and neither is about the wording. The
   * live half — "Nothing is waiting on you right now" — is still Vibe's, in
   * front of the written half, because whether something is waiting moves by
   * the hour and is never written down. And the offer beneath is unchanged:
   * the model wrote a sentence, not a decision.
   */
  "briefing-spoken": {
    founderName: "Tobi",
    projectName: "Vibe Business",
    primaryGoal: "get_first_users",
    chain: sound({ businessAudit: { producedAt: daysAgo(5), upToDate: true } }),
    focus: IDLE,
    topMove: TOP_MOVE,
    spoken:
      "Your business audit has been sitting for about a week. There is nothing wrong with it — I just have not read your product since, so if anything has moved, running it again would give me something newer to go on.",
  },
} as const satisfies Record<string, Scenario>;

export const E2E_BRIEFING_SCENARIOS = SCENARIOS;
export type E2eBriefingScenario = keyof typeof SCENARIOS;

export function isE2eBriefingScenario(value: string): value is E2eBriefingScenario {
  return Object.hasOwn(SCENARIOS, value);
}

/**
 * The stored sentence for a scenario, when it has one.
 *
 * `undefined` is the ordinary case and means the panel shows `view.situation`
 * — Vibe's own words, which is what a founder sees until an operation finishes
 * and a durable step writes one.
 */
export function e2eBriefingVoice(scenario: E2eBriefingScenario): string | undefined {
  const fixture: Scenario = SCENARIOS[scenario];
  return fixture.spoken;
}

/** The view the panel renders, assembled by the code production uses. */
export function e2eBriefing(scenario: E2eBriefingScenario): BriefingView {
  const fixture = SCENARIOS[scenario];

  return buildBriefingView(
    buildNovaBriefing({
      founderName: fixture.founderName,
      projectName: fixture.projectName,
      primaryGoal: fixture.primaryGoal,
      chain: buildProvenanceChain(fixture.chain),
      focus: fixture.focus,
      topMove: fixture.topMove,
      now: NOW,
    }),
  );
}
