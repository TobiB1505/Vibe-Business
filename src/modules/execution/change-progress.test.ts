import { describe, expect, it } from "vitest";
import { deriveChangeProgress, type ChangeProgressInput } from "./change-progress";

/**
 * Where a prepared change stands (UI-5 §1).
 *
 * The defects this exists to stop are all one defect: no code could ask how
 * far a change had got, so every panel answered for its own gate and kept
 * saying "nothing has happened yet" long after something had.
 *
 * Two properties carry the weight. A change reads from the far end backwards,
 * so a settled early gate never speaks for a change that is past it; and a
 * merge failure that means "it is your turn" is never reported as trouble.
 */

/**
 * A coherent card, overridden one gate at a time.
 *
 * The gate cards carry far more than the derivation reads, so the fixture
 * names only what it decides on and casts once, here. A test that had to
 * spell out every field of seven view models would obscure the one thing each
 * case is about.
 */
function input(overrides: Record<string, unknown> = {}): ChangeProgressInput {
  return {
    validation: { status: "passed", phases: [], failureMessage: null, sandboxDurationMs: null, underCurrentPolicy: true },
    preview: { state: "stopped" },
    review: { state: "ready" },
    approval: { state: "approved" },
    merge: { state: "ready", failureCode: null },
    outcome: { state: "unavailable" },
    businessImpact: { state: "unavailable" },
    ...overrides,
  } as unknown as ChangeProgressInput;
}

