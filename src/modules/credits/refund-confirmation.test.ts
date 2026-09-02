import { describe, expect, it } from "vitest";
import {
  readRefundConfirmation,
  refundConfirmationRefusal,
  REFUND_CONFIRMATION_WORD,
} from "./refund-confirmation";

/**
 * The three answers, and the one that exists because of a real question.
 *
 * A founder reading the refund instructions wrote `VIBE_REFUND_CONFIRM=true`.
 * Under the boolean this replaced, that produced a dry run — safe, and
 * indistinguishable from success: output appears, the command exits cleanly,
 * and the customer is still owed their Credits. The refusal is what turns a
 * silent no into a visible one.
 */

describe("nothing set means read, print, write nothing", () => {
  it("treats an unset variable as a dry run", () => {
    expect(readRefundConfirmation(undefined)).toEqual({ kind: "dry_run" });
  });

  it("treats an empty or blank value as a dry run", () => {
    // A shell that expands an unset variable leaves an empty string, which is
    // the same intent as not setting it.
    expect(readRefundConfirmation("")).toEqual({ kind: "dry_run" });
    expect(readRefundConfirmation("   ")).toEqual({ kind: "dry_run" });
  });
});

describe("the word confirms", () => {
  it("accepts exactly the word", () => {
    expect(readRefundConfirmation(REFUND_CONFIRMATION_WORD)).toEqual({ kind: "confirmed" });
  });

  it("tolerates the whitespace a shell or a copy-paste leaves", () => {
    expect(readRefundConfirmation("  yes  ")).toEqual({ kind: "confirmed" });
    expect(readRefundConfirmation("yes\n")).toEqual({ kind: "confirmed" });
  });
});

describe("anything else is refused rather than ignored", () => {
  it.each(["true", "TRUE", "Yes", "1", "y", "on", "ja", "confirm"])(
    "refuses %s and says what was given",
    (given) => {
      const result = readRefundConfirmation(given);

      expect(result.kind).toBe("not_the_word");
      if (result.kind !== "not_the_word") return;
      expect(result.given).toBe(given.trim());
    },
  );

  it("does not quietly widen what confirms a money movement", () => {
    // The tempting fix for the founder's `true` is to accept it. That removes
    // this case by making a deliberate switch less deliberate, which is the
    // wrong direction for the one control that moves Credits.
    expect(readRefundConfirmation("true").kind).not.toBe("confirmed");
    expect(readRefundConfirmation("1").kind).not.toBe("confirmed");
  });

  it("is case sensitive, so `Yes` is told rather than assumed", () => {
    expect(readRefundConfirmation("Yes").kind).toBe("not_the_word");
  });
});

describe("the refusal names what was typed", () => {
  it("quotes the value back, because an operator who cannot see it retries it", () => {
    const message = refundConfirmationRefusal("true");

    expect(message).toContain('"true"');
    expect(message).toContain(`"${REFUND_CONFIRMATION_WORD}"`);
  });

  it("says plainly that nothing was posted", () => {
    // The whole failure mode is a person believing the refund landed.
    expect(refundConfirmationRefusal("true")).toContain("Nothing was posted");
  });
});
