import { expect, test } from "@playwright/test";

/*
 * The animation was not visible in production and there was no test that would
 * have noticed. Every assertion about it was made against its source text,
 * which says only that the code exists — not that it runs.
 *
 * What these three tests establish, and the limit of it: the component mounts,
 * takes the picture over, survives a visibility change, and reserves its box.
 * They do **not** detect a runaway re-render. A `ResizeObserver` callback is
 * asynchronous, so a loop through it re-renders at frame rate rather than
 * throwing, and Playwright sees a page that looks correct while it burns a
 * phone's battery. That specific defect is caught by the dependency-array
 * assertion in `scan-handoff.test.ts`, and this comment exists so nobody reads
 * these tests as covering it.
 */
test.describe("the scan handoff", () => {
  test("takes the picture over and does not throw doing it", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/e2e/deep-scan-handoff");

    const box = page.getByTestId("handoff-box");
    await expect(box).toBeVisible();

    // The founder keeps watching the real browser first, so the box is still
    // empty here — this is the window the component used to crash in.
    await expect(box.locator("img")).toHaveCount(0);

    // And then the mark arrives. Generous, because it waits out the watch
    // window plus the switch-off, not because the timing is uncertain.
    await expect(box.locator("img")).toBeVisible({ timeout: 10_000 });

    // Nothing thrown on the way. This catches a component that crashes on
    // mount — which is what the section error boundary reports as "this
    // section didn't load" — but not a loop that merely re-renders.
    await expect(box.locator("div").first()).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("keeps running across a visibility change", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/e2e/deep-scan-handoff");
    await expect(page.getByTestId("handoff-box").locator("img")).toBeVisible({ timeout: 10_000 });

    /*
     * Leaving the tab is what the founder was doing when the section failed.
     * The tiles are required to *pause* on hidden — one of the three
     * obligations — so a visibility change unmounts and remounts them, which
     * is the moment a component with fragile effects gives up. What is
     * asserted is that nothing throws and the mark is still there afterwards.
     */
    const other = await context.newPage();
    await other.goto("/e2e/deep-scan-handoff");
    await page.bringToFront();

    await expect(page.getByTestId("handoff-box").locator("img")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
    await other.close();
  });

  test("reserves the box, so nothing on the page moves when it takes over", async ({ page }) => {
    await page.goto("/e2e/deep-scan-handoff");

    const box = page.getByTestId("handoff-box");
    const before = await box.boundingBox();

    await expect(box.locator("img")).toBeVisible({ timeout: 10_000 });
    const after = await box.boundingBox();

    // Arriving content never moves text somebody is reading.
    expect(after!.width).toBeCloseTo(before!.width, 0);
    expect(after!.height).toBeCloseTo(before!.height, 0);
  });
});