describe("stage", () => {
  /** A change that has got no further than its first gate. */
  function beforeValidation(validation: unknown) {
    return input({
      validation,
      review: { state: "not_generated" },
      approval: { state: "not_eligible" },
      merge: { state: "not_eligible", failureCode: "merge_approval_required" },
    });
  }

  it("waits on safety checks before anything else", () => {
    for (const status of ["queued", "running", "failed", "cancelled"] as const) {
      const progress = deriveChangeProgress(
        beforeValidation({
          status,
          phases: [],
          failureMessage: null,
          sandboxDurationMs: null,
          underCurrentPolicy: true,
        }),
      );

      expect(["not_validated", "validating", "validation_failed"]).toContain(progress.stage);
    }
  });

  /**
   * The three are not interchangeable, and saying so is the point.
   *
   * One sentence used to cover all of them — "Vibe is checking this change is
   * safe" — which was true only while something was actually running. On a
   * change nobody had checked, and on a change whose checks had failed, the
   * card was stating something that was not happening.
   */
  it.each([
    ["queued", "validating"],
    ["running", "validating"],
    ["failed", "validation_failed"],
    // A run somebody stopped says nothing about the change, so it reads as
    // unchecked rather than as a failure — the same call the panel makes.
    ["cancelled", "not_validated"],
  ] as const)("reads %s as %s", (status, stage) => {
    const progress = deriveChangeProgress(
      beforeValidation({
        status,
        phases: [],
        failureMessage: null,
        sandboxDurationMs: null,
        underCurrentPolicy: true,
      }),
    );

    expect(progress.stage).toBe(stage);
  });

  it("treats a change with no validation at all as unvalidated, never as ready", () => {
    const progress = deriveChangeProgress(beforeValidation(null));

    expect(progress.stage).toBe("not_validated");
    expect(progress.headline).toBe("This change has not been checked yet.");
  });

  it("never claims a check is happening when none is", () => {
    // The defect this split exists to prevent, asserted as the sentence rather
    // than as the stage name.
    for (const validation of [
      null,
      { status: "cancelled", phases: [], failureMessage: null, sandboxDurationMs: null, underCurrentPolicy: true },
      { status: "failed", phases: [], failureMessage: null, sandboxDurationMs: null, underCurrentPolicy: true },
    ]) {
      expect(deriveChangeProgress(beforeValidation(validation)).headline).not.toContain(
        "is checking",
      );
    }
  });

  /** A validated change that nobody has approved, varying only the review gate. */
  function beforeApproval(overrides: Record<string, unknown>) {
    return input({
      approval: { state: "not_approved" },
      merge: { state: "not_eligible", failureCode: "merge_approval_required" },
      ...overrides,
    });
  }

  it("waits for the comparison a person reviews", () => {
    const progress = deriveChangeProgress(beforeApproval({ review: { state: "capturing" } }));

    expect(progress.stage).toBe("reviewing");
  });

  /**
   * The same distinction as the validation gate, one step later — and found
   * the same way, by looking at a real card rather than at a test.
   *
   * "Vibe is preparing what you need to review" sat above a preview that was
   * not started and a review waiting for one. Nothing was running and the next
   * move belonged to the founder.
   */
  it.each([
    // Genuinely in flight, both ways a comparison can be being built.
    [{ review: { state: "capturing" }, preview: { state: "stopped" } }, "reviewing"],
    [{ review: { state: "not_generated" }, preview: { state: "running" } }, "reviewing"],
    [{ review: { state: "not_generated" }, preview: { state: "starting" } }, "reviewing"],
    // Nothing running. The founder starts the preview, or the comparison.
    [{ review: { state: "not_generated" }, preview: { state: "ready_to_start" } }, "review_required"],
    [{ review: { state: "not_generated" }, preview: { state: "stopped" } }, "review_required"],
    // Attempted or captured, and not there to look at.
    [{ review: { state: "failed" }, preview: { state: "stopped" } }, "review_unavailable"],
    [{ review: { state: "expired" }, preview: { state: "stopped" } }, "review_unavailable"],
  ] as const)("reads %o as %s", (gates, stage) => {
    expect(deriveChangeProgress(beforeApproval(gates)).stage).toBe(stage);
  });

  it("never claims a comparison is being prepared when none is", () => {
    // The screen this assertion comes from: preview not started, review
    // waiting for one, and a headline saying Vibe was preparing something.
    for (const gates of [
      { review: { state: "not_generated" }, preview: { state: "ready_to_start" } },
      { review: { state: "failed" }, preview: { state: "stopped" } },
      { review: { state: "expired" }, preview: { state: "stopped" } },
    ]) {
      expect(deriveChangeProgress(beforeApproval(gates)).headline).not.toContain("is preparing");
    }
  });

  it("keeps a settled review out of the review stages entirely", () => {
    // The condition this replaced: ready *and* no preview in flight. Both
    // halves still hold — a running preview outranks a ready comparison,
    // because a person watching one start is not being asked to decide yet.
    expect(deriveChangeProgress(beforeApproval({ review: { state: "ready" } })).stage).toBe(
      "awaiting_approval",
    );
    expect(
      deriveChangeProgress(
        beforeApproval({ review: { state: "ready" }, preview: { state: "starting" } }),
      ).stage,
    ).toBe("reviewing");
  });

  it("asks for a decision once the evidence is on screen", () => {
    const progress = deriveChangeProgress(beforeApproval({}));

    expect(progress.stage).toBe("awaiting_approval");
  });

  it("offers the merge once a human approved this exact commit", () => {
    expect(deriveChangeProgress(input()).stage).toBe("ready_to_merge");
  });

  it("reports a merge in flight", () => {
    const progress = deriveChangeProgress(
      input({ merge: { state: "merging", failureCode: null } }),
    );

    expect(progress.stage).toBe("merging");
  });

  it("reads the far end first, so a merged change is never described by an early gate", () => {
    /*
     * The shape of the original defect: this change was merged and verified,
     * and its validation, review and approval panels were still announcing
     * that nothing had happened.
     */
    const progress = deriveChangeProgress(
      input({
        validation: null,
        review: { state: "expired" },
        merge: { state: "merged", failureCode: null },
        outcome: { state: "verified" },
      }),
    );

    expect(progress.stage).toBe("observed");
    expect(progress.merged).toBe(true);
  });

  it("separates merged from observed", () => {
    for (const state of ["unavailable", "not_started", "observing"] as const) {
      const progress = deriveChangeProgress(
        input({
          merge: { state: "merged", failureCode: null },
          outcome: { state },
        }),
      );

      expect(progress.stage).toBe("merged");
    }
  });

  it("counts every settled outcome as observed, including the inconclusive ones", () => {
    // "Not observed" and "could not check" are answers. Treating only
    // `verified` as an ending would leave those changes described as still in
    // progress, which is the same lie in the other direction.
    for (const state of ["verified", "partial", "not_observed", "failed"] as const) {
      const progress = deriveChangeProgress(
        input({
          merge: { state: "merged", failureCode: null },
          outcome: { state },
        }),
      );

      expect(progress.stage).toBe("observed");
    }
  });
});

