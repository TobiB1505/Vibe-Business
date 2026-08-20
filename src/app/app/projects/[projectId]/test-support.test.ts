import { describe, expect, it } from "vitest";
import { actionLabels, actionLabelText, source } from "./test-support";

/**
 * The extractor that four allowlists depend on (UI-6 §1).
 *
 * ## Why a test helper gets its own test
 *
 * Because everything downstream of it is an assertion of the form "every label
 * found is in this list", and that assertion is vacuously true over an empty
 * list. The extractor is therefore the only thing standing between the merge
 * panel's allowlist and a green suite that checks nothing.
 *
 * It has already been that close once: the four copies this replaced matched
 * `<button>` and `<a>` only, so converting a panel's controls to `<Button>` —
 * the ordinary next step for this codebase — would have emptied all four at
 * once, with no test failing to say so.
 */

describe("the extractor sees both spellings of a control", () => {
  it("finds DOM elements", () => {
    expect(actionLabelText('<button type="button">Merge approved change</button>')).toEqual([
      "Merge approved change",
    ]);
    expect(actionLabelText('<a href="/x">Open branch on GitHub</a>')).toEqual([
      "Open branch on GitHub",
    ]);
  });

  it("finds the primitives that render them", () => {
    // The regression this file exists for. `Button` renders a real `<button>`
    // and `Link` a real `<a>`, so to a person and to `getByRole` they are the
    // same control — only a source scanner can tell them apart.
    expect(actionLabelText('<Button variant="primary">Approve change</Button>')).toEqual([
      "Approve change",
    ]);
    expect(actionLabelText('<Link href="/x">Back to your projects</Link>')).toEqual([
      "Back to your projects",
    ]);
  });

  it("finds a control whose attributes span several lines", () => {
    const src = `
      <Button
        variant="primary"
        onClick={() => setConfirming("merge")}
        disabled={busy}
      >
        Merge approved change
      </Button>`;

    expect(actionLabelText(src)).toEqual(["Merge approved change"]);
  });

  it("does not mistake a longer tag for a short one", () => {
    // `<a>` must not match inside `<article>`, or every panel would report
    // labels it does not have.
    expect(() => actionLabels("<article>Not a control</article>")).toThrow();
  });
});

describe("the extractor refuses to find nothing", () => {
  it("throws rather than returning an empty list", () => {
    // The whole point. An allowlist over `[]` passes, so "found nothing" can
    // never be a normal return value here.
    expect(() => actionLabels("<p>Just prose</p>")).toThrow(/found no controls/);
  });

  it("names what it knows how to recognise, so the fix is obvious", () => {
    expect(() => actionLabels("<p>Just prose</p>")).toThrow(/button, a, Button, Link/);
  });
});

describe("every panel the allowlists cover still yields controls", () => {
  // A canary for the guard above: if any of these ever returns nothing, the
  // failure lands here with the file name rather than as a silently passing
  // assertion somewhere else.
  it.each([
    "merge-panel.tsx",
    "approval-panel.tsx",
    "outcome-panel.tsx",
    "business-impact-panel.tsx",
    "preview-panel.tsx",
    "validation-panel.tsx",
    "review-panel.tsx",
    "prepared-changes-section.tsx",
  ])("%s", (file) => {
    expect(actionLabels(source(file)).length).toBeGreaterThan(0);
  });
});
