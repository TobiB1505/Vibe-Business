import { describe, expect, it } from "vitest";

import { RETAIL_OPERATION_KINDS, resolveRetailPrice } from "../credits/retail";
import { FOCUS_CANDIDATE_KINDS, novaCandidateAction } from "./focus";
import {
  NOVA_ACTION_IDS,
  NOVA_ACTION_META,
  OFFERABLE_NOVA_ACTION_IDS,
  isOfferable,
  novaActionMeta,
} from "./actions";
import type { NovaActionId } from "./actions";

/**
 * The catalog's own rules, asserted over every control at once.
 *
 * The point of holding labels and prices in one table rather than in the
 * screens that render them is that a rule can then be checked once instead of
 * per screen — and the rules below are the product's existing ones (rule 60 on
 * disclosure, rules 66 and 74 on what Vibe may claim), applied to the surface
 * that did not exist to break them yet.
 */

describe("the catalog covers the vocabulary", () => {
  it("gives every action id an entry", () => {
    for (const id of NOVA_ACTION_IDS) {
      expect(novaActionMeta(id), id).toBeDefined();
    }
  });

  it("names no action id the focus module does not have", () => {
    const known = new Set<string>(NOVA_ACTION_IDS);

    for (const id of Object.keys(NOVA_ACTION_META) as NovaActionId[]) {
      expect(known.has(id), `${id} is not a NovaActionId`).toBe(true);
    }
  });

  /**
   * The join that makes the catalog load-bearing: a candidate whose control has
   * no entry would render a button with no label, no price and no consequence.
   */
  it("has an entry for every control a candidate can carry", () => {
    for (const kind of FOCUS_CANDIDATE_KINDS) {
      const id = novaCandidateAction(kind);
      if (id === null) continue;
      expect(novaActionMeta(id), kind).toBeDefined();
    }
  });
});

describe("what a control may cost", () => {
  it("prices only in kinds the retail policy knows", () => {
    for (const id of NOVA_ACTION_IDS) {
      const { price } = novaActionMeta(id);
      if (price === null) continue;
      expect(RETAIL_OPERATION_KINDS as readonly string[], id).toContain(price);
    }
  });

  /**
   * Rule 60: a priced operation is never a side effect of a different
   * question. A control that charges is therefore one the founder pressed
   * knowing it charges — and if it charges, it is consequential by definition.
   *
   * "Charges" is read from the policy in force rather than from a list of
   * exceptions written here. `nova.rescan_product` is the case that makes the
   * difference: it names `product_understanding`, which is free today, so it
   * is honestly not consequential — and the day that price changes, this test
   * fails rather than continuing to skip a name someone hardcoded.
   */
  it("treats every control that charges as consequential", () => {
    for (const id of NOVA_ACTION_IDS) {
      const meta = novaActionMeta(id);
      if (meta.price === null) continue;

      const resolved = resolveRetailPrice(meta.price);
      expect(resolved, `${id} names a price no policy resolves`).not.toBeNull();
      if (resolved!.price.kind === "free" || resolved!.price.kind === "not_priced") continue;

      expect(meta.consequential, id).toBe(true);
    }
  });

  it("never charges for going to look at something", () => {
    for (const id of NOVA_ACTION_IDS) {
      const meta = novaActionMeta(id);
      if (meta.control !== "navigation") continue;
      expect(meta.price, id).toBeNull();
      expect(meta.consequential, id).toBe(false);
      expect(meta.requiresConfirmation, id).toBe(false);
    }
  });

  /**
   * A price in the words would be a second price, and the one in
   * `pricing.ts` is effective-dated. The label says what happens; the
   * interface says what it costs.
   */
  it("keeps figures out of the labels", () => {
    for (const id of NOVA_ACTION_IDS) {
      expect(novaActionMeta(id).label, id).not.toMatch(/\d/);
    }
  });
});

describe("what a control may promise", () => {
  /**
   * The same vocabulary `command-center-ui.test.ts` forbids on the agent
   * surface, applied to Nova's controls. Vibe opens no pull request, deploys
   * nothing and releases nothing; a button offering any of them would be
   * offering a mechanism that does not exist (rules 58, 74).
   */
  it("offers no pull request, deploy, ship, publish or release", () => {
    for (const id of NOVA_ACTION_IDS) {
      expect(novaActionMeta(id).label, id).not.toMatch(
        /\b(pull request|pr|deploy|deployed|ship|shipped|publish|published|release|released|go live|live)\b/i,
      );
    }
  });

  /** Nothing Vibe does is certified by pressing a button (rule 66). */
  it("claims nothing is safe, correct, fixed or done", () => {
    for (const id of NOVA_ACTION_IDS) {
      expect(novaActionMeta(id).label, id).not.toMatch(
        /\b(safe|safely|correct|guaranteed|bug-free|production ready)\b/i,
      );
    }
  });

  it("writes labels as something to do, not as a state reached", () => {
    for (const id of NOVA_ACTION_IDS) {
      const label = novaActionMeta(id).label;
      expect(label.length, id).toBeGreaterThan(3);
      expect(label, id).not.toMatch(/[.!?]$/);
    }
  });
});

