import { expect, test } from "@playwright/test";

/**
 * Deep Scan, where a founder actually looks.
 *
 * The founder's report was that Deep Scan is not visible enough in the Product
 * Scan, and the cause was structural: its only entrance was the word "Deep
 * Scan" inside a four-row provenance list, and a scan that had already run
 * added nothing to that page at all.
 *
 * The unit tests prove what `buildDeepScanSpotlight` may say. These prove a
 * person can see it — including the one thing a domain test cannot catch, a
 * price rendered beside a scan that is free ([CLAUDE.md](../CLAUDE.md) rule 69).
 */

const SPOTLIGHT = "[data-testid=deep-scan-spotlight]";

test.describe("Deep Scan has never run", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-spotlight-offered");
  });

  test("leads with the sign-in, not with a source row", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Most of your product is behind your sign-in." }),
    ).toBeVisible();
  });

  test("offers the included scan with no price beside it", async ({ page }) => {
    const spotlight = page.locator(SPOTLIGHT);
    await expect(spotlight.getByRole("link", { name: "Run free Deep Scan" })).toBeVisible();
    // The defect this exists for: a number beside a control that charges none.
    await expect(spotlight.getByText(/Credits/)).toHaveCount(0);
  });

  test("says why Vibe thinks it is worth running", async ({ page }) => {
    await expect(
      page.locator(SPOTLIGHT).getByText("Vibe found a sign-in surface on your website."),
    ).toBeVisible();
  });

  test("counts nothing it has not counted", async ({ page }) => {
    // No "0 pages", no "0 screens" — an unmeasured product is not an empty one.
    await expect(page.locator(SPOTLIGHT).getByText(/^0$/)).toHaveCount(0);
  });
});

test.describe("Deep Scan has run", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/deep-scan-spotlight-read");
  });

  test("says what was read, in pages and screens", async ({ page }) => {
    await expect(
      page.getByRole("heading", {
        name: "Vibe read 7 pages across 2 screens inside your product.",
      }),
    ).toBeVisible();
  });

  test("names the surfaces it recognised", async ({ page }) => {
    const surfaces = page.locator("[data-testid=deep-scan-spotlight-surfaces]");
    await expect(surfaces.getByText("Dashboard")).toBeVisible();
    await expect(surfaces.getByText("Settings")).toBeVisible();
  });

  test("shows when it was read", async ({ page }) => {
    await expect(page.locator(SPOTLIGHT).getByText("Last read")).toBeVisible();
  });

  test("does not offer to spend Credits from this page", async ({ page }) => {
    const spotlight = page.locator(SPOTLIGHT);
    // The doorway leads to the panel; every priced control lives there, on a
    // route that has loaded the state to authorise one.
    await expect(spotlight.getByRole("link", { name: "See what Vibe read" })).toBeVisible();
    await expect(spotlight.getByText(/Credits/)).toHaveCount(0);
  });
});

test.describe("Deep Scan cannot run", () => {
  test("never renders a heading with no action and no reason", async ({ page }) => {
    await page.goto("/e2e/deep-scan-spotlight-unavailable");

    const spotlight = page.locator(SPOTLIGHT);
    await expect(spotlight.getByRole("link")).toHaveCount(0);
    await expect(
      spotlight.getByText("Add your production website URL, and Vibe can sign in to it."),
    ).toBeVisible();
  });
});

test.describe("the spotlight on a narrow screen", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits without scrolling sideways", async ({ page }) => {
    await page.goto("/e2e/deep-scan-spotlight-read");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
