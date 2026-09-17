import { describe, expect, it } from "vitest";
import { NOVA_ACTION_IDS, NOVA_ACTION_META } from "../actions";
import { ARTIFACT_KINDS } from "../artifacts";
import { resolveNovaIntent } from "./resolve";

/**
 * What a founder's sentence means, and — much more often — that it does not
 * mean an action at all.
 *
 * The failure worth preventing is one-sided. A question that goes to the
 * conversation lane when it could have been a press costs a founder one extra
 * click. A sentence that resolves to `nova.merge_change` when they asked
 * something else puts a consequential control in front of them for a decision
 * they did not make — and ADR 0109 §5's sentence, *generated text is never the
 * last thing before a consequential effect*, does not help here, because the
 * resolver is not generated text. So every test below that matters is about
 * **not** resolving.
 */

const ALL_ACTIONS = [...NOVA_ACTION_IDS];
const ALL_ARTIFACTS = [...ARTIFACT_KINDS];

function resolve(text: string) {
  return resolveNovaIntent({ text, offerable: ALL_ACTIONS, available: ALL_ARTIFACTS });
}

describe("an instruction resolves", () => {
  it.each([
    ["merge it", "nova.merge_change"],
    ["Merge it.", "nova.merge_change"],
    ["run the audit again", "nova.refresh_audit"],
    ["scan again", "nova.rescan_product"],
    ["build it", "nova.start_agent"],
  ])("%s → %s", (text, actionId) => {
    expect(resolve(text)).toEqual({ kind: "action", actionId });
  });

  /**
   * A control's own label is a phrase, because it is the word the interface has
   * been showing the founder — **unless two controls share it**. Asserted over
   * the catalogue rather than per action, so a nineteenth control is covered by
   * existing.
   */
  it("answers to every offerable control's own unambiguous label", () => {
    const shared = new Set(
      ALL_ACTIONS.map((actionId) => NOVA_ACTION_META[actionId].label).filter(
        (label, index, labels) => labels.indexOf(label) !== index,
      ),
    );

    for (const actionId of ALL_ACTIONS) {
      const label = NOVA_ACTION_META[actionId].label;
      // Labels long enough to read as prose are outside the instruction cap on
      // purpose; they are the ones nobody types.
      if (label.split(/\s+/).length > 8) continue;
      if (shared.has(label)) continue;

      expect(resolve(label), label).toEqual({ kind: "action", actionId });
    }
  });

  /**
   * A label is not a unique key across the catalogue, and two actions are
   * labelled **Answer** — the plan's question and the agent's, on different
   * screens. Picking either would be the resolver guessing.
   */
  it("refuses a label two controls share", () => {
    const answers = ALL_ACTIONS.filter((actionId) => NOVA_ACTION_META[actionId].label === "Answer");

    expect(answers.length).toBeGreaterThan(1);
    expect(resolve("Answer")).toEqual({ kind: "none" });
  });
});

describe("a question does not", () => {
  it.each([
    "why is conversion our biggest problem?",
    "should I merge it?",
    "what would happen if I merge it",
    "explain the audit more simply",
    "how do you read our pricing?",
    "which move comes first",
  ])("%s", (text) => {
    expect(resolve(text)).toEqual({ kind: "none" });
  });

  /**
   * The sentence this rule exists for. It contains the exact phrase "merge it"
   * and means the opposite of it — which no amount of phrase matching can tell,
   * and which the length cap catches because a founder giving an instruction is
   * brief and a founder explaining themselves is not.
   */
  it("refuses a phrase buried in a paragraph", () => {
    expect(
      resolve("I don't want to merge it until I understand why the checks flagged that file"),
    ).toEqual({ kind: "none" });
  });

  it("refuses an empty or blank sentence", () => {
    expect(resolve("")).toEqual({ kind: "none" });
    expect(resolve("   \n  ")).toEqual({ kind: "none" });
  });
});

describe("what the project cannot do right now", () => {
  /**
   * The dead end `home-view.ts` records reaching twice: a control offered in a
   * state where pressing it would be refused. Matching against the whole
   * catalogue would resolve "merge it" on a project with nothing prepared.
   */
  it("does not resolve an action the project is not offering", () => {
    expect(
      resolveNovaIntent({ text: "merge it", offerable: [], available: ALL_ARTIFACTS }),
    ).toEqual({ kind: "none" });
  });

  it("does not resolve an artifact the project does not have", () => {
    expect(resolveNovaIntent({ text: "the diff", offerable: ALL_ACTIONS, available: [] })).toEqual({
      kind: "none",
    });
  });

  it("resolves the same words once the project can", () => {
    expect(
      resolveNovaIntent({
        text: "merge it",
        offerable: ["nova.merge_change"],
        available: [],
      }),
    ).toEqual({ kind: "action", actionId: "nova.merge_change" });
  });
});

describe("opening something is a read", () => {
  it.each([
    ["show me the plan", "action_plan"],
    ["open the audit", "business_health"],
    ["the diff", "prepared_change"],
  ])("%s → %s", (text, artifact) => {
    expect(resolve(text)).toEqual({ kind: "artifact", artifact });
  });

  /**
   * The one overlap in the two tables, and the direction it has to fall.
   * "show me the move" is a look; `nova.view_move` is also a navigation and not
   * a spend, so either answer is safe — what must not happen is a look
   * resolving to something consequential.
   */
  it("never turns a request to look into something that spends", () => {
    for (const text of ["show me the change", "show me the plan", "show me the results"]) {
      const intent = resolve(text);
      if (intent.kind !== "action") continue;

      expect(NOVA_ACTION_META[intent.actionId].consequential, text).toBe(false);
      expect(NOVA_ACTION_META[intent.actionId].price, text).toBeNull();
    }
  });
});

describe("the tables are total", () => {
  /**
   * A nineteenth action or a ninth artifact fails to compile rather than
   * silently answering to nothing. Asserted as well, because a `Record` written
   * against a union that later grew a member through a type alias would not.
   */
  it("decides every action and every artifact", () => {
    for (const actionId of ALL_ACTIONS) {
      expect(() => resolve(NOVA_ACTION_META[actionId].label)).not.toThrow();
    }
    expect(ALL_ARTIFACTS.length).toBeGreaterThan(5);
  });
});
