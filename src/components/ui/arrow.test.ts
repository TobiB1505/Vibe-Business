import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The arrow means navigation (UI-30).
 *
 * ## What it meant before, which was nothing
 *
 * Seventeen forward arrows, on links, on form submits, on a `<Button>` that
 * changes a tab, and on a paragraph that is not a control at all. When a mark
 * appears on everything it says nothing — and the founder's report was the
 * plain version of that: *"wir haben jetzt viel zu viele Pfeile"*.
 *
 * It became visible once the buttons started looking like buttons. A surface
 * says "press me" on its own; the arrow beside the word was doing the same job
 * a second time on every control that had one, and the difference between
 * *this does something* and *this takes you somewhere* had nowhere left to
 * live.
 *
 * ## The rule
 *
 * **A link may carry the arrow. A control that acts in place may not.** So:
 * `StandaloneLink` keeps it, an `<a>` or `<Link>` keeps it, and a `<button>`,
 * `<Button>` or form submit does not — including one that ends at Stripe,
 * because until it resolves it looks like a button and behaves like one.
 *
 * ## The one exception, and why it is not a hole
 *
 * A control whose *whole* accessible name is the direction — the Move
 * stepper's "Next move" — is a mark with no word beside it. Removing the arrow
 * there leaves an empty button. That is the difference this file enforces:
 * **the arrow may be the label; it may never be an ornament beside one.**
 * Expressed as `aria-label` on the opening tag, which is exactly what an
 * icon-only control has and what a labelled one does not.
 */

const ARROWS = /<ArrowRightIcon\b/;

/** Controls. A `Link` and an `a` are deliberately absent. */
const CONTROLS = ["Button", "SubmitButton", "button"] as const;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** A study renders the replaced thing beside the replacement, on purpose. */
const STUDIES = "src/app/e2e/design-studies/";

function withoutComments(text: string): string {
  return text.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Every `<Tag …>…</Tag>` element, its opening tag and its body.
 *
 * Depth-counted on the tag name so a nested one closes its own, and on braces
 * for the opening tag — see the note on `button.test.ts`'s walker, which had
 * to learn the same thing.
 */
function elements(text: string, tag: string): { openTag: string; body: string }[] {
  const found: { openTag: string; body: string }[] = [];
  const open = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  for (const match of text.matchAll(open)) {
    let index = match.index! + match[0].length;
    let depth = 0;
    while (index < text.length) {
      const char = text[index]!;
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
      index += 1;
    }
    const openTag = text.slice(match.index!, index + 1);
    if (openTag.endsWith("/>")) {
      found.push({ openTag, body: "" });
      continue;
    }
    // Walk to the matching close, counting same-name opens on the way.
    const rest = text.slice(index + 1);
    let nesting = 1;
    let taken = 0;
    const both = new RegExp(`<${tag}(?=[\\s/>])|</${tag}>`, "g");
    for (const step of rest.matchAll(both)) {
      nesting += step[0].startsWith("</") ? -1 : 1;
      if (nesting === 0) {
        taken = step.index! + step[0].length;
        break;
      }
    }
    found.push({ openTag, body: rest.slice(0, taken) });
  }
  return found;
}

const PRODUCT = sourceFiles("src")
  .filter((path) => !path.startsWith(STUDIES) && !path.endsWith(".test.tsx"))
  .map((path) => ({ path, text: withoutComments(readFileSync(path, "utf8")) }));

describe("the arrow means navigation", () => {
  it("puts none on a control that acts in place", () => {
    const offenders: string[] = [];
    for (const { path, text } of PRODUCT) {
      for (const tag of CONTROLS) {
        for (const { openTag, body } of elements(text, tag)) {
          if (!ARROWS.test(openTag) && !ARROWS.test(body)) continue;
          // The mark may be the label. It may not be an ornament beside one.
          if (/aria-label=/.test(openTag)) continue;
          offenders.push(`${path} <${tag}> ${openTag.split("\n")[0]!.trim()}`);
        }
      }
    }
    expect(
      offenders,
      "An arrow on a control that acts in place. A surface already says " +
        "'press me'; the arrow is what says 'this takes you somewhere'.",
    ).toEqual([]);
  });

  it("keeps it where a link stands on its own", () => {
    // The other half. `StandaloneLink` is the one component whose whole job is
    // a link with a mark, and a rule that only ever removes things ends with
    // the mark gone from the place it earns.
    const link = readFileSync("src/components/ui/text-link.tsx", "utf8");
    expect(link).toContain("<ArrowRightIcon");
    expect(link).toContain("<ExternalLinkIcon");
  });

  it("draws every navigation arrow the same way", () => {
    /*
     * Two links used a literal `→` while every other one used the drawn mark.
     * A glyph takes the font's weight instead of the icon frame's 1.5px and
     * sits on the text baseline rather than the optical centre — the same
     * defect the disclosure caret records, in a different file.
     *
     * The trend mark in `audit-intelligence.tsx` is deliberately still a
     * glyph: it says which way a score moved, and it is not navigation.
     */
    const offenders = PRODUCT.filter(({ path, text }) =>
      /(?:<a\b|<Link\b)[\s\S]{0,600}?→/.test(text) && !path.endsWith("audit-intelligence.tsx"),
    ).map(({ path }) => path);
    expect(offenders, "a navigation arrow written as a text character").toEqual([]);
  });
});
