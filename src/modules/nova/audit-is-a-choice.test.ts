import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NOVA_ACTION_META, isOfferable } from "./actions";
import { NOVA_ACTION_IDS } from "./actions";
import { buildNovaFeed } from "./feed";
import { FOCUS_CANDIDATE_KINDS, deriveNovaFocus, novaCandidateAction } from "./focus";
import type { NovaFocusFacts } from "./focus";

/**
 * That Vibe never starts a paid operation on a founder's behalf (rule 60).
 *
 * §L names this as Slice 5's invariant, and Nova is where it is easiest to
 * break: a feed whose job is to remove decisions is one edit away from
 * removing the decision that costs 35 Credits. So the rule is asserted from
 * three directions — what a candidate can carry, what an entry can render, and
 * what the module is allowed to import.
 */

function quiet(): NovaFocusFacts {
  return {
    sourceDisconnected: false,
    failedOperations: { agent: false, scan: false, audit: false },
    changes: [],
    questions: [],
    moves: [],
    plannedMoveId: null,
    executableStep: null,
    planOffered: false,
    auditOutdated: false,
    repositoryReadOutdated: false,
    workspaceChoiceRequired: false,
    working: null,
  };
}

describe("a priced operation is always a press", () => {
  /**
   * The audit is the case this slice is about, and the shape generalises: a
   * candidate is a thing to *offer*, so every priced control reaches a founder
   * as an option they can decline.
   */
  it("offers the audit as a control rather than doing it", () => {
    const focus = deriveNovaFocus({ ...quiet(), auditOutdated: true });
    const entries = buildNovaFeed(focus);
    const choice = entries.find((entry) => entry.kind === "nova.choice");

    expect(focus.primary.kind).toBe("audit_outdated");
    expect(choice).toMatchObject({ options: [{ actionId: "nova.refresh_audit" }] });
  });

  /**
   * And the price travels with it. `CreditPrice` renders today's amount from
   * the kind; what must never happen is a priced control arriving at a screen
   * with nothing to render, because then the founder presses a button whose
   * cost the interface had no way to state.
   */
  it("carries a price on every control that charges", () => {
    for (const kind of FOCUS_CANDIDATE_KINDS) {
      const actionId = novaCandidateAction(kind);
      if (actionId === null || !isOfferable(actionId)) continue;

      const meta = NOVA_ACTION_META[actionId];
      if (!meta.consequential) continue;
      if (meta.price === null) continue;

      expect(meta.price, `${kind} charges with nothing for CreditPrice to show`).toBeTruthy();
    }
  });

  /**
   * Nova's own two priced controls, named. A third appearing without a
   * deliberate decision is what this asserts against — `verify_outcome` and
   * `merge_change` are consequential and free, and the distinction is the
   * point.
   */
  it("prices exactly the controls that spend Credits", () => {
    const priced = NOVA_ACTION_IDS.filter((id) => NOVA_ACTION_META[id].price !== null);

    expect([...priced].sort()).toEqual([
      "nova.plan_move",
      "nova.refresh_audit",
      "nova.rescan_product",
      "nova.start_agent",
    ]);
  });
});

describe("no Nova module starts an operation itself", () => {
  const MODULES = ["focus.ts", "feed.ts", "read.ts", "actions.ts", "first-run.ts", "onboarding.ts"];

  function source(file: string): string {
    return readFileSync(join(process.cwd(), "src/modules/nova", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
  }

  /**
   * The strongest form of rule 60 available here: not "Nova does not call
   * these today" but "Nova cannot", because the functions that start paid work
   * are not reachable from any of these files. A future edit that wanted to
   * would have to add the import, which is a visible act rather than a line
   * buried in a branch.
   */
  it.each(MODULES)("%s reaches for no operation starter", (file) => {
    const body = source(file);

    for (const starter of [
      "startBusinessAuditOperation",
      "startOpportunityOperation",
      "startProductScanOperation",
      "startAgentExecution",
      "holdOperationCredits",
      "VercelWorkflowExecutor",
    ]) {
      expect(body, `${file} calls ${starter}`).not.toContain(starter);
    }
  });

  /** And writes nothing at all: a read model with a side effect is not one. */
  it.each(MODULES)("%s writes nothing", (file) => {
    const body = source(file);

    for (const write of [".insert(", ".upsert(", ".delete(", "recordAuditEvent("]) {
      expect(body, `${file} performs ${write}`).not.toContain(write);
    }
  });
});
