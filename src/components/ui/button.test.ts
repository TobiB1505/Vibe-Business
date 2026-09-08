import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is one way to make something pressable (UI-26).
 *
 * ## What this exists to catch
 *
 * Not a broken control — all five families worked. The defect was that the
 * product had *five vocabularies for the same job*, and which one a founder
 * met depended on which screen they were on:
 *
 *   `Button`            94 renders — primary 63, secondary 28, accent 3, danger 0
 *   `InlineAction`      21 call sites across 18 files, 3 of them destructive
 *   `IconButton`         1
 *   `TextAction`         1
 *   `buttonClasses()`   pasted onto a `Link` or a raw `button` in 28 files
 *
 * That is not a decision anybody made. `InlineAction` exists in its own file
 * precisely *because* nine controls had been written nine separate times —
 * naming the category stopped the ninth from becoming a tenth, and then the
 * named category became the third system. A component alone does not settle
 * it, which is why this file asserts the properties rather than the imports.
 *
 * ## Why every variant must be used
 *
 * `danger` was dead code for the whole life of the component while the product
 * had destructive actions in another family, and `accent` was three uses of a
 * rung between "the action" and "a control" that no rule could state. Both are
 * the same failure: a variant nobody can place is a variant the next person
 * places by guessing. So a variant with no call sites fails here — the list is
 * a description of the product, not a menu.
 */

const BUTTON = "src/components/ui/button.tsx";
const SOURCE = readFileSync(BUTTON, "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

/**
 * The studies are excluded for the reason they are excluded in
 * `choice-card.test.ts`: a study renders the replaced thing beside the
 * replacement on purpose, and the fixture route is a 404 in production.
 */
const STUDIES = "src/app/e2e/design-studies/";

/** Code, not the prose about it — this file's own docblock names all five. */
function withoutComments(text: string): string {
  return text.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
}

const PRODUCT = sourceFiles("src")
  .filter((path) => path !== BUTTON && !path.startsWith(STUDIES))
  .map((path) => ({ path, text: withoutComments(readFileSync(path, "utf8")) }));

/**
 * Every `<Button …>` opening tag in a file.
 *
 * Written as a scan rather than as `/<Button[\s\S]*?>/`, because the first
 * `>` in a real call site is usually inside `icon={<DismissIcon size={16} />}`
 * — a lazy regex stops there and reports every prop after the mark as missing.
 */
function buttonTags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(/<Button\b/g)) {
    let depth = 0;
    let index = match.index! + match[0].length;
    while (index < text.length) {
      const char = text[index]!;
      if (char === "{" || char === "<") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">") {
        if (depth === 0) break;
        depth -= 1;
      }
      index += 1;
    }
    tags.push(text.slice(match.index!, index + 1));
  }
  return tags;
}

