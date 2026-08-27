import { describe, expect, it } from "vitest";
import { erasureViewState } from "./view";

/**
 * What the settings screen is told about erasure.
 *
 * The state this file exists for is `failed`. An erasure stops being active the
 * moment it fails, so a screen deriving its state from "is one running" would
 * respond to a failure by redrawing the button — which, to the person who just
 * pressed it, is indistinguishable from never having pressed it. That is the
 * defect `findLatestOperation` was added for on the project side.
 */

describe("no erasure has ever been attempted", () => {
  it("offers the control", () => {
    expect(erasureViewState(null)).toEqual({ kind: "idle" });
  });
});

describe("one is under way", () => {
  for (const status of ["queued", "running"]) {
    it(`reports ${status} as running`, () => {
      expect(erasureViewState({ id: "op", status, failureCode: null })).toEqual({ kind: "running" });
    });
  }

  it("counts needs_user as running, not as finished", () => {
    // ADR 0056 §10's named trap, in its user-facing form. An erasure paused in
    // `needs_user` still holds the account closed, so an inviting button beside
    // it would be a lie about what pressing it would do.
    expect(erasureViewState({ id: "op", status: "needs_user", failureCode: null })).toEqual({
      kind: "running",
    });
  });
});

describe("one failed", () => {
  it("surfaces the reason rather than quietly offering the button again", () => {
    expect(
      erasureViewState({ id: "op", status: "failed", failureCode: "stripe_cancel_failed" }),
    ).toEqual({ kind: "failed", reason: "stripe_cancel_failed" });
  });

  it("falls back to `unknown` for a code it does not have copy for", () => {
    // A closed union with a defensive default: a new orchestrator failure code
    // renders honest generic copy instead of a blank line.
    expect(
      erasureViewState({ id: "op", status: "failed", failureCode: "identity_delete_failed" }),
    ).toEqual({ kind: "failed", reason: "unknown" });
  });

  it("falls back to `unknown` when the row carries no code at all", () => {
    expect(erasureViewState({ id: "op", status: "failed", failureCode: null })).toEqual({
      kind: "failed",
      reason: "unknown",
    });
  });
});

describe("terminal states that are not failures", () => {
  it("treats a cancelled erasure as idle", () => {
    expect(erasureViewState({ id: "op", status: "cancelled", failureCode: null })).toEqual({
      kind: "idle",
    });
  });

  it("treats a completed one as idle, which nobody can ever see", () => {
    // Unreachable in practice — the identity is gone, so there is no session to
    // render a settings page with. Defined rather than left to fall through,
    // because "unreachable" and "undefined" are different promises.
    expect(erasureViewState({ id: "op", status: "completed", failureCode: null })).toEqual({
      kind: "idle",
    });
  });
});
