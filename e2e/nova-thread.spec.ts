import { expect, test } from "@playwright/test";

/**
 * A conversation that survives a reload (ADR 0109 §6, Slice 5).
 *
 * ## What only a browser proves
 *
 * That Nova's register and the product's read apart. A turn she wrote is a
 * bubble in her voice; a run finishing is the quiet one — `nova_messages.author`
 * is what keeps them separate in the database, and this is where that
 * separation either reaches a founder's eye or does not.
 *
 * And that an event says the right thing about how it ended. The row stores no
 * words at all — the migration's CHECK refuses them, so a reworded product
 * cannot leave last month's phrasing on screen — which means the sentence is
 * composed on every read and this is the only place the composition is seen.
 */

const WIDTHS = [
  { name: "phone", width: 390, height: 780 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

test.describe("a stored conversation", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("says what happened, and how each run ended", async ({ page }) => {
    await page.goto("/e2e/thread-transcript");

    await expect(page.getByText("I have read your product.")).toBeVisible();
    await expect(page.getByText("I finished reading your business.")).toBeVisible();
    await expect(page.getByText("The change is on your default branch.")).toBeVisible();

    // The one that failed says so, rather than borrowing the success sentence.
    await expect(page.getByText("The build did not finish.")).toBeVisible();
    await expect(
      page.getByText("I finished building, and there is a change to look at."),
    ).toHaveCount(0);
  });

  /**
   * Runs finish while nobody is looking, so which turns are new is the question
   * a founder opens a thread with. Home deliberately has no such mark — nothing
   * there happens without the founder — and that difference is the whole reason
   * a thread has one.
   */
  test("marks what arrived since the founder last looked", async ({ page }) => {
    await page.goto("/e2e/thread-transcript");

    // Two of six turns were read, so four carry the mark.
    await expect(page.getByText("New", { exact: true })).toHaveCount(4);
  });

  test("says so, and offers nothing, when nothing has happened yet", async ({ page }) => {
    await page.goto("/e2e/thread-empty");

    await expect(page.getByText("Nothing here yet")).toBeVisible();
    // No composer in this slice, and nothing pretending to be one.
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.locator('input[type="text"]')).toHaveCount(0);
  });

  for (const viewport of WIDTHS) {
    test(`reads at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/e2e/thread-transcript");

      await expect(page.getByText("The change is on your default branch.")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
