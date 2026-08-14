import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyFastForwardError } from "./github/adapter";

/**
 * The structural guarantees (Sprint 11C §33, §40, §41).
 *
 * ## Why these are source assertions rather than behavioural ones
 *
 * Because the property being asserted is **absence**, and absence has no
 * behaviour to observe. "This code never force-updates a ref" cannot be proved
 * by calling it — only by showing there is no call that could. A behavioural
 * test would pass equally well against a port that force-pushes on some branch
 * nobody thought to exercise.
 *
 * Structural limitation is preferable to caller discipline (§33), and these
 * tests are what keeps the limitation structural: they fail if somebody adds
 * the capability back, whether or not anything calls it yet.
 */

const MODULE = join(process.cwd(), "src/modules/merge");

function source(file: string): string {
  return readFileSync(join(MODULE, file), "utf8");
}

/** Source with comments removed, so prose about `force` never satisfies a test. */
function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("the merge port cannot do anything but fast-forward one branch (§33, §40)", () => {
  const port = code("git-port.ts");

  it("exposes no way to force an update", () => {
    // §40, load-bearing. There is no `force` parameter anywhere in the port, so
    // "we never force" is a property of the type rather than a claim about the
    // code. A mutation that adds one fails here.
    expect(port).not.toMatch(/\bforce\b/i);
  });

  it("exposes no way to delete a ref", () => {
    // §41: the prepared branch survives a merge because nothing here could
    // remove it.
    expect(port).not.toMatch(/deleteRef|deleteBranch|removeRef/i);
  });

  it("exposes no general ref update", () => {
    // Only `fastForwardDefaultBranch` exists, and it takes the branch the
    // *server* resolved from GitHub. There is no call that could point an
    // arbitrary ref at an arbitrary sha.
    expect(port).not.toMatch(/\bupdateRef\b/);
    expect(port).toMatch(/fastForwardDefaultBranch/);
  });

  it("exposes no way to create content", () => {
    // A merge moves a pointer to a commit that already exists, was already
    // validated, previewed, reviewed and approved. It generates nothing.
    expect(port).not.toMatch(/createCommit|createBlob|createTree|writeFile|createRef/);
  });

  it("keeps the preparation port's guarantee intact", () => {
    // Sprint 9's `GitWritePort` has no `updateRef` and no `deleteRef`, which is
    // what makes "the change preparer cannot move the default branch" a
    // property of its type. Adding default-branch mutation there would have
    // spent that guarantee, so the merge capability got its own port (§33).
    // Comments stripped: that file *documents* the absence of `updateRef` and
    // `deleteRef` at length, and matching its own prose would make this test
    // pass for the wrong reason — the classic way a source assertion becomes a
    // tautology.
    const preparationPort = readFileSync(
      join(process.cwd(), "src/modules/execution/git-port.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(preparationPort).not.toMatch(/updateRef|deleteRef|fastForward/);
  });
});

describe("the GitHub adapter never forces and never deletes (§40, §41)", () => {
  const adapter = code("github/adapter.ts");

  it("passes force: false explicitly on the one write it makes", () => {
    // Explicit rather than left to the documented default, so the guarantee is
    // visible at the call site instead of inherited from a spec nobody rereads.
    expect(adapter).toMatch(/force:\s*false/);
  });

  it("never passes force: true, on any path", () => {
    // The mutation this test exists for. Flipping the boolean is a one-character
    // change that turns a safe capability into one that can destroy history on
    // a customer's default branch.
    expect(adapter).not.toMatch(/force:\s*true/);
    expect(adapter).not.toMatch(/force:\s*(?!false)[A-Za-z_$]/);
  });

  it("calls no ref-deleting or history-rewriting endpoint", () => {
    expect(adapter).not.toMatch(/deleteRef|deleteBranch|\.git\.deleteRef/);
    expect(adapter).not.toMatch(/createCommit|createTree|createBlob/);
  });

  it("uses updateRef only through the fast-forward operation", () => {
    const updateRefCalls = adapter.match(/updateRef/g) ?? [];
    expect(updateRefCalls).toHaveLength(1);
    expect(adapter.indexOf("updateRef")).toBeGreaterThan(adapter.indexOf("fastForwardDefaultBranch"));
  });
});

describe("classifying a failed ref update (§11, §19, §28)", () => {
  it("treats a transport failure with no status as ambiguous", () => {
    // The request may have reached GitHub and been applied. This is the answer
    // that stops a retry and starts a read.
    expect(classifyFastForwardError(new Error("socket hang up"))).toEqual({ kind: "ambiguous" });
  });

  it("treats a 5xx as ambiguous", () => {
    // A 502 can follow a mutation that succeeded on the far side of a proxy.
    expect(classifyFastForwardError({ status: 502, message: "Bad gateway" })).toEqual({
      kind: "ambiguous",
    });
  });

  it("classifies a protected branch rejection as such", () => {
    expect(
      classifyFastForwardError({ status: 422, message: "4 of 4 required status checks are expected." }),
    ).toEqual({ kind: "rejected", reason: "protected_branch" });

    expect(
      classifyFastForwardError({ status: 403, message: "Changes must be made through a pull request." }),
    ).toEqual({ kind: "rejected", reason: "protected_branch" });
  });

  it("prefers protection over fast-forward when both could describe it", () => {
    // A protected branch can reject an update that would have been a perfectly
    // valid fast-forward. Telling the user "not a fast-forward" would send them
    // to fix the wrong thing (§30).
    expect(
      classifyFastForwardError({
        status: 422,
        message: "Update is not a fast forward; branch is protected",
      }),
    ).toEqual({ kind: "rejected", reason: "protected_branch" });
  });

  it("classifies a non-fast-forward rejection as such", () => {
    expect(classifyFastForwardError({ status: 422, message: "Update is not a fast forward" })).toEqual({
      kind: "rejected",
      reason: "not_fast_forward",
    });
  });

  it("classifies a permission failure as such", () => {
    expect(
      classifyFastForwardError({ status: 403, message: "Resource not accessible by integration" }),
    ).toEqual({ kind: "rejected", reason: "permission_denied" });
  });

  it("treats every definitive 4xx as a rejection, never as ambiguity", () => {
    // GitHub read the request, decided, and did not move the branch. Reporting
    // that as ambiguous would send the recovery path looking for a write that
    // provably never happened.
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(classifyFastForwardError({ status, message: "" }).kind).toBe("rejected");
    }
  });

  it("never lets provider prose escape the classification", () => {
    const outcome = classifyFastForwardError({
      status: 422,
      message: "Reference cannot be updated: internal token 0xdeadbeef",
    });

    expect(JSON.stringify(outcome)).not.toMatch(/deadbeef/);
  });
});
