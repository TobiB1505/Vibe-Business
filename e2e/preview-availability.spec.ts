import { expect, test } from "@playwright/test";

/**
 * The two ways a preview is not offered (Stufe 7).
 *
 * ## Why a browser test and not two unit assertions
 *
 * The card states are one word apart and the panel branches are adjacent, so a
 * unit test proves only that the switch has two arms. What this suite proves is
 * the thing that made the state worth splitting: which *sentence* a founder
 * reads. Both screens render the same shape — a heading, a sentence, no control
 * — and the whole value is in which sentence lands in front of whom.
 *
 * The failure being prevented is not a crash. It is a true sentence shown to
 * the wrong founder: "Vibe does not know how to start a development server for
 * your framework" told to somebody whose framework is fine, sending them to
 * look for a fault that is not there.
 */

test.describe("no development server for the framework", () => {
  test("names the framework, and says checking and merging still work", async ({ page }) => {
    await page.goto("/e2e/preview-not-supported");

    const notice = page.getByTestId("preview-not-supported");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("development server");
    // Most of the message. A founder told only "no preview" would reasonably
    // assume they had lost checking and merging too, and they have not.
    await expect(notice).toContainText("Checking a change and merging it still work");
  });

  test("offers no way to start one", async ({ page }) => {
    // The point of the state. This screen used to be `ready_to_start`: the
    // founder pressed it, confirmed publishing an unlisted public URL, and only
    // then learned nothing could start.
    await page.goto("/e2e/preview-not-supported");

    await expect(page.getByRole("button", { name: /preview/i })).toHaveCount(0);
  });
});

test.describe("Vibe cannot tell which application to run", () => {
  test("does not blame the framework", async ({ page }) => {
    await page.goto("/e2e/preview-repository-not-ready");

    const notice = page.getByTestId("preview-repository-not-ready");
    await expect(notice).toBeVisible();
    // The distinction, asserted as an absence. Nothing is wrong with the
    // framework here, so the framework sentence must not appear.
    await expect(notice).not.toContainText("development server");
  });

  test("points at the free scan that resolves it", async ({ page }) => {
    // This reason has a move and the other one does not, which is the entire
    // argument for two states rather than one.
    await page.goto("/e2e/preview-repository-not-ready");

    const notice = page.getByTestId("preview-repository-not-ready");
    await expect(notice).toContainText("free");
    // The canonical section href, built by `projectSectionHref` rather than
    // typed here — which is why the segment is `product` and not the section
    // id. A hand-written path is exactly how a recovery link goes stale.
    await expect(notice.getByRole("link", { name: "My Product" })).toHaveAttribute(
      "href",
      /\/product#product-scan$/,
    );
  });

  test("does not scroll sideways at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/e2e/preview-repository-not-ready");
    await expect(page.getByTestId("preview-repository-not-ready")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
