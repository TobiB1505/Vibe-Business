import { describe, expect, it } from "vitest";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import {
  EXECUTABLE_SUPPORT,
  EXECUTION_SUPPORT,
  STEP_ACTORS,
  type ExecutionSupport,
  type StepActor,
} from "./schema";
import { isFounderAttestable } from "./completion";
import { CAPABILITY_REGISTRY } from "./capability-registry";

/**
 * Every step the planner can emit has a way to be finished.
 *
 * ## The failure this exists to catch, in the form it actually took
 *
 * A plan is a sequence, and one step nothing can close stops the whole thing.
 * That is not a hypothesis — it shipped. `external_party` had no completion
 * authority ([ADR 0055](../../../docs/decisions/0055-founder-action-attestation-evidence.md)
 * deferred it), and the screen rendered a step marked **Start here** with no
 * control at all, while the panel two lines below said *"needs from you:
 * nothing right now"*. Every step depending on it waited forever, and the plan
 * could never reach `finished`.
 *
 * Nothing failed. Every unit test passed, every browser test passed, and the
 * hole was only visible by rendering that one state and reading it. The same
 * shape as the handoff bugs before it: the pieces were each correct, and no
 * test asked the question the *product* asks — can the founder get from here to
 * the end?
 *
 * ## Why this is exhaustive rather than a list of cases
 *
 * It walks the actual cross product of `STEP_ACTORS` and `EXECUTION_SUPPORT`,
 * so a new actor or a new support value arrives here as a failure rather than
 * as a silent gap. Each pairing has to name which authority finishes it, or say
 * the planner cannot produce it at all — and the difference between those two
 * is the whole point, because `external_party` was the first and looked like
 * the second.
 *
 * `changeKind` is deliberately not in the product. It changes *what closing
 * records* — a measurement writes its result, a setup step does not — but never
 * *whether* a step can close, with the single exception of `vibe` +
 * `product_change`, which is asserted on its own below because it is the one
 * pairing whose answer is "an execution, or a handoff, and never a bare tick".
 */

/** Which authority finishes a step, given who acts and what Vibe can run. */
type ClosingAuthority =
  /** An agent run, and only its own evidence (ADR 0054). */
  | "execution"
  /** The founder answers, and a durable statement is written (ADR 0053). */
  | "founder_resolution"
  /** The founder's word, against the immutable step (ADR 0055, 0090, 0098). */
  | "founder_attestation"
  /** Vibe refuses, hands out a prompt, and the founder's word closes it (ADR 0097). */
  | "handoff_then_attestation";

/**
 * Nothing finishes this pairing, and the planner cannot produce it either.
 *
 * Kept as an explicit value rather than an omission, so a genuinely unclosable
 * pairing and a merely impossible one cannot be confused — the first is a bug
 * and the second is a fact about the schema.
 */
const IMPOSSIBLE = "impossible" as const;

const CLOSES: Record<StepActor, Record<ExecutionSupport, ClosingAuthority | typeof IMPOSSIBLE>> = {
  vibe: {
    // The only support that means a registry capability matched.
    vibe_executes_now: "execution",
    // Vibe's own reasoning. No run produces it, so the founder writes down what
    // it produced and the step closes on that (ADR 0093).
    vibe_prepares: "founder_attestation",
    // A product change Vibe cannot run. Either the agent becomes able to, or
    // Vibe refuses and hands out the prompt — never a bare confirmation, which
    // is the exclusion ADR 0090 exists to hold.
    not_yet_supported: "handoff_then_attestation",
    founder_decides: IMPOSSIBLE,
    founder_provides_input: IMPOSSIBLE,
    founder_acts: IMPOSSIBLE,
    external_dependency: IMPOSSIBLE,
  },
  founder_decision: {
    founder_decides: "founder_resolution",
    vibe_executes_now: IMPOSSIBLE,
    vibe_prepares: IMPOSSIBLE,
    founder_provides_input: IMPOSSIBLE,
    founder_acts: IMPOSSIBLE,
    external_dependency: IMPOSSIBLE,
    not_yet_supported: IMPOSSIBLE,
  },
  founder_input: {
    founder_provides_input: "founder_resolution",
    vibe_executes_now: IMPOSSIBLE,
    vibe_prepares: IMPOSSIBLE,
    founder_decides: IMPOSSIBLE,
    founder_acts: IMPOSSIBLE,
    external_dependency: IMPOSSIBLE,
    not_yet_supported: IMPOSSIBLE,
  },
  founder_action: {
    founder_acts: "founder_attestation",
    vibe_executes_now: IMPOSSIBLE,
    vibe_prepares: IMPOSSIBLE,
    founder_decides: IMPOSSIBLE,
    founder_provides_input: IMPOSSIBLE,
    external_dependency: IMPOSSIBLE,
    not_yet_supported: IMPOSSIBLE,
  },
  external_party: {
    // The authority ADR 0055 deferred and ADR 0098 defined: the founder's own
    // eyes, because Vibe has no integration that watches an index or a queue.
    external_dependency: "founder_attestation",
    vibe_executes_now: IMPOSSIBLE,
    vibe_prepares: IMPOSSIBLE,
    founder_decides: IMPOSSIBLE,
    founder_provides_input: IMPOSSIBLE,
    founder_acts: IMPOSSIBLE,
    not_yet_supported: IMPOSSIBLE,
  },
};