describe("the two controls that touch a repository", () => {
  /**
   * Confirmation is reserved rather than sprinkled. `mergeApprovedChangeAction`
   * takes `confirmed` as a required argument, and a run pushes a branch and
   * spends between 150 and 350 Credits — these two, and nothing else, are worth
   * a second press.
   */
  it("confirms the merge and the build, and nothing else", () => {
    const confirmed = NOVA_ACTION_IDS.filter((id) => novaActionMeta(id).requiresConfirmation);

    expect([...confirmed].sort()).toEqual(["nova.merge_change", "nova.start_agent"]);
  });

  it("never asks for confirmation without a consequence", () => {
    for (const id of NOVA_ACTION_IDS) {
      const meta = novaActionMeta(id);
      if (!meta.requiresConfirmation) continue;
      expect(meta.consequential, id).toBe(true);
    }
  });

  /**
   * A confirmation with nothing to read is a speed bump, not a disclosure.
   * The founder is agreeing to something specific, and it has to be on screen
   * at the moment they agree.
   */
  it("says what is being agreed to, on both of them", () => {
    for (const id of NOVA_ACTION_IDS) {
      const meta = novaActionMeta(id);
      if (!meta.requiresConfirmation) continue;
      expect(meta.confirmationNote, id).toBeTruthy();
      expect(meta.confirmationNote!.length, id).toBeGreaterThan(40);
    }
  });

  it("explains nothing it does not ask about", () => {
    for (const id of NOVA_ACTION_IDS) {
      const meta = novaActionMeta(id);
      if (meta.requiresConfirmation) continue;
      expect(meta.confirmationNote, id).toBeUndefined();
    }
  });

  /**
   * The two notes must not be interchangeable, which is the whole reason they
   * are data rather than a sentence in the confirmation component: a build
   * does not move a default branch, and a merge does not spend Credits.
   */
  it("tells the two apart", () => {
    const merge = novaActionMeta("nova.merge_change").confirmationNote!;
    const build = novaActionMeta("nova.start_agent").confirmationNote!;

    expect(merge).toMatch(/default branch/i);
    expect(merge).not.toMatch(/credits/i);
    expect(build).toMatch(/credits/i);
    expect(build).toMatch(/untouched/i);
  });

  /** Moving a branch is not deploying, and the sentence may not imply it is. */
  it("promises no deployment in either note", () => {
    for (const id of NOVA_ACTION_IDS) {
      const note = novaActionMeta(id).confirmationNote;
      if (note === undefined) continue;
      expect(note, id).not.toMatch(
        /\b(deploy|deployed|ship|shipped|publish|published|release|released|go live|live|safe)\b/i,
      );
    }
  });
});

describe("an unbound control, should one appear again", () => {
  it("says why it is unbound", () => {
    for (const id of NOVA_ACTION_IDS) {
      const meta = novaActionMeta(id);
      if (meta.control !== "unbound") continue;
      expect(meta.unboundReason, id).toBeTruthy();
    }
  });

  it("explains itself only when it is actually unbound", () => {
    for (const id of NOVA_ACTION_IDS) {
      const meta = novaActionMeta(id);
      if (meta.control === "unbound") continue;
      expect(meta.unboundReason, id).toBeUndefined();
    }
  });

  /**
   * Nothing is unbound today — Stage 4 closed the last gap. The mechanism
   * stays because the situation recurs: an id is worth cataloguing before its
   * action exists, and `isOfferable` is what keeps such an id off a screen in
   * the meantime.
   */
  it("offers every id, now that every id has something behind it", () => {
    expect([...OFFERABLE_NOVA_ACTION_IDS].sort()).toEqual([...NOVA_ACTION_IDS].sort());
    for (const id of NOVA_ACTION_IDS) expect(isOfferable(id), id).toBe(true);
  });

  /**
   * The invariant that made the gap safe, kept now that there is no gap.
   *
   * It held one entry — `workspace_choice_required`, whose action lived on the
   * Stage 4 branch — and this is the test that failed the moment that branch
   * merged, which is what a claim about the outside world is supposed to do.
   * A candidate Nova can raise must never point at a control nobody can press.
   */
  it("leaves no candidate pointing at a control that cannot be pressed", () => {
    const unbound = FOCUS_CANDIDATE_KINDS.filter((kind) => {
      const id = novaCandidateAction(kind);
      return id !== null && !isOfferable(id);
    });

    expect(unbound).toEqual([]);
  });
});
