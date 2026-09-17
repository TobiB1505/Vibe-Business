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

/**
 * The one input in this product, at rest (ADR 0109 §5, ADR 0110).
 *
 * Only the resting state, and that is the right shape rather than a limitation:
 * pressing reaches a Server Action that begins with `requireProjectAccess`, and
 * the browser suite has no session. What a browser has to prove here is all
 * true before anything is sent — that the field is legible and reachable, that
 * it is bounded, and that a founder can see what asking costs **before** they
 * ask, which is rule 60's shape applied to an operation that costs nothing.
 */
test.describe("the composer", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/e2e/thread-composer");
  });

  test("says what asking costs, in the word rather than a zero", async ({ page }) => {
    // ADR 0094: a free operation says so. A zero is a number in a currency and
    // invites the question of when it stops being zero.
    await expect(page.getByText("Included", { exact: true })).toBeVisible();
    await expect(page.getByText("0 Credits")).toHaveCount(0);
  });

  test("is one bounded field with a name a screen reader can use", async ({ page }) => {
    const field = page.getByLabel("Ask Nova about your product");

    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("maxlength", "1200");
    await expect(page.locator("textarea")).toHaveCount(1);
  });

  test("is reachable and pressable from the keyboard", async ({ page }) => {
    const field = page.getByLabel("Ask Nova about your product");

    await field.focus();
    await expect(field).toBeFocused();
    await field.fill("why is conversion the blocker?");

    await expect(page.getByRole("button", { name: "Ask" })).toBeEnabled();
  });

  for (const viewport of WIDTHS) {
    test(`fits at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await expect(page.getByLabel("Ask Nova about your product")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