describe("a refusal that is not trouble", () => {
  it("does not call an unapproved change stalled", () => {
    // `merge_approval_required` is on every change nobody has approved yet.
    // Reading any failure code as a problem would announce one on the happy
    // path, at the exact moment the honest answer is "it is your turn".
    const progress = deriveChangeProgress(
      input({
        approval: { state: "not_approved" },
        merge: { state: "not_eligible", failureCode: "merge_approval_required" },
      }),
    );

    expect(progress.stage).toBe("awaiting_approval");
  });

  it("does not call a superseded approval stalled either", () => {
    const progress = deriveChangeProgress(
      input({
        approval: { state: "invalidated" },
        merge: { state: "not_eligible", failureCode: "merge_approval_invalid" },
      }),
    );

    expect(progress.stage).toBe("awaiting_approval");
  });

  it("does call repository drift stalled", () => {
    for (const failureCode of [
      "merge_repository_changed",
      "merge_prepared_branch_changed",
      "merge_not_fast_forward",
      "merge_prepared_commit_missing",
    ] as const) {
      const progress = deriveChangeProgress(
        input({ merge: { state: "not_eligible", failureCode } }),
      );

      expect(progress.stage, failureCode).toBe("stalled");
    }
  });

  it("calls a refused or failed write stalled", () => {
    for (const failureCode of [
      "merge_protected_branch",
      "merge_permission_missing",
      "merge_ambiguous_write",
      "merge_verification_failed",
    ] as const) {
      const progress = deriveChangeProgress(
        input({ merge: { state: "blocked", failureCode } }),
      );

      expect(progress.stage, failureCode).toBe("stalled");
    }
  });

  it("treats a merge that ended without a verified result as stalled whatever it says", () => {
    const progress = deriveChangeProgress(
      input({ merge: { state: "failed", failureCode: null } }),
    );

    expect(progress.stage).toBe("stalled");
  });
});

describe("what the card may hide", () => {
  it("keeps the early gates open while they are still the work", () => {
    for (const approval of ["not_eligible", "not_approved", "revoked", "invalidated"] as const) {
      const progress = deriveChangeProgress(
        input({ approval: { state: approval } }),
      );

      expect(progress.earlySettled, approval).toBe(false);
      expect(progress.approved, approval).toBe(false);
    }
  });

  it("settles all four the moment an approval stands", () => {
    // An approval cannot exist without a validation that passed and a review
    // that is ready, so one answer settles the four.
    expect(deriveChangeProgress(input()).earlySettled).toBe(true);
  });

  it("keeps them settled for a stalled change, whose approval still stands", () => {
    const progress = deriveChangeProgress(
      input({
        merge: { state: "not_eligible", failureCode: "merge_repository_changed" },
      }),
    );

    expect(progress.stage).toBe("stalled");
    expect(progress.earlySettled).toBe(true);
  });

  it("re-opens them when an approval is withdrawn", () => {
    const progress = deriveChangeProgress(
      input({ approval: { state: "revoked" }, merge: { state: "not_eligible", failureCode: "merge_approval_required" } }),
    );

    expect(progress.earlySettled).toBe(false);
  });
});

describe("what the disclaimers read", () => {
  it("says nothing is merged before a merge", () => {
    const progress = deriveChangeProgress(input());

    expect(progress.merged).toBe(false);
    expect(progress.approved).toBe(true);
  });

  it("stops saying it once the branch was moved and read back", () => {
    const progress = deriveChangeProgress(
      input({ merge: { state: "merged", failureCode: null } }),
    );

    expect(progress.merged).toBe(true);
  });

  it("counts a change somebody merged by hand as merged", () => {
    // `already_applied` produces a merged card with no merge of Vibe's own.
    // The default branch carries the commit either way, and a card that
    // claimed otherwise would be wrong about the repository.
    const progress = deriveChangeProgress(
      input({ merge: { state: "merged", failureCode: null, mergedAt: null } }),
    );

    expect(progress.merged).toBe(true);
  });
});

describe("headline", () => {
  it("gives every stage exactly one sentence", () => {
    const seen = new Set<string>();

    for (const progress of [
      deriveChangeProgress(
        input({ validation: null, approval: { state: "not_eligible" } }),
      ),
      deriveChangeProgress(input({ review: { state: "capturing" }, approval: { state: "not_approved" } })),
      deriveChangeProgress(input({ approval: { state: "not_approved" } })),
      deriveChangeProgress(input()),
      deriveChangeProgress(input({ merge: { state: "merging", failureCode: null } })),
      deriveChangeProgress(input({ merge: { state: "failed", failureCode: null } })),
      deriveChangeProgress(input({ merge: { state: "merged", failureCode: null } })),
      deriveChangeProgress(input({ merge: { state: "merged", failureCode: null }, outcome: { state: "verified" } })),
    ]) {
      expect(progress.headline.length).toBeGreaterThan(0);
      seen.add(progress.headline);
    }

    // Eight stages, eight distinct sentences: a stage that borrowed another's
    // words would be a stage the card cannot actually tell apart.
    expect(seen.size).toBe(8);
  });

  it("never promises a deployment or a business result", () => {
    for (const forbidden of ["deployed", "live", "shipped", "traffic", "impact"]) {
      const progress = deriveChangeProgress(
        input({ merge: { state: "merged", failureCode: null }, outcome: { state: "verified" } }),
      );

      expect(progress.headline.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
