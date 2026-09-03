import { describe, expect, it } from "vitest";

import { RETAIL_OPERATION_KINDS, resolveRetailPrice } from "../credits/retail";
import { FOCUS_CANDIDATE_KINDS, NOVA_ACTION_IDS, novaCandidateAction } from "./focus";
import {
  NOVA_ACTION_META,
  OFFERABLE_NOVA_ACTION_IDS,
  isOfferable,
  novaActionMeta,
} from "./actions";

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

    for (const id of Object.keys(NOVA_ACTION_META)) {
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
});

describe("the control with nothing behind it", () => {
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

  it("keeps unbound ids out of what may be offered", () => {
    expect(OFFERABLE_NOVA_ACTION_IDS).not.toContain("nova.choose_workspace");
    expect(isOfferable("nova.choose_workspace")).toBe(false);
    expect(isOfferable("nova.merge_change")).toBe(true);
  });

  /**
   * The pairing that keeps the gap safe.
   *
   * `workspace_choice_required` is the only candidate whose control is
   * unbound, and `read.ts` cannot raise it — `workspaceChoiceRequired` is
   * fixed false until the resolver arrives. If either of those moves without
   * the other, this fails: a raisable candidate with no action is a founder
   * looking at a control that cannot be pressed.
   */
  it("leaves no offerable candidate pointing at an unbound control", () => {
    const unbound = FOCUS_CANDIDATE_KINDS.filter((kind) => {
      const id = novaCandidateAction(kind);
      return id !== null && !isOfferable(id);
    });

    expect(unbound).toEqual(["workspace_choice_required"]);
  });
});
