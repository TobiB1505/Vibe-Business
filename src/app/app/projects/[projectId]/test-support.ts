import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared machinery for the panel source assertions (UI-6 §1).
 *
 * ## Why this is one function and not four copies
 *
 * Four test files — merge, approval, outcome, business impact — each carried
 * an identical `actionLabels`, and between them they hold the **exact action
 * allowlists** for the most consequential screens in the product: the merge
 * panel may offer "Merge approved change" and "Cancel" and nothing else; the
 * outcome panel may offer one label; no panel outside the merge panel may
 * offer a merge, deploy or ship control at all.
 *
 * Those four copies all extracted `<button>` and `<a>` from the raw source.
 * The moment a panel's controls became `<Button>` — which is the whole point
 * of this sprint — every one of them would have found **nothing**, and an
 * allowlist over an empty list passes. Four of the load-bearing safety tests
 * in this product would have gone quietly green while asserting nothing at
 * all, on merge and approval specifically.
 *
 * So there is one extractor, it knows the component forms as well as the DOM
 * ones, and it **refuses to return an empty list**. A regex that stops
 * matching is now a loud failure rather than a silent pass — which is the
 * property the four copies never had and could not have.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

export function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/**
 * Every tag that puts an activatable control on screen.
 *
 * Both spellings of each, because half this codebase writes the DOM element
 * and half writes the primitive that renders it. `Button` renders a real
 * `<button>` and `Link` a real `<a>`, so to a user — and to Playwright's
 * `getByRole` — they are the same thing. Only a source-text scanner can tell
 * them apart, and it must not care.
 */
const CONTROL_TAGS = ["button", "a", "Button", "Link"] as const;

/**
 * The visible label of every control in a panel's source.
 *
 * Throws rather than returning `[]`. A panel with no controls at all is not a
 * thing this suite asserts about, so an empty result never means "correctly
 * found nothing" — it means the extractor stopped working, and the assertions
 * built on it stopped being assertions.
 *
 * Known limit, stated rather than discovered later: a self-closing
 * `<Button … />` has no children and is not matched. Every control that a
 * person can read has a label between its tags; one that does not would be
 * unlabelled, which is its own defect.
 */
export function actionLabels(src: string): string[] {
  const inner = (tag: string) =>
    [...src.matchAll(new RegExp(`<${tag}\\b(?:=>|[^>])*?>([\\s\\S]*?)</${tag}>`, "g"))].map(
      (match) => match[1],
    );

  const labels = CONTROL_TAGS.flatMap(inner);

  if (labels.length === 0) {
    throw new Error(
      "actionLabels found no controls. Either the source has none — in which case " +
        "the assertion using this is meaningless — or the extractor no longer " +
        `recognises how they are written. Tags it knows: ${CONTROL_TAGS.join(", ")}.`,
    );
  }

  return labels;
}

/** `actionLabels` with the JSX expressions stripped, ready to compare to a list. */
export function actionLabelText(src: string): string[] {
  return actionLabels(src)
    .map((label) => label.replace(/\{[\s\S]*?\}/g, " ").trim())
    .filter(Boolean);
}
