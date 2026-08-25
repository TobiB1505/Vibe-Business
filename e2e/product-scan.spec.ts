import { expect, test } from "@playwright/test";

test.describe("Product Scan", () => {
  test("shows grounded individual discoveries and one re-scan action", async ({ page }) => {
    await page.goto("/e2e/product_scan_complete");

    await expect(page.getByRole("heading", { name: "Your product picture is ready." })).toBeVisible();
    await expect(page.getByText("Next.js application detected")).toBeVisible();
    await expect(page.getByText("authentication signal found")).toBeVisible();
    await expect(page.getByText("Product picture assembled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Scan my product again" })).toBeVisible();
    await expect(page.getByText("No invented percentage")).toHaveCount(0);
  });

  test("keeps a partial source visible without treating it as a failed product", async ({ page }) => {
    await page.goto("/e2e/product_scan_partial");

    await expect(page.getByText("Public product could not be fully read")).toBeVisible();
    await expect(page.getByText("Product picture assembled")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your product picture is ready." })).toBeVisible();
  });

  test("becomes a readable evidence rail on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/e2e/product_scan_complete");

    await expect(page.getByText("Product type", { exact: true })).toBeVisible();
    await expect(page.getByText("Brand identity", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("preserves every finding with reduced motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/e2e/product_scan_complete");
    await expect(page.getByText("Next.js application detected")).toBeVisible();
    await expect(page.getByText("Brand identity", { exact: true })).toBeVisible();
    await context.close();
  });
});
