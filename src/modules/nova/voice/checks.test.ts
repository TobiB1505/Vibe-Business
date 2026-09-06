import { describe, expect, it } from "vitest";

import { checkNovaMessage, numeralsIn } from "./checks";
import { MAX_NOVA_MESSAGE_CHARS } from "./payload";

/**
 * The validator's own tests — free, deterministic, part of `pnpm test`.
 *
 * Two properties are being pinned, and the second matters as much as the
 * first: every rule catches what it exists to catch, **and** no rule fires on
 * a message Nova should be allowed to send. A validator that refuses good
 * output is how the fallback becomes the normal path and the voice layer
 * quietly stops existing.
 */

const GOOD =
  "I finished reading your product. It is a scheduling tool for small clinics, and the code and the live site agree about what it does. Have a look and tell me if I got it wrong.";

function check(message: string, extra: Partial<Parameters<typeof checkNovaMessage>[0]> = {}) {
  return checkNovaMessage({ message, allowedNumericFacts: [], ...extra });
}

const codes = (message: string, extra?: Partial<Parameters<typeof checkNovaMessage>[0]>) =>
  check(message, extra).failures.map((failure) => failure.code);

describe("a message Nova should be allowed to send", () => {
  it("passes every rule", () => {
    const result = check(GOOD);
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("may quote a numeral the payload authorized", () => {
    const message =
      "Your business scores 68 out of 100 today. Pricing is the part I would fix first.";
    expect(codes(message, { allowedNumericFacts: ["68", "100"] })).toEqual([]);
  });

  it("may deny a claim it is forbidden from making", () => {
    const message =
      "I have prepared the change and the independent check is still running. This does not mean it is live — Vibe never deploys anything for you.";
    expect(codes(message)).toEqual([]);
  });

  it("may say the product name back to the founder", () => {
    expect(codes("I have read Acme Scheduler and I think I understand what it does now.")).toEqual(
      [],
    );
  });
});

describe("fabricated numbers", () => {
  it("rejects a numeral the payload never carried", () => {
    expect(codes("I changed 5 files for you in this one.", { allowedNumericFacts: ["4"] })).toEqual(
      ["unallowed_number"],
    );
  });

  it("names the offending numeral rather than reporting that something is wrong", () => {
    const [failure] = check("This will cost up to 160 Credits.", {
      allowedNumericFacts: ["150"],
    }).failures;
    expect(failure.detail).toBe("160");
  });

  it("reads a decimal or thousands separator as one numeral", () => {
    expect(numeralsIn("1,250 and 3.5 and 68")).toEqual(["1,250", "3.5", "68"]);
  });

  it("passes when every numeral is allowed", () => {
    expect(
      codes("68 out of 100, and 4 files.", { allowedNumericFacts: ["68", "100", "4"] }),
    ).toEqual([]);
  });
});

describe("claims this product may never make", () => {
  it.each([
    ["Your change is live now and customers can see it.", "is live"],
    ["I have deployed the new pricing page.", "deployed"],
    ["The change is safe to merge.", "is safe"],
    ["This is guaranteed to improve your conversion.", "guaranteed"],
    ["Everything works after this change.", "everything works"],
    // The eval's own finding: the infinitive slipped past every other variant.
    ["Review it and confirm it is ready to go live.", "go live"],
  ])("rejects %j", (message) => {
    expect(codes(message)).toContain("banned_claim");
  });

  it("does not fire on a denial of the same claim", () => {
    expect(codes("Merging does not make it live, and I cannot tell you it is safe.")).toEqual([]);
  });

  it("rejects a causal claim through the measurement detector", () => {
    expect(codes("This change caused your signups to rise.")).toContain("causal_claim");
  });

  it("accepts the observational form the product actually uses", () => {
    expect(
      codes("I looked at your public pages after the merge and they are still being served."),
    ).toEqual([]);
  });
});

describe("state-specific falsehoods", () => {
  it("rejects a case-forbidden string", () => {
    expect(
      codes("The checks passed and you can review it now.", {
        forbiddenSubstrings: ["checks passed"],
      }),
    ).toContain("forbidden_content");
  });

  it("matches case-insensitively and across collapsed whitespace", () => {
    expect(
      codes("The Audit\n   Passed with no problems.", { forbiddenSubstrings: ["audit passed"] }),
    ).toContain("forbidden_content");
  });
});

describe("Vibe's internal vocabulary", () => {
  it("rejects a module name", () => {
    expect(codes("Your repository intelligence snapshot is out of date.")).toContain("module_name");
  });

  it("keeps the product vocabulary a founder is meant to learn", () => {
    expect(
      codes("Your Action Plan has a first Move ready, and the Agent can build part of it."),
    ).toEqual([]);
  });
});

describe("shape", () => {
  it("rejects an empty message before reading it as prose", () => {
    const result = check("   ");
    expect(result.failures.map((failure) => failure.code)).toEqual(["empty_message"]);
  });

  it("rejects a message over the character ceiling", () => {
    expect(codes("a".repeat(MAX_NOVA_MESSAGE_CHARS + 1))).toContain("too_long");
  });

  it("rejects a fourth paragraph", () => {
    expect(codes(["one.", "two.", "three.", "four."].join("\n\n"))).toContain(
      "too_many_paragraphs",
    );
  });

  it.each([["- a bullet"], ["## a heading"], ["```code```"]])("rejects %j", (message) => {
    expect(codes(`${message}\nand some prose to clear the length floor.`)).toContain(
      "markdown_structure",
    );
  });
});

describe("spelled-out quantities", () => {
  it("warns rather than failing, because the rule cannot be made precise", () => {
    const result = check("I found two areas worth looking at before you ship anything else.");
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["spelled_quantity"]);
    expect(result.ok).toBe(true);
  });

  it("leaves ordinary English alone", () => {
    expect(check("There is one thing I would like you to confirm first.").warnings).toEqual([]);
  });
});

/**
 * The failure this validator is **not** for, recorded so nobody assumes it is.
 *
 * An invented business outcome — "and more signups", "which is costing you
 * customers", "that tends to kill conversions" — is fluent, numerically clean,
 * uses no banned claim, names no module, and contains no causal connective, so
 * every rule here passes it. That is not a hole to plug: it is the boundary
 * ADR 0084 drew when it chose the model by measurement rather than by adding
 * regular expressions. `causal_claim` catches *stated* causation ("caused",
 * "led to", "thanks to"); an implied outcome has no token to match on, and a
 * pattern loose enough to catch one would reject ordinary grounded English.
 *
 * The layers that do catch it are the prompt (v4's exclusivity and sequencing
 * rules) and the eval's `no_invention` criterion, judged by Opus — "does the
 * message avoid adding anything the payload did not already say".
 *
 * This test exists because a fixture in this repository was once exactly this
 * failure, presented as an example of success, and every deterministic test
 * around it passed.
 */
describe("what this validator deliberately does not catch", () => {
  const GROUNDED_PAYLOAD_NUMERALS: string[] = [];

  it.each([
    "Pricing clarity is the thing standing between you and more signups right now.",
    "People cannot work out how to pay you, which is costing you customers.",
    "That opacity tends to keep people from converting.",
  ])("accepts an invented business outcome: %j", (message) => {
    const result = checkNovaMessage({
      message,
      allowedNumericFacts: GROUNDED_PAYLOAD_NUMERALS,
    });

    expect(result.ok, "if this now fails, the boundary moved — update the docblock").toBe(true);
  });

  /** The half it does catch, so the distinction is visible rather than asserted. */
  it.each([
    "The missing price caused fewer signups.",
    "Pricing clarity led to more signups.",
    "You are held back thanks to the missing price.",
  ])("still refuses %j, where causation is stated outright", (message) => {
    const result = checkNovaMessage({ message, allowedNumericFacts: [] });

    expect(result.failures.map((failure) => failure.code)).toContain("causal_claim");
  });
});
