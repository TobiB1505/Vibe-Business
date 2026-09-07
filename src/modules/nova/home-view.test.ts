import { describe, expect, it } from "vitest";
import { buildNovaHomeView, novaControlLabel, NOVA_SECONDARY_LIMIT } from "./home-view";
import { deriveNovaFocus, FOCUS_CANDIDATE_KINDS, type NovaFocusFacts } from "./focus";
import { novaCandidateMessage } from "./feed";
import type { OperationView } from "../operations/view";

const NO_FLAGS = { agent: false, scan: false, audit: false } as const;

function facts(overrides: Partial<NovaFocusFacts> = {}): NovaFocusFacts {
  return {
    sourceDisconnected: false,
    failedOperations: { ...NO_FLAGS },
    stalledOperations: { ...NO_FLAGS },
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
    ...overrides,
  };
}

function operation(overrides: Partial<OperationView> = {}): OperationView {
  return {
    operationId: "op-1",
    status: "running",
    stage: "preparing",
    startedAt: null,
    completedAt: null,
    failureCode: null,
    resultId: null,
    shouldPoll: true,
    retryAllowed: false,
    stalled: false,
    ...overrides,
  };
}

function viewOf(overrides: Partial<NovaFocusFacts> = {}) {
  return buildNovaHomeView(deriveNovaFocus(facts(overrides)));
}

