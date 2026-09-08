import { expect, test } from "@playwright/test";

/**
 * Nova's own writing, in the thread.
 *
 * The unit tests decide what the sentences say and when they appear. What they
 * cannot see is whether a founder reads **one run of two lines** or two claims
 * that seem to disagree — and whether the ordinary state, nothing written at
 * all, looks deliberate rather than broken.
 */

const NONE = "/e2e/nova-voice-none";
const SPOKEN = "/e2e/nova-voice-spoken";
const ASIDE = "/e2e/nova-voice-aside";

test.describe("the ordinary state", () => {
  /** Everything this slice added is absent, and the thread is its old self. */
  test("says the moment and nothing else", async ({ page }) => {
    await page.goto(NONE);

    await expect(page.getByText(/there is a change waiting for you/i)).toBeVisible();
    await expect(page.getByText(/i have since corrected/i)).toHaveCount(0);
  });
});

test.describe("when Nova wrote about the document", () => {
  test("says her sentence under the moment, not instead of it", async ({ page }) => {
    await page.goto(SPOKEN);

    await expect(page.getByText(/there is a change waiting for you/i)).toBeVisible();
    await expect(page.getByText(/nothing on the site says what it costs/i)).toBeVisible();
  });

  /**
   * One speaker continuing. The tail points at whoever is talking, so a second
   * one in the same run reads as two people — the phone's own rule, and the
   * one `speechBubbles` applies.
   */
  test("carries exactly one tail across the run", async ({ page }) => {
    await page.goto(SPOKEN);

    await expect(page.locator(".bubble-tailed")).toHaveCount(1);
  });

  /** Her sentence and Vibe's version of the same facts never appear together. */
  test("shows no aside beside it", async ({ page }) => {
    await page.goto(SPOKEN);

    await expect(page.getByText(/is the thing to repair first/i)).toHaveCount(0);
  });
});

test.describe("when nothing was written", () => {
  test("says Vibe's own line, in the quieter register", async ({ page }) => {
    await page.goto(ASIDE);

    await expect(page.getByText(/your website is the thing to repair first/i)).toBeVisible();
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 900 } });

  test("does not scroll sideways", async ({ page }) => {
    await page.goto(SPOKEN);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
