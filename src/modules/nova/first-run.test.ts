import { describe, expect, it } from "vitest";

import { checkedValues } from "@/modules/operations/migration-test-support";

import { findCausalClaims } from "../business-measurement/causality";
import { ONBOARDING_STATES } from "../onboarding/state";

import { NOVA_ACTION_META } from "./actions";
import {
  NAME_QUESTION,
  NOVA_WORKFLOW_STATUSES,
  buildNovaFirstRunFeed,
  buildNovaWorkflowExplanation,
  deriveNovaFirstRun,
} from "./first-run";
import type { NovaFirstRunFacts, NovaFirstRunPosition } from "./first-run";

/**
 * Nova's first run: the cascade, and the words.
 *
 * The cascade is four lines, and every one of them is a decision about what a
 * founder sees on the first screen they ever see of this product. The words
 * are held to the same rules as the rest of Nova's copy — with one extra,
 * because an introduction is exactly where a product is most tempted to
 * describe what it will achieve rather than what it does.
 */

function facts(overrides: Partial<NovaFirstRunFacts> = {}): NovaFirstRunFacts {
  return {
    onboardingState: "add_live_product",
    novaIntroducedAt: null,
    novaWorkflowStatus: "unseen",
    ...overrides,
  };
}

const INTRODUCED = "2026-09-03T10:00:00.000Z";

describe("the status vocabulary", () => {
  /**
   * The TypeScript union and the SQL CHECK are two statements of one rule, and
   * only this test makes them the same one. A value the database refuses is a
   * runtime error wearing a compile-time type.
   */
  it("is exactly what the database will accept", () => {
    expect(checkedValues("project_onboarding", "nova_workflow_status").sort()).toEqual(
      [...NOVA_WORKFLOW_STATUSES].sort(),
    );
  });

  it("keeps skipped as a value rather than an absence", () => {
    expect(NOVA_WORKFLOW_STATUSES).toContain("skipped");
  });
});

describe("where the first run has got to", () => {
  /**
   * Before the first setup step, not after it.
   *
   * This asserted the opposite: `connect_source` short-circuited to
   * `before_source` and Nova said nothing, on the argument that an
   * introduction over an empty project is hello about nothing.
   *
   * It reads the introduction as being about the project. It is about her —
   * what she does, and that nothing reaches a default branch without the
   * founder saying yes — and neither sentence needs a repository. The old
   * order asked a stranger to connect their code before telling them who was
   * asking.
   */
  it("introduces Nova before anything is connected", () => {
    expect(deriveNovaFirstRun(facts({ onboardingState: "connect_source" }))).toBe("introduce");
  });

  /**
   * And wherever else a project happens to be — the columns are new, so an
   * existing project can be at any state without an introduction. They get it
   * where they are rather than never.
   */
  it("introduces Nova whatever else has happened", () => {
    for (const onboardingState of ONBOARDING_STATES) {
      expect(deriveNovaFirstRun(facts({ onboardingState })), onboardingState).toBe("introduce");
    }
  });

  it("offers the walkthrough after the introduction", () => {
    expect(deriveNovaFirstRun(facts({ novaIntroducedAt: INTRODUCED }))).toBe("explain_workflow");
  });

  it.each(["explained", "skipped"] as const)("hands off once the founder has said %s", (status) => {
    const position = deriveNovaFirstRun(
      facts({ novaIntroducedAt: INTRODUCED, novaWorkflowStatus: status }),
    );

    expect(position).toBe("handoff");
  });

  /**
   * The point of a status rather than a timestamp: skipping is an answer, and
   * a founder who skipped is not asked again. A nullable
   * `nova_workflow_explained_at` would have had to lie in one direction or the
   * other here.
   */
  it("does not ask again after a skip", () => {
    const after = deriveNovaFirstRun(
      facts({ novaIntroducedAt: INTRODUCED, novaWorkflowStatus: "skipped" }),
    );

    expect(after).not.toBe("explain_workflow");
  });

  /**
   * The onboarding state no longer gates her own two positions at all.
   *
   * It stays on the facts because `handoff` is still the answer for a project
   * that has met her, and because a caller passing it is a caller that has
   * already derived it — but no value of it can now silence the introduction.
   */
  it("lets no onboarding state suppress the first run", () => {
    const everyCombination: NovaFirstRunFacts[] = ONBOARDING_STATES.flatMap((onboardingState) =>
      NOVA_WORKFLOW_STATUSES.flatMap((status) =>
        [null, INTRODUCED].map((introducedAt) =>
          facts({
            onboardingState,
            novaIntroducedAt: introducedAt,
            novaWorkflowStatus: status,
          }),
        ),
      ),
    );

    for (const combination of everyCombination) {
      const position = deriveNovaFirstRun(combination);
      const expected =
        combination.novaIntroducedAt === null
          ? "introduce"
          : combination.novaWorkflowStatus === "unseen"
            ? "explain_workflow"
            : "handoff";

      expect(position, combination.onboardingState).toBe(expected);
    }
  });
});

