import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import { EMPTY_FOUNDER_INTENT } from "@/modules/projects/founder-intent";
import { selectBlockingQuestion, type PendingQuestion } from "@/modules/business-audit/needs-user";
import type { ProductProfile } from "@/modules/product-understanding/schema";

/**
 * Browser fixtures for "Vibe needs u" (CORE-2a.4 §30, §31, §47, §48).
 *
 * ## Why these come from the real gate
 *
 * Every question below is produced by `selectBlockingQuestion`, not written by
 * hand. A hand-written fixture would let the panel be tested against a question
 * shape the gate never actually emits — which is the exact failure CORE-2a.3.1
 * paid for, when an E2E fixture carried one finding per dimension and could
 * therefore never have caught the audit reading like a scan report.
 *
 * If the gate stops producing a question for one of these inputs, the fixture
 * throws rather than silently rendering nothing, and the suite fails loudly.
 */

function questionFor(input: {
  profile: ProductProfile;
  intent: Parameters<typeof selectBlockingQuestion>[0]["intent"];
}): PendingQuestion {
  const decision = selectBlockingQuestion({
    profile: input.profile,
    intent: input.intent,
    lenses: [],
    lensesReflectCurrentFacts: false,
    askedIntents: [],
  });

  if (!decision.ask) {
    throw new Error(
      "the needs-user fixture expected a blocking question and the gate withheld one",
    );
  }
  return decision.question;
}

/** A profile whose audience Vibe inferred rather than being told. */
function inferredAudience(value: string | null): ProductProfile {
  const profile = fakeProductProfile();
  return {
    ...profile,
    audience: {
      ...profile.audience,
      primaryAudience: {
        value,
        confidence: value === null ? "not_found" : "unclear",
        sources: ["ai_inferred"],
        evidence: [],
      },
    },
  };
}

export const E2E_NEEDS_USER_SCENARIOS = {
  /**
   * The wow case (§11). Vibe has worked out who it thinks the product is for
   * and says so, then asks the one thing it could not establish. Free text,
   * because a first customer is not a closed set.
   */
  needs_user_first_customer: (): PendingQuestion =>
    questionFor({
      profile: inferredAudience("Software founders and builders"),
      intent: {
        stage: "prototype",
        monetizationModel: "none",
        primaryGoal: "launch",
      },
    }),

  /**
   * The closed-vocabulary case: the answer is one of our own enum values, so
   * the panel must offer them rather than a text box that then fails
   * validation.
   */
  needs_user_stage: (): PendingQuestion =>
    questionFor({ profile: fakeProductProfile(), intent: EMPTY_FOUNDER_INTENT }),

  /**
   * §12 — nothing established, so no premise. The panel must show the question
   * with no context paragraph at all rather than a plausible-sounding filler
   * sentence, which is the failure mode that would read as Vibe understanding
   * something it does not.
   */
  needs_user_no_context: (): PendingQuestion => {
    const profile = fakeProductProfile();
    return questionFor({
      profile: {
        ...profile,
        identity: {
          ...profile.identity,
          understanding: { value: null, confidence: "not_found", sources: [], evidence: [] },
        },
      },
      intent: { stage: null, monetizationModel: "subscription", primaryGoal: "grow_revenue" },
    });
  },
} as const;

export type E2eNeedsUserScenario = keyof typeof E2E_NEEDS_USER_SCENARIOS;

export function isE2eNeedsUserScenario(value: string): value is E2eNeedsUserScenario {
  return value in E2E_NEEDS_USER_SCENARIOS;
}
