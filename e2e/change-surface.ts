import type { Page } from "@playwright/test";

/**
 * How a spec reaches a gate on the change surface.
 *
 * ## Why this exists
 *
 * Because the surface changed under these suites, and they were the last thing
 * still asserting the old one.
 *
 * `ChangeGates` drew every gate a change had — validation, preview, review,
 * approval, merge, outcome, business impact — in one column, all open, all
 * visible. That is the surface these panel suites were written against, and it
 * is the surface the fixture route mounted. It is also a surface no founder
 * ever reached: the Agent workspace replaced it, one stage at a time behind a
 * rail, and `ChangeGates` survived only because the fixture kept mounting it.
 *
 * So the panels are all still there and the guarantees are all still asserted.
 * What changed is that a spec now has to open what the product folds, the way
 * a founder does. That is not a weaker test — it is the first time these
 * assertions have been made against the screen the product actually draws.
 *
 * ## Why the record is folded at all
 *
 * `AgentReviewDecision` puts the outcome and the business impact behind a
 * disclosure labelled *After the merge*, and the decision above it is the
 * thing a founder came to make. The post-merge record is checkable rather than
 * unavoidable, which is this product's whole position on evidence — it is one
 * click, and the click is what these helpers make.
 */

/**
 * Opens the *After the merge* record, so the outcome and business-impact
 * panels are visible.
 *
 * Idempotent and tolerant of absence: a change that has not merged and has no
 * outcome renders no disclosure at all, and a spec asserting *that* should say
 * so with its own assertion rather than failing here.
 */
export async function openPostMergeRecord(page: Page): Promise<void> {
  const record = page.locator('details:has(summary:has-text("After the merge"))');

  if ((await record.count()) === 0) return;

  const first = record.first();
  /*
   * The element's own state, not the label's. Both labels are in the DOM at
   * all times — `group-open:hidden` swaps which one is painted — so matching
   * text says nothing about whether the record is open, and a second click
   * would close what the first opened.
   */
  if (await first.evaluate((element) => (element as HTMLDetailsElement).open)) return;

  await first.locator("summary").click();
}
