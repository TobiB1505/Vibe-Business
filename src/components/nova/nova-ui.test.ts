import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What Nova's components may contain, asserted against their source (§K).
 *
 * Most of Nova's language is already checked as data — the sentences live in
 * `feed.ts` and the labels in `actions.ts`, and `feed.test.ts` sweeps them as
 * values. What is left for a source contract is the class of regression a
 * value test cannot see: a sentence typed straight into JSX, a chat box, a
 * price hardcoded beside a button, a second copy of a stage label.
 *
 * The same technique and the same comment-stripping as
 * `command-center-ui.test.ts`, for the same reason: the comments here quote
 * the very words the assertions forbid, in order to explain why the screens
 * never say them.
 */

const DIR = join(process.cwd(), "src/components/nova");
const FILES = ["nova-feed.tsx", "nova-message.tsx", "nova-choice.tsx"];

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/** Comments and imports removed: what is left is what renders. */
function rendered(file: string): string {
  return source(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/^import[\s\S]*?;$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("Nova's components hold no copy of their own", () => {
  /**
   * The one rule the whole slice rests on. Every sentence a founder reads
   * comes from `feed.ts` or `actions.ts`, so every sentence is swept by a
   * value test. A string typed into JSX is a string no test reads — and the
   * first one to appear would be the one that promised something.
   */
  it("renders no prose that did not come from an entry", () => {
    const literalProse = /(?:>|\}\s)\s*[A-Z][a-z]+[^<{}]{12,}</g;

    /*
     * Proved live first: a sweep asserting "no matches" passes identically
     * when the pattern is broken and when the source is clean, and the whole
     * value of the test is the difference between those two.
     */
    const planted = '<p className="x">This moves your default branch and runs your CI.</p>';
    expect(planted.match(literalProse)).not.toBeNull();

    for (const file of FILES) {
      const jsxText = rendered(file).match(literalProse) ?? [];
      expect(jsxText, `${file} contains literal prose`).toEqual([]);
    }
  });

  it("prints no price of its own", () => {
    for (const file of FILES) {
      expect(rendered(file), file).not.toMatch(/\d+\s*Credits/i);
    }
  });

  it("names no stage of its own", () => {
    /* One table owns that copy, and the progress row reads from it. */
    expect(rendered("nova-feed.tsx")).toContain("OPERATION_STAGE_LABELS[");
    for (const file of FILES) {
      expect(rendered(file), file).not.toMatch(/"(preparing_workspace|running_agent|installing)"/);
    }
  });
});

describe("Nova offers no surface the product does not have", () => {
  /**
   * §M: no unrestricted chat input. Nothing in this product reads free text
   * into a decision except two allowlisted, length-bounded fields that belong
   * to their own domains. A box on the feed would be a third, unbounded one.
   */
  it("has no text input of any kind", () => {
    for (const file of FILES) {
      const markup = rendered(file);
      expect(markup, file).not.toMatch(/<(input|textarea)\b/);
      expect(markup, file).not.toMatch(/contentEditable/);
    }
  });

  /** A feed is a render of current state, not a record of what happened. */
  it("keeps no transcript", () => {
    for (const file of FILES) {
      expect(rendered(file), file).not.toMatch(/\b(transcript|history|messages\[)\b/i);
    }
  });
});

describe("progress reads as progress", () => {
  /**
   * Named stages and no percentage, everywhere in the product
   * (`operations/schema.ts:16-19`). A bar implies a rate, and nothing here
   * knows one.
   */
  it("draws no percentage or progress bar", () => {
    const markup = rendered("nova-feed.tsx");

    expect(markup).not.toMatch(/%/);
    expect(markup).not.toMatch(/role="progressbar"/);
    expect(markup).not.toMatch(/\bpercent|\bprogressBar\b/i);
  });
});

describe("the confirmation", () => {
  /** The note is the catalog's, so the two confirmed controls can differ. */
  it("reads its wording from the option rather than stating one", () => {
    expect(rendered("nova-choice.tsx")).toContain("option.confirmationNote");
  });

  it("confirms only what the catalog says to confirm", () => {
    expect(rendered("nova-choice.tsx")).toContain("option.requiresConfirmation");
  });
});
