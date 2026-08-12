import { describe, expect, it } from "vitest";
import type { OperationView } from "@/modules/operations/view";
import type { ExecutionBlockReason } from "./schema";
import {
  BLOCKED_ACTION_LABELS,
  BLOCKED_MESSAGES,
  blockedAction,
  buildOpportunityActionState,
  type OpportunityActionInput,
} from "./view";
import { fakeSeoOpportunity } from "./test-support";

/**
 * What the Opportunities UI offers (Sprint 9C §23, §28).
 *
 * The property under test: **model readiness never produces a button.** Only a
 * resolved capability does. Every case below changes one input and asserts
 * what the user is allowed to see.
 */

function operation(overrides: Partial<OperationView> = {}): OperationView {
  return {
    operationId: "operation_1",
    status: "running",
    stage: "preflight",
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: null,
    failureCode: null,
    resultId: null,
    shouldPoll: true,
    retryAllowed: false,
    stalled: false,
    ...overrides,
  };
}

function state(overrides: Partial<OpportunityActionInput> = {}) {
  return buildOpportunityActionState({
    opportunity: fakeSeoOpportunity(),
    capability: "nextjs_seo_foundations_v1",
    preparedChangeId: null,
    activeOperation: null,
    failedOperation: null,
    blockedReason: null,
    ...overrides,
  });
}

describe("execution button states (§23)", () => {
  it("offers preparation for a supported opportunity", () => {
    expect(state()).toEqual({ kind: "preparable", capability: "nextjs_seo_foundations_v1" });
  });

  it("offers nothing executable when Vibe has no executor, however ready the model says it is", () => {
    const noExecutor = state({
      capability: null,
      opportunity: fakeSeoOpportunity({ executionReadiness: "ready" }),
    });

    expect(noExecutor).toEqual({ kind: "not_automated" });
  });

  it("distinguishes a decision the founder owes from work Vibe cannot do", () => {
    expect(
      state({ capability: null, opportunity: fakeSeoOpportunity({ executionReadiness: "needs_user_input" }) }),
    ).toEqual({ kind: "needs_user_input" });
  });

  it("shows the running state instead of a second start button (§17)", () => {
    const active = operation();

    expect(state({ activeOperation: active })).toEqual({ kind: "preparing", operation: active });
  });

  it("suppresses a start even when an active operation coexists with a prepared change", () => {
    expect(state({ activeOperation: operation(), preparedChangeId: "prepared_1" }).kind).toBe("preparing");
  });

  it("offers review rather than a second write once prepared (§16)", () => {
    expect(state({ preparedChangeId: "prepared_1" })).toEqual({
      kind: "already_prepared",
      preparedChangeId: "prepared_1",
    });
  });

  it("reports a failed preparation with its retry eligibility", () => {
    const failed = operation({
      status: "failed",
      failureCode: "github_unavailable",
      retryAllowed: false,
      shouldPoll: false,
    });

    expect(state({ failedOperation: failed })).toEqual({
      kind: "failed",
      operation: failed,
      retryAllowed: false,
    });
  });

  it.each([
    ["repository_changed"],
    ["stale_audit"],
    ["stale_opportunity"],
    ["github_write_permission_required"],
  ] as [ExecutionBlockReason][])("reports %s as blocked rather than preparable", (reason) => {
    expect(state({ blockedReason: reason })).toEqual({ kind: "blocked", reason });
  });
});

describe("blocked states always offer a way forward or an explanation (§6, §7)", () => {
  const ALL: ExecutionBlockReason[] = [
    "stale_opportunity",
    "stale_audit",
    "stale_repository_intelligence",
    "repository_changed",
    "premise_no_longer_true",
    "unsupported_framework",
    "unsupported_repository_layout",
    "missing_required_context",
    "github_write_permission_required",
    "conflicting_files_exist",
    "unsupported_opportunity",
    "execution_not_available",
  ];

  it.each(ALL)("has copy for %s", (reason) => {
    expect(BLOCKED_MESSAGES[reason].length).toBeGreaterThan(0);
  });

  it.each(ALL)("resolves an action for %s", (reason) => {
    const action = blockedAction(reason);
    if (action.kind !== "none") {
      expect(BLOCKED_ACTION_LABELS[action.kind].length).toBeGreaterThan(0);
    }
  });

  it("offers the free deterministic refresh for a changed repository (§6)", () => {
    expect(blockedAction("repository_changed")).toEqual({ kind: "refresh_repository_intelligence" });
  });

  it("names the paid refreshes as separate deliberate actions, never chained (§6)", () => {
    // A repository refresh must never imply an audit, and an audit must never
    // imply opportunity generation. Each is its own decision to spend.
    expect(blockedAction("stale_audit")).toEqual({ kind: "update_audit" });
    expect(blockedAction("stale_opportunity")).toEqual({ kind: "refresh_opportunities" });
  });

  it("points a missing permission at the GitHub upgrade", () => {
    expect(blockedAction("github_write_permission_required")).toEqual({ kind: "enable_github_write" });
  });
});

describe("product copy (§30)", () => {
  it("never promises shipping, deploying or fixing", () => {
    const copy = Object.values(BLOCKED_MESSAGES).concat(Object.values(BLOCKED_ACTION_LABELS)).join(" ");

    expect(copy).not.toMatch(/\bdeploy(ed|ing)?\b/i);
    expect(copy).not.toMatch(/\bship(ped|ping)?\b/i);
    expect(copy).not.toMatch(/\bmerge[ds]?\b/i);
    expect(copy).not.toMatch(/production ready/i);
  });

  it("says what Vibe needs permission for, without implying a default-branch write", () => {
    const message = BLOCKED_MESSAGES.github_write_permission_required;

    expect(message).toContain("isolated branch");
    expect(message).not.toMatch(/default branch|main branch/i);
  });
});