describe("what Nova says on her own two screens", () => {
  const POSITIONS: NovaFirstRunPosition[] = ["introduce", "explain_workflow", "handoff"];

  it("says nothing where the screen is not hers", () => {
    expect(buildNovaFirstRunFeed("handoff")).toEqual([]);
  });

  it("introduces herself and offers one way on", () => {
    const entries = buildNovaFirstRunFeed("introduce");
    const choices = entries.filter((entry) => entry.kind === "nova.choice");

    expect(entries.filter((entry) => entry.kind === "nova.message").length).toBeGreaterThan(0);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ options: [{ actionId: "nova.continue_introduction" }] });
  });

  it("offers the walkthrough and the way past it", () => {
    const choice = buildNovaFirstRunFeed("explain_workflow").find(
      (entry) => entry.kind === "nova.choice",
    );

    expect(choice?.options.map((option) => option.actionId)).toEqual([
      "nova.explain_workflow",
      "nova.skip_workflow",
    ]);
  });

  it("charges for nothing and confirms nothing on either screen", () => {
    for (const position of POSITIONS) {
      for (const entry of buildNovaFirstRunFeed(position)) {
        if (entry.kind !== "nova.choice") continue;
        for (const option of entry.options) {
          expect(option.price, option.actionId).toBeNull();
          expect(option.consequential, option.actionId).toBe(false);
          expect(option.requiresConfirmation, option.actionId).toBe(false);
        }
      }
    }
  });

  it("takes its labels from the catalog rather than writing its own", () => {
    for (const position of POSITIONS) {
      for (const entry of buildNovaFirstRunFeed(position)) {
        if (entry.kind !== "nova.choice") continue;
        for (const option of entry.options) {
          expect(option.label, option.actionId).toBe(NOVA_ACTION_META[option.actionId].label);
        }
      }
    }
  });

  it("gives every entry a unique id", () => {
    const ids = [
      ...POSITIONS.flatMap((position) => buildNovaFirstRunFeed(position).map((entry) => entry.id)),
      ...buildNovaWorkflowExplanation().map((entry) => entry.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The control that records `explained` has to explain something, or the
   * column records an explanation that did not happen — the same defect §O.5
   * rejected, pointing the other way.
   */
  it("actually explains the loop when asked to", () => {
    const entries = buildNovaWorkflowExplanation();

    expect(entries.filter((entry) => entry.kind === "nova.message").length).toBeGreaterThanOrEqual(
      3,
    );
  });

  /**
   * And it ends with the press that records having been shown it.
   *
   * The walkthrough used to end in nothing: the write fired when it opened, so
   * by the time the sentences were on screen the position had already moved on
   * and there was no control under them. One action id, at the bottom, is what
   * makes the record true at the moment it is written.
   */
  it("ends with the control that records it, and only that one", () => {
    const choices = buildNovaWorkflowExplanation().filter((entry) => entry.kind === "nova.choice");

    expect(choices).toHaveLength(1);
    expect(choices[0]?.options.map((option) => option.actionId)).toEqual(["nova.begin_setup"]);
    /* Last, so it cannot be pressed before the thing it records was shown. */
    expect(buildNovaWorkflowExplanation().at(-1)?.kind).toBe("nova.choice");
  });
});

describe("the language of an introduction", () => {
  const sentences = [
    /*
      Both introductions, because they are not the same set of sentences: the
      one that asks what to call somebody has a sentence the other does not,
      and a sweep that only built the default would have let the newest thing
      Nova says be the one thing nothing checked. That is the exact shape this
      file's own docblock warns about upstream.
    */
    ...(["introduce", "explain_workflow"] as const).flatMap((position) =>
      buildNovaFirstRunFeed(position)
        .filter((entry) => entry.kind === "nova.message")
        .map((entry) => entry.text),
    ),
    ...buildNovaFirstRunFeed("introduce", null, true)
      .filter((entry) => entry.kind === "nova.message")
      .map((entry) => entry.text),
    ...buildNovaWorkflowExplanation().map((entry) =>
      entry.kind === "nova.message" ? entry.text : "",
    ),
  ];

  it("has something to say on both screens", () => {
    expect(sentences.length).toBeGreaterThanOrEqual(3);
  });

  it("claims no causes", () => {
    expect(findCausalClaims("This change caused conversions to rise.")).not.toEqual([]);

    for (const text of sentences) expect(findCausalClaims(text), text).toEqual([]);
  });

  /**
   * The introduction is where a product describes itself, and the temptation
   * is to describe an outcome. Nova says what she does; growth, revenue and
   * success are things nobody has measured for this founder yet.
   */
  it("promises no outcome", () => {
    for (const text of sentences) {
      expect(text).not.toMatch(
        /\b(grow|growth|revenue|success|succeed|guarantee|guaranteed|best|fastest|better)\b/i,
      );
    }
  });

  it("promises no deploy, ship, publish or release", () => {
    for (const text of sentences) {
      expect(text).not.toMatch(
        /\b(deploy|deployed|ship|shipped|publish|published|release|released|go live|is live)\b/i,
      );
    }
  });

  it("calls nothing safe or correct", () => {
    for (const text of sentences) {
      expect(text).not.toMatch(/\b(safe|safely|correct|bug-free|production ready)\b/i);
    }
  });

  it("carries no figures", () => {
    for (const text of sentences) expect(text).not.toMatch(/\d/);
  });

  /**
   * The one promise the introduction *does* make, because it is the one Vibe
   * actually keeps: nothing reaches a default branch without a person saying
   * yes (rules 58, 67–74). A first screen that left it out would be selling an
   * autonomous agent, which this is not.
   */
  it("says who decides what ships", () => {
    expect(sentences.join(" ")).toMatch(/default branch/i);
  });
});

describe("asking what to call somebody", () => {
  const messages = (name: string | null, ask: boolean) =>
    buildNovaFirstRunFeed("introduce", name, ask)
      .filter((entry) => entry.kind === "nova.message")
      .map((entry) => entry.text);

  it("asks only when asked to", () => {
    expect(messages(null, false)).not.toContain(NAME_QUESTION);
    expect(messages(null, true)).toContain(NAME_QUESTION);
  });

  /*
   * The case this step exists for. A GitHub login is a name somebody chose,
   * so she greets by it — and it is not what anybody is *called*, so she still
   * asks. Greeting and asking are two different questions about one person,
   * and a screen that used the login as an answer to both would be reading a
   * database out loud.
   */
  it("greets by a login and still asks what to call somebody", () => {
    const said = messages("ada-lovelace", true);
    expect(said[0]).toContain("ada-lovelace");
    expect(said).toContain(NAME_QUESTION);
  });

  it("does not ask somebody who has already said", () => {
    expect(messages("Tobi", false)).not.toContain(NAME_QUESTION);
  });

  /* Last, after everything she says about herself: a question before the
     introduction is a form, after it is what two people do. */
  it("asks after she has finished introducing herself", () => {
    const said = messages(null, true);
    expect(said[said.length - 1]).toBe(NAME_QUESTION);
  });
});