/** The block that declares one record, so a claim about it cannot match prose. */
function block(name: string): string {
  const start = SOURCE.indexOf(`const ${name}`);
  expect(start, `${name} is gone from ${BUTTON}`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf("\n};", start);
  return SOURCE.slice(start, end);
}

const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;

describe("one pressable component", () => {
  it("leaves no second family in the product", () => {
    // `.vibe-control` is the material hook every pressable thing wears, so a
    // file that emits it is declaring a control — which is exactly how
    // `InlineAction`, `IconButton` and `TextAction` each began. Two named
    // exceptions: the consent toggle is a switch and not a button, and the
    // account's sign-out re-states the hook on top of `buttonClasses`.
    const allowed = [
      "src/components/consent/consent-preferences.tsx",
      "src/app/app/(account)/settings/page.tsx",
    ];
    const offenders = PRODUCT.filter(
      ({ path, text }) => text.includes("vibe-control") && !allowed.includes(path),
    ).map(({ path }) => path);

    expect(
      offenders,
      `A control is being declared here rather than in ${BUTTON}. Five families is ` +
        "how this product got here; use Button, or buttonClasses() for a Link.",
    ).toEqual([]);
  });

  it("has no file left to import the deleted ones from", () => {
    const gone = PRODUCT.filter(({ text }) =>
      /components\/ui\/(inline-action|icon-button)|from "\.\/(inline-action|icon-button)"/.test(
        text,
      ),
    ).map(({ path }) => path);
    expect(gone).toEqual([]);
  });
});

describe("every variant is a variant the product uses", () => {
  it.each(VARIANTS)("%s reaches a screen", (variant) => {
    const used = PRODUCT.some(
      ({ text }) =>
        text.includes(`variant="${variant}"`) || text.includes(`variant: "${variant}"`),
    );
    expect(
      used,
      `No call site asks for ${variant}. A variant nobody can place is one the ` +
        "next person places by guessing — which is what accent and danger both were.",
    ).toBe(true);
  });

  it("offers no fifth", () => {
    const declared = [...block("VARIANT_CLASSES").matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
    expect(declared).toEqual([...VARIANTS]);
  });
});

describe("the two arguments a phone made", () => {
  /**
   * Touch has no hover, so a container that only arrives under a pointer is
   * not a container on a phone. Both of these were learned from a real screen
   * and both are one edit away from being lost, because the class that loses
   * them still renders something that looks fine on a laptop.
   */
  it("gives every variant a container at rest", () => {
    for (const [variant, classes] of Object.entries(variantClasses())) {
      const resting = classes
        .split(/\s+/)
        .filter((token) => !token.startsWith("hover:") && !token.startsWith("active:"));
      expect(
        resting.some((token) => token.startsWith("bg-")),
        `${variant} has no resting fill — on a phone it is not a control until it is pressed`,
      ).toBe(true);
    }
  });

  it("makes the destructive one warn before it is touched", () => {
    const resting = variantClasses()
      .danger.split(/\s+/)
      .filter((token) => !token.startsWith("hover:") && !token.startsWith("active:"));
    // Fill, line and text, so it still reads as destructive with the hue
    // removed entirely — a danger tone that arrives on hover never arrives at
    // all on a phone, and "Delete account" becomes "Change".
    expect(resting).toContain("bg-coral-tint-soft");
    expect(resting).toContain("border-coral-line");
    expect(resting).toContain("text-coral");
  });
});

function variantClasses(): Record<string, string> {
  const body = block("VARIANT_CLASSES");
  const out: Record<string, string> = {};
  const entries = [...body.matchAll(/^ {2}(\w+):/gm)];
  entries.forEach((entry, index) => {
    const from = entry.index! + entry[0].length;
    const to = index + 1 < entries.length ? entries[index + 1]!.index! : body.length;
    out[entry[1]!] = [...body.slice(from, to).matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ");
  });
  return out;
}

describe("what `cn` cannot do for us", () => {
  /**
   * `cn` is a filtered join and not `tailwind-merge`, so a base `gap-2` and a
   * size `gap-1.5` both ship and the generated stylesheet decides. This file
   * has already paid for that once: three CTAs carried `text-body` and
   * `text-base` together and rendered at 14px while their class string said
   * 16, for the whole life of the landing page.
   */
  it("keeps radius, padding and gap in the size scale only", () => {
    const base = SOURCE.slice(
      SOURCE.indexOf("const BASE_CLASSES"),
      SOURCE.indexOf("export function buttonClasses"),
    );
    // `disabled:` variants are exempt and have to be: a disabled control keeps
    // one appearance at every size, so those belong in the base by definition.
    const tokens = [...base.matchAll(/"([^"]*)"/g)]
      .flatMap((m) => m[1]!.split(/\s+/))
      .filter((token) => token.length > 0 && !token.includes(":"));
    for (const family of ["rounded-", "gap-", "px-", "py-", "text-"]) {
      expect(
        tokens.some((token) => token.startsWith(family)),
        `${family} is in BASE_CLASSES, where a size cannot override it — it can only join it`,
      ).toBe(false);
    }
  });
});

describe("a button says what it is", () => {
  /**
   * The browser's implicit `submit` inside a form is what turned "Cancel" and
   * "Clear" into submissions the moment those controls stopped being their own
   * component — `InlineAction` hard-coded `type="button"` and `Button` did not.
   * The default is the safe one now, so a submit declares itself.
   */
  it("defaults to a button and not to a submit", () => {
    expect(SOURCE).toContain('type = "button"');
  });

  it("makes a submitting button say so, `formAction` included", () => {
    // A `formAction` button *is* a submit button; with the default flipped, one
    // that does not say `type="submit"` silently stops working.
    const offenders = PRODUCT.filter(({ text }) =>
      buttonTags(text).some(
        (tag) => tag.includes("formAction") && !tag.includes('type="submit"'),
      ),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  /**
   * The `label` requirement is the whole reason `IconButton` was a separate
   * component. Folding it into a size would have dropped it quietly: an
   * icon-only control with no accessible name is announced as "button", and
   * the entire category is icon-only.
   */
  it("cannot render a mark with no name", () => {
    // Keyed on the thing that is actually true — no children — rather than on
    // a size name, so the requirement cannot be sidestepped by picking a
    // different size.
    expect(SOURCE).toMatch(/icon: ReactNode;[\s\S]*?label: string;[\s\S]*?children\?: never;/);
  });
});

describe("two sizes, and only where a size is a question", () => {
  /**
   * The scale was `lg | md | sm` — **md 80, sm 47, lg 3.** Three names for what
   * is really "the button" and "the big one on the landing page", plus a third
   * that 47 call sites reached for because it existed. The founder's answer was
   * two: normal, and the marketing one.
   */
  it("offers exactly normal and marketing", () => {
    const declared = [...block("SIZE_CLASSES").matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
    expect(declared).toEqual(["normal", "marketing"]);
  });

  it("leaves no call site asking for a size that is gone", () => {
    const offenders = PRODUCT.filter(({ text }) =>
      buttonTags(text).some((tag) => /size="(sm|md|lg|xs|icon)"/.test(tag)),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  /**
   * A `ghost` has no size question to answer: it is the control inside a
   * sentence and has the one height that fits there. Written as `size?: never`
   * rather than by ignoring the prop — a prop that is quietly dropped is how a
   * system stops meaning what it says.
   */
  it("does not offer a size to an inline control", () => {
    expect(SOURCE).toMatch(/variant: InlineVariant;\s*\n\s*size\?: never;/);
  });

  it("keeps the inline shape out of the size scale", () => {
    // The 28px pill and the 32px circle are shapes, not sizes. If either ends
    // up in SIZE_CLASSES it becomes a third and a fourth answer to a question
    // the founder answered with two.
    const sizes = block("SIZE_CLASSES");
    expect(sizes).not.toContain("rounded-full");
  });
});