describe("every step the planner can emit has a way to be finished", () => {
  it.each(STEP_ACTORS)("%s pairs every support with an authority or with nothing", (actor) => {
    /*
     * The cross product, walked rather than listed. A new actor or a new
     * support value lands here as a missing key, which is a compile error, and
     * a pairing somebody forgot to think about lands as an undefined lookup.
     */
    for (const support of EXECUTION_SUPPORT) {
      expect(CLOSES[actor][support], `${actor} + ${support}`).toBeDefined();
    }
  });

  it("leaves no actor the plan cannot get past", () => {
    /*
     * The assertion the `external_party` hole failed, in the form it failed.
     *
     * Before ADR 0098 that actor had exactly one reachable pairing and nothing
     * closed it, so the actor as a whole was a wall: any plan the planner gave
     * one to stopped there, permanently, whatever else was in it. An actor
     * every one of whose pairings is `IMPOSSIBLE` is either that wall or a
     * vocabulary entry nothing emits — and both are worth failing on, because
     * the second means the planner may name an actor the product cannot serve.
     */
    const walls = STEP_ACTORS.filter((actor) =>
      EXECUTION_SUPPORT.every((support) => CLOSES[actor][support] === IMPOSSIBLE),
    );

    expect(walls).toEqual([]);
  });

  it("agrees with `isFounderAttestable` about who the founder may close", () => {
    /*
     * The table above is a claim; this is the code that decides. They are
     * asserted against each other because a table nobody checks is a comment,
     * and the comment is exactly what was wrong before — `completion.ts` said
     * an external dependency "contributes nothing until its own authority
     * exists", and it stayed true for months after the screen made it a defect.
     */
    for (const actor of STEP_ACTORS) {
      for (const support of EXECUTION_SUPPORT) {
        const expected = CLOSES[actor][support];
        if (expected === IMPOSSIBLE) continue;

        // A `vibe` product change needs its handoff, which the pairing alone
        // cannot express — it is asserted on its own below.
        if (expected === "handoff_then_attestation") continue;

        /*
         * The change kind follows from the pairing rather than being picked.
         * `vibe_executes_now` is reachable *only* through the capability
         * registry, and every entry there lists `product_change` and nothing
         * else — so a `vibe_executes_now` step is a product change by
         * construction, and building one with any other kind would be testing a
         * step the classifier cannot emit.
         */
        const step = fakePlanStep({
          id: `${actor}-${support}`,
          actor,
          changeKind: EXECUTABLE_SUPPORT.includes(support)
            ? "product_change"
            : actor === "vibe"
              ? "analysis"
              : "external_setup",
          executionSupport: support,
          capability: EXECUTABLE_SUPPORT.includes(support) ? "nextjs_seo_foundations_v2" : null,
        });

        expect(isFounderAttestable(step), `${actor} + ${support}`).toBe(
          expected === "founder_attestation",
        );
      }
    }
  });

  it("only ever gives an executable step a product change to make", () => {
    /*
     * The fact the case above rests on, asserted rather than assumed. If a
     * capability ever listed another change kind, `vibe_executes_now` would
     * become reachable for a step `isFounderAttestable` says the founder may
     * close — two authorities over one step, which is the ambiguity ADR 0054
     * built separate evidence to avoid.
     */
    for (const entry of CAPABILITY_REGISTRY) {
      expect(entry.changeKinds, entry.capability).toEqual(["product_change"]);
    }
  });

  it("keeps a product change closable only by a run or by a handoff", () => {
    /*
     * The one line that must never move (ADR 0090). Everything else in this
     * file is about opening dead ends; this is the dead end that is on purpose,
     * because a founder confirming a product change would be confirming away
     * the work Vibe exists to build.
     */
    const step = fakePlanStep({
      id: "vibe-product-change",
      actor: "vibe",
      changeKind: "product_change",
      executionSupport: "not_yet_supported",
      capability: null,
    });

    expect(isFounderAttestable(step)).toBe(false);
    expect(isFounderAttestable(step, new Set(["vibe-product-change"]))).toBe(true);
  });
});
