import { describe, expect, it } from "vitest";

import type { AuditCreditGate } from "../business-audit/entitlement";
import { creditsToUnits } from "../credits/units";
import { findCausalClaims } from "../business-measurement/causality";
import { ONBOARDING_STATES } from "../onboarding/state";
import { NOVA_ACTION_META } from "./actions";
import {
  buildNovaRevealFeed,
  buildNovaScanFeed,
  deriveNovaOnboarding,
  novaRevealBundlesAudit,
  novaRevealControls,
} from "./onboarding";

/**
 * The reveal's one real decision: what may ride along with "yes, that is
 * right".
 *
 * Every gate shape is exercised, because the rule being enforced is rule 60 —
 * a paid operation is never the side effect of a different question — and a
 * test that only checked the free path would pass on a version that bundled
 * the audit unconditionally.
 */

const GATES: Record<string, AuditCreditGate> = {
  not_applicable: { kind: "not_applicable" },
  payable: {
    kind: "payable",
    requiredCredits: creditsToUnits(35),
    availableCredits: creditsToUnits(200),
  },
  unaffordable: {
    kind: "unaffordable",
    requiredCredits: creditsToUnits(35),
    availableCredits: creditsToUnits(5),
  },
  unpriced: { kind: "unpriced" },
};

describe("which onboarding position Nova is narrating", () => {
  it("recognises the scan and the reveal", () => {
    expect(deriveNovaOnboarding("product_scanning")).toBe("scanning");
    expect(deriveNovaOnboarding("product_reveal")).toBe("reveal");
  });

  it("has nothing to add to every other state", () => {
    for (const state of ONBOARDING_STATES) {
      if (state === "product_scanning" || state === "product_reveal") continue;
      expect(deriveNovaOnboarding(state), state).toBe("elsewhere");
    }
  });
});

describe("what the reveal offers", () => {
  /** The whole point of §O.3: one press for one decision, while it is free. */
  it("bundles the audit when nothing is owed", () => {
    expect(novaRevealControls(GATES.not_applicable)).toEqual(["nova.confirm_product_and_audit"]);
    expect(novaRevealBundlesAudit(GATES.not_applicable)).toBe(true);
  });

  /**
   * Rule 60, stated as a sweep rather than as one case. Every gate that is not
   * `not_applicable` means Credits are involved, and none of them may put the
   * audit behind a question about whether Vibe read the product correctly —
   * including `unpriced`, where the amount is unknown, which is a worse reason
   * to bundle rather than a better one.
   */
  it.each(["payable", "unaffordable", "unpriced"])(
    "confirms only, and starts nothing, when the gate is %s",
    (kind) => {
      expect(novaRevealControls(GATES[kind])).toEqual(["nova.confirm_product"]);
      expect(novaRevealBundlesAudit(GATES[kind])).toBe(false);
    },
  );

  it("offers exactly one control whatever the gate says", () => {
    for (const [kind, gate] of Object.entries(GATES)) {
      expect(novaRevealControls(gate).length, kind).toBe(1);
    }
  });

  it("never puts a price on the confirmation itself", () => {
    for (const [kind, gate] of Object.entries(GATES)) {
      const choice = buildNovaRevealFeed(gate).find((entry) => entry.kind === "nova.choice");
      for (const option of choice?.options ?? []) {
        expect(option.price, `${kind}/${option.actionId}`).toBeNull();
        expect(option.requiresConfirmation, `${kind}/${option.actionId}`).toBe(false);
      }
    }
  });

  it("takes its labels from the catalog", () => {
    for (const gate of Object.values(GATES)) {
      const choice = buildNovaRevealFeed(gate).find((entry) => entry.kind === "nova.choice");
      for (const option of choice?.options ?? []) {
        expect(option.label).toBe(NOVA_ACTION_META[option.actionId].label);
      }
    }
  });

  /**
   * The bundled label has to say where the press leads, or the founder presses
   * "yes" and an audit they did not ask for begins. The free path is still a
   * disclosure even when the disclosure is not about money.
   */
  it("says where the bundled press leads", () => {
    expect(NOVA_ACTION_META["nova.confirm_product_and_audit"].label).toMatch(/audit/i);
    expect(NOVA_ACTION_META["nova.confirm_product"].label).not.toMatch(/audit/i);
  });
});

describe("what Nova says while reading and after", () => {
  const sentences = [...buildNovaScanFeed(), ...buildNovaRevealFeed(GATES.not_applicable)]
    .filter((entry) => entry.kind === "nova.message")
    .map((entry) => entry.text);

  it("offers nothing to decide while the scan runs", () => {
    expect(buildNovaScanFeed().some((entry) => entry.kind === "nova.choice")).toBe(false);
  });

  it("claims no causes", () => {
    expect(findCausalClaims("This change caused conversions to rise.")).not.toEqual([]);
    for (const text of sentences) expect(findCausalClaims(text), text).toEqual([]);
  });

  /**
   * The reveal is the one screen where Vibe describes a founder's own product
   * back to them, so it is where an overstatement would be least noticed and
   * most damaging. It says what was understood and invites a correction; it
   * does not claim the reading is right.
   */
  it("does not claim the reading is correct or complete", () => {
    for (const text of sentences) {
      expect(text).not.toMatch(/\b(correct|complete|accurate|everything|fully|exactly)\b/i);
    }
  });

  it("invites the correction rather than assuming there is none", () => {
    expect(sentences.join(" ")).toMatch(/wrong|correct me|tell me/i);
  });

  it("promises no deploy, ship, publish or release, and calls nothing safe", () => {
    for (const text of sentences) {
      expect(text).not.toMatch(
        /\b(deploy|deployed|ship|shipped|publish|published|release|released|go live|is live|safe)\b/i,
      );
    }
  });

  it("carries no figures", () => {
    for (const text of sentences) expect(text).not.toMatch(/\d/);
  });
});