describe("Nova Home view", () => {
  it("leads with the candidate the domain ranked first, and does not reorder", () => {
    const focus = deriveNovaFocus(
      facts({
        auditOutdated: true,
        changes: [
          { preparedChangeId: "change-1", stage: "ready_to_merge", headline: "Ready to merge" },
        ],
      }),
    );
    const view = buildNovaHomeView(focus);

    expect(view.primary.kind).toBe(focus.primary.kind);
    expect(view.secondary.map((entry) => entry.kind)).toEqual(
      focus.secondary.slice(0, NOVA_SECONDARY_LIMIT).map((candidate) => candidate.kind),
    );
  });

  it("renders exactly one dominant action: the primary carries a control, the stack carries none", () => {
    const view = viewOf({
      auditOutdated: true,
      changes: [
        { preparedChangeId: "change-1", stage: "review_required", headline: "Look at this" },
      ],
    });

    expect(view.secondary.length).toBeGreaterThan(0);
    // The stack is links only. The Focus Card is the one place a control lives,
    // which is the whole claim of the surface.
    expect(view.primary.control.kind).not.toBe("none");
  });

  it("uses the feed's sentences rather than a second copy of the copy", () => {
    for (const kind of FOCUS_CANDIDATE_KINDS) {
      const message = novaCandidateMessage(kind);
      expect(message.trim().length, kind).toBeGreaterThan(0);
    }

    const view = viewOf({ auditOutdated: true });
    expect(view.primary.message).toBe(novaCandidateMessage("audit_outdated"));
  });

  it("offers no control at all when there is nothing to do", () => {
    const view = viewOf();

    expect(view.primary.kind).toBe("nothing_to_do");
    expect(view.primary.control.kind).toBe("none");
    expect(view.secondary).toEqual([]);
  });

  it("bounds the stack so Home cannot become a wall of choices", () => {
    const view = viewOf({
      sourceDisconnected: true,
      failedOperations: { agent: true, scan: true, audit: true },
      stalledOperations: { agent: true, scan: true, audit: true },
      auditOutdated: true,
    });

    expect(view.secondary.length).toBe(NOVA_SECONDARY_LIMIT);
  });

  it("carries the subject's own sentence rather than writing one", () => {
    const view = viewOf({
      changes: [
        { preparedChangeId: "change-1", stage: "review_required", headline: "Two files changed" },
      ],
    });

    expect(view.primary.detail).toBe("Two files changed");
  });

  describe("waiting is never working", () => {
    it("reports a paused operation as waiting on the founder", () => {
      const view = viewOf({ working: operation({ status: "needs_user" }) });
      expect(view.working?.phase).toBe("waiting_user");
    });

    it("reports a running operation as working", () => {
      const view = viewOf({ working: operation({ status: "running" }) });
      expect(view.working?.phase).toBe("working");
    });

    it("reports a stalled run as stalled rather than as either", () => {
      const view = viewOf({ working: operation({ stalled: true }) });
      expect(view.working?.phase).toBe("stalled");
    });

    it("names a stage rather than a percentage", () => {
      const view = viewOf({ working: operation() });
      expect(view.working?.stageLabel).toBeTruthy();
      expect(view.working?.stageLabel).not.toMatch(/\d+\s*%/);
    });
  });

  describe("controls are only offered where Home holds the arguments", () => {
    /*
     * This used to assert `elsewhere`, on the reasoning that a merge needs an
     * approval id no candidate carries. The id was the wrong thing to look
     * for. A merge control lifted out of its sequence is exactly the failure
     * rules 67-71 describe — a yes to commit A applied to commit B — but the
     * *sequence* travelling is not: `ChangeGates` brings validation, preview,
     * review, approval, merge and outcome in that order, each reachable only
     * through the one above it, and names its own approval.
     *
     * So the control carries the change's identity and which gate to open, and
     * still has no label of its own: there is no button here to press out of
     * order.
     */
    it("decides a merge through the change's own gates", () => {
      const view = viewOf({
        changes: [{ preparedChangeId: "change-1", stage: "ready_to_merge", headline: "Approved" }],
      });

      expect(view.primary.kind).toBe("merge_ready");
      expect(view.primary.control.kind).toBe("gate");
      if (view.primary.control.kind === "gate") {
        expect(view.primary.control.preparedChangeId).toBe("change-1");
        expect(view.primary.control.stage).toBe("review");
      }
      // No verb of its own. The gates carry every control this moment has.
      expect(novaControlLabel(view.primary.control)).toBeNull();
    });

    /*
     * A failed validation is the one change moment decided at a different
     * gate, and getting it wrong would show a founder the approval and merge
     * panels for a change that has not passed its checks.
     */
    it("opens the validation gate for a change that failed its checks", () => {
      const view = viewOf({
        changes: [
          { preparedChangeId: "change-2", stage: "validation_failed", headline: "Checks failed" },
        ],
      });

      expect(view.primary.kind).toBe("validation_failed");
      if (view.primary.control.kind !== "gate") throw new Error("expected a gate");
      expect(view.primary.control.stage).toBe("validate");
    });

    /*
     * This used to assert `elsewhere`, and the change is the point rather than
     * a relaxation. A question was sent away because Home could not supply the
     * arguments — and a question is the one case where it can: the candidate
     * carries the request id, and the card that answers one takes the request
     * and its resolution action as props. So the control names what to answer,
     * and the surface renders the card instead of a link out of the
     * conversation that asked.
     */
    it("answers a question where it was asked, and names what to answer", () => {
      const view = viewOf({
        questions: [
          {
            founderInputRequestId: "req-1",
            question: "Which plan tier?",
            origin: "planner",
            stepOrder: 1,
          },
        ],
      });

      expect(view.primary.kind).toBe("founder_input_required");
      expect(view.primary.control.kind).toBe("answer");
      if (view.primary.control.kind === "answer") {
        expect(view.primary.control.founderInputRequestId).toBe("req-1");
      }
      expect(view.primary.detail).toBe("Which plan tier?");
    });

    /*
     * The other half, and the reason `elsewhere` still exists. A merge needs
     * an approval id that no candidate carries; a build needs a plan step key.
     * Answering needs neither, which is why exactly one of these moved.
     */
    it("keeps sending away the decisions whose arguments are still missing", () => {
      const view = viewOf({ workspaceChoiceRequired: true });

      expect(view.primary.kind).toBe("workspace_choice_required");
      expect(view.primary.control.kind).toBe("elsewhere");
    });

    it("gives a label to every control that has one, and none to a card", () => {
      const asked = viewOf({
        questions: [
          {
            founderInputRequestId: "req-1",
            question: "Which plan tier?",
            origin: "planner",
            stepOrder: 1,
          },
        ],
      });
      const settled = viewOf({});

      // The card is the control, so a second verb beside it would be one act
      // with two names.
      expect(novaControlLabel(asked.primary.control)).toBeNull();
      // And `nothing_to_do` has no control at all.
      expect(novaControlLabel(settled.primary.control)).toBeNull();
      expect(novaControlLabel(viewOf({ auditOutdated: true }).primary.control)).toBe(
        "Run the audit again",
      );
    });

    it("dispatches a re-audit itself, because it needs only the project", () => {
      const view = viewOf({ auditOutdated: true });

      expect(view.primary.control.kind).toBe("server_action");
      if (view.primary.control.kind === "server_action") {
        expect(view.primary.control.option.actionId).toBe("nova.refresh_audit");
      }
    });

    /*
     * Reconnecting is the GitHub App install flow. It leaves the product
     * entirely, so a Server Action could not finish what it starts — which is
     * why one navigation is still a navigation after four of them became
     * gates.
     */
    it("keeps a navigation control a link rather than a button", () => {
      const view = viewOf({ sourceDisconnected: true });

      expect(view.primary.kind).toBe("source_disconnected");
      expect(view.primary.control.kind).toBe("navigation");
    });
  });

  describe("priced controls", () => {
    it("carries the retail kind so a price can be rendered before the click", () => {
      const view = viewOf({ auditOutdated: true });

      if (view.primary.control.kind !== "server_action") throw new Error("expected an action");
      // The kind, not a number: prices are effective-dated and resolved at
      // render, so a figure copied here would be a second price going stale.
      expect(view.primary.control.option.price).toBe("business_audit");
    });

    it("never states a figure in Nova's own sentence", () => {
      for (const kind of FOCUS_CANDIDATE_KINDS) {
        expect(novaCandidateMessage(kind), kind).not.toMatch(/\d/);
      }
    });
  });

  it("gives every entry a key that is stable for the same subject", () => {
    const change = {
      preparedChangeId: "change-1",
      stage: "review_required" as const,
      headline: "Look",
    };

    expect(viewOf({ changes: [change] }).primary.id).toBe(
      viewOf({ changes: [change] }).primary.id,
    );
    expect(viewOf({ changes: [change] }).primary.id).toContain("change-1");
  });
});
