import { describe, expect, it } from "vitest";
import { novaCandidatePrompt } from "@/modules/nova/feed";
import { novaCandidateAction } from "@/modules/nova/focus";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { footnoteFor } from "./footnote";

/**
 * The footnote's refusal to repeat the button (audit finding 3).
 *
 * The last case is the one that matters: rather than restating the collision
 * as a string literal, it reads both tables and asserts that wherever they
 * converge the card prints the sentence once. A future prompt that starts
 * echoing its own label fails here instead of shipping.
 */
describe("footnoteFor", () => {
  it("keeps a prompt that says something the control does not", () => {
    expect(footnoteFor("Move it onto your default branch?", "Merge it")).toBe(
      "Move it onto your default branch?",
    );
  });

  it("drops a prompt that is the label with a question mark", () => {
    expect(footnoteFor("Run the audit again?", "Run the audit again")).toBeNull();
  });

  it("ignores case and trailing punctuation, and nothing else", () => {
    expect(footnoteFor("Build it.", "build it")).toBeNull();
    // Not a restatement — it names the subject the label leaves out.
    expect(footnoteFor("Build the pricing page?", "Build it")).toBe("Build the pricing page?");
  });

  it("has nothing to say when either side is absent", () => {
    expect(footnoteFor(null, "Merge it")).toBeNull();
    expect(footnoteFor("Want a plan for it?", undefined)).toBe("Want a plan for it?");
  });

  it("pairs every prompt with its own action, and prints each sentence once", () => {
    const kinds = ["merge_ready", "execution_offered", "plan_offered", "audit_outdated"] as const;

    for (const kind of kinds) {
      const prompt = novaCandidatePrompt(kind);
      const actionId = novaCandidateAction(kind);
      expect(prompt, `${kind} has a prompt`).not.toBeNull();
      expect(actionId, `${kind} has an action`).not.toBeNull();
      if (prompt === null || actionId === null) continue;

      const label = NOVA_ACTION_META[actionId].label;
      const footnote = footnoteFor(prompt, label);

      if (footnote === null) {
        // Suppressed, so the two must genuinely have been the same sentence.
        expect(prompt.replace(/[?.!]+$/, "").toLowerCase(), kind).toBe(label.toLowerCase());
      } else {
        // Kept, so it must say something the button does not.
        expect(footnote, kind).toBe(prompt);
        expect(footnote.replace(/[?.!]+$/, "").toLowerCase(), kind).not.toBe(label.toLowerCase());
      }
    }
  });
});
