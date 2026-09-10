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

  /**
   * One change on screen, and the rest counted.
   *
   * A founder's phone showed the pile this removes: nothing ages a change out
   * of the ranking, so a month of agent runs is a month of moments, and the
   * secondary ones render as sentences with no controls. Five of them said
   * *"There is a change waiting for you to look at."* and not one said which.
   *
   * The ranking is deliberately not where this happens — `focus.test.ts` holds
   * the invariant that everything true is either primary or secondary, and it
   * is right. These assert the view's side of that line.
   */
  describe("the change queue", () => {
    function change(stage: "awaiting_approval" | "merged" | "validation_failed", id: string) {
      return { preparedChangeId: id, stage, headline: `headline for ${id}` } as const;
    }

    it("raises one change and counts the others", () => {
      const view = viewOf({
        changes: [
          change("awaiting_approval", "change-a"),
          change("awaiting_approval", "change-b"),
          change("merged", "change-c"),
        ],
      });

      expect(view.primary.kind).toBe("review_change");
      expect(view.secondary.filter((entry) => "preparedChangeId" in entry.candidate)).toEqual([]);
      expect(view.changesWaiting).toBe(2);
    });

    /*
     * The count is not a substitute for the ranking's ordering: the change
     * raised is the first one the domain sorted, and a failed validation
     * outranks a change awaiting review.
     */
    it("raises the change the ranking put first", () => {
      const view = viewOf({
        changes: [change("awaiting_approval", "change-a"), change("validation_failed", "change-b")],
      });

      expect(view.primary.kind).toBe("validation_failed");
      expect(view.primary.candidate).toMatchObject({ preparedChangeId: "change-b" });
      expect(view.changesWaiting).toBe(1);
    });

    /*
     * When something else leads, the top change is still shown — it moves into
     * the secondary list rather than being counted away. Collapsing to a count
     * whenever the primary was not a change would hide the only change a
     * founder has.
     */
    it("still shows the top change when another moment leads", () => {
      const view = viewOf({
        sourceDisconnected: true,
        changes: [change("awaiting_approval", "change-a"), change("awaiting_approval", "change-b")],
      });

      expect(view.primary.kind).toBe("source_disconnected");
      expect(
        view.secondary.filter((entry) => "preparedChangeId" in entry.candidate).map((e) => e.kind),
      ).toEqual(["review_change"]);
      expect(view.changesWaiting).toBe(1);
    });

    it("counts nothing when there is one change or none", () => {
      expect(viewOf({ changes: [change("awaiting_approval", "change-a")] }).changesWaiting).toBe(0);
      expect(viewOf().changesWaiting).toBe(0);
    });

    /* Non-change moments are never collapsed: they are different sentences
       about different things, and each one is somebody's next step. The change
       that survives keeps the position the ranking gave it, between them. */
    it("leaves every other moment where the ranking put it", () => {
      const view = viewOf({
        changes: [change("awaiting_approval", "change-a"), change("awaiting_approval", "change-b")],
        auditOutdated: true,
        workspaceChoiceRequired: true,
      });

      expect(view.primary.kind).toBe("workspace_choice_required");
      expect(view.secondary.map((entry) => entry.kind)).toEqual([
        "review_change",
        "audit_outdated",
      ]);
      expect(view.changesWaiting).toBe(1);
    });
  });

  describe("waiting is never working", () => {
    it("reports a paused operation as waiting on the founder", () => {
      const view = viewOf({
        working: { type: "business_audit", view: operation({ status: "needs_user" }) },
      });
      expect(view.working?.phase).toBe("waiting_user");
    });

    it("reports a running operation as working", () => {
      const view = viewOf({
        working: { type: "business_audit", view: operation({ status: "running" }) },
      });
      expect(view.working?.phase).toBe("working");
    });

    it("reports a stalled run as stalled rather than as either", () => {
      const view = viewOf({
        working: { type: "business_audit", view: operation({ stalled: true }) },
      });
      expect(view.working?.phase).toBe("stalled");
    });

    /*
     * The type travels with the reading because a stage list is keyed by it.
     * Without it a surface drawing the named stages would have to guess which
     * sequence it was looking at, and two of the fifteen operation types have
     * one — so the wrong guess is a checklist that ticks the wrong rows.
     */
    it("carries the kind of run, and the stages that kind has", () => {
      const planning = viewOf({
        working: { type: "action_planning", view: operation() },
      });

      expect(planning.working?.type).toBe("action_planning");
      expect(planning.working?.sequence).toBe("action_planning");
    });

    /*
     * And says so honestly when a run has none. A merge reports a stage and no
     * sequence; an empty checklist under it would be a picture of four steps
     * nobody defined.
     */
    it("reports no stages for a run that has none", () => {
      const merging = viewOf({ working: { type: "change_merge", view: operation() } });

      expect(merging.working?.stageLabel).toBeTruthy();
      expect(merging.working?.sequence).toBeNull();
    });

    it("names a stage rather than a percentage", () => {
      const view = viewOf({
        working: { type: "business_audit", view: operation() },
      });
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
      }
      // No verb of its own. The gates carry every control this moment has.
      expect(novaControlLabel(view.primary.control)).toBeNull();
    });

    /*
     * A failed validation is still decided in the change's gate — the control
     * kind says so — and *which* screen that gate draws is no longer decided
     * here. It cannot be: `review_required` and `awaiting_approval` are one
     * candidate kind and opposite states. `change-stage-view.test.ts` holds
     * that mapping and the guarantee that used to live in this assertion:
     * a change that failed its checks is never shown the approval and merge
     * panels.
     */
    it("decides a failed validation through the change's own gate too", () => {
      const view = viewOf({
        changes: [
          { preparedChangeId: "change-2", stage: "validation_failed", headline: "Checks failed" },
        ],
      });

      expect(view.primary.kind).toBe("validation_failed");
      if (view.primary.control.kind !== "gate") throw new Error("expected a gate");
      expect(view.primary.control.preparedChangeId).toBe("change-2");
      expect(novaControlLabel(view.primary.control)).toBeNull();
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
    /*
     * This used to assert `elsewhere`, on the reasoning that the candidate
     * names no application. It does not — but the list was never an argument
     * the ranking was withholding, it is a read, and the surface can make it.
     * The control carries nothing, which is the honest shape.
     */
    it("chooses between applications here, from a list the surface reads", () => {
      const view = viewOf({ workspaceChoiceRequired: true });

      expect(view.primary.kind).toBe("workspace_choice_required");
      expect(view.primary.control.kind).toBe("choose");
      // The panel is the control, so a verb beside it would be a second one.
      expect(novaControlLabel(view.primary.control)).toBeNull();
    });

    /*
     * The last entry in ELSEWHERE, and the argument that held it there is the
     * thing this now asserts the other way round.
     *
     * It was `elsewhere` because a build is two pieces of work at two prices
     * and Home was offering neither. It is `offer` because `AgentReadyStage`
     * shows both — so the requirement is met rather than routed around, and
     * `novaControlLabel` returns null because the block carries the buttons.
     *
     * A label here would be the regression: it would mean a link off Home
     * came back, beside an offer Home is already holding.
     */
    it("offers the build here, with the block carrying both prices", () => {
      const view = viewOf({ executableStep: { order: 2, title: "Add the pricing page" } });

      expect(view.primary.kind).toBe("execution_offered");
      expect(view.primary.control.kind).toBe("offer");
      expect(novaControlLabel(view.primary.control)).toBeNull();
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

    expect(viewOf({ changes: [change] }).primary.id).toBe(viewOf({ changes: [change] }).primary.id);
    expect(viewOf({ changes: [change] }).primary.id).toContain("change-1");
  });
});
