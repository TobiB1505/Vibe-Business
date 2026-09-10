import { expect, type Page } from "@playwright/test";

/**
 * Nothing may scroll sideways (UI-24).
 *
 * ## Why it waits for the fonts
 *
 * The measurement is taken right after a load, and at that moment the browser
 * may still be laying the page out in a **fallback** face because the web font
 * has not arrived. The fallback is wider, so a layout that fits by a few pixels
 * measures as overflowing — and only under load, because that is when fonts are
 * slow. It is a real intermediate state that no visitor ever sees settled.
 *
 * Twice in one session, in two different specs, at exactly 4px: `the repository
 * index fits at 768px` and `the product index fits at 768px`. Both passed three
 * times in isolation. Calling that a flake and re-running would have left the
 * mechanism in place in eighteen files.
 *
 * ## Why one helper rather than one line in each spec
 *
 * There were 44 copies of the same four lines, two of them already wrapped in a
 * local helper of the same name. A rule that has to be remembered 44 times is a
 * rule that will be forgotten on the 45th.
 */
export async function expectNoHorizontalOverflow(
  page: Page,
  message?: string,
  /**
   * Pixels of slack. Zero everywhere except the two screens that documented a
   * reason for one — sub-pixel layout rounding — and kept it here rather than
   * having it quietly tightened by a refactor.
   */
  tolerance = 0,
) {
  await page.evaluate(() => document.fonts.ready);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, message ?? "horizontal overflow in px").toBeLessThanOrEqual(tolerance);
}
