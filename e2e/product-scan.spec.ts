import { expect, test } from "@playwright/test";

test.describe("Product Scan", () => {
  test("shows grounded individual discoveries and one re-scan action", async ({ page }) => {
    await page.goto("/e2e/product_scan_complete");

    await expect(page.getByRole("heading", { name: "Your product picture is ready" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understanding your product" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open scan & rescan" }).click();

    await expect(page.getByRole("heading", { name: "Understanding your product" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we're discovering" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Live activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we've discovered so far" })).toBeVisible();
    await expect(page.getByText("Next.js", { exact: true })).toBeVisible();
    await expect(page.getByText("authentication signal found")).toBeVisible();
    await expect(page.getByText("Product picture assembled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Scan my product again" })).toBeVisible();
    await expect(page.getByText("No invented percentage")).toHaveCount(0);

    await page.getByRole("button", { name: "Collapse scan" }).click();
    await expect(page.getByRole("heading", { name: "Your product picture is ready" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open scan & rescan" })).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps a partial source visible without treating it as a failed product", async ({ page }) => {
    await page.goto("/e2e/product_scan_partial");

    await page.getByRole("button", { name: "Open scan & rescan" }).click();

    await expect(page.getByText("Public product could not be fully read").first()).toBeVisible();
    await expect(page.getByText("Product picture assembled")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understanding your product" })).toBeVisible();
  });

  test("becomes a readable evidence rail on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/e2e/product_scan_complete");

    await page.getByRole("button", { name: "Open scan & rescan" }).click();

    await expect(page.getByTestId("product-scan-graph").getByText("Product type", { exact: true })).toBeVisible();
    await expect(page.getByText("Brand / identity", { exact: true }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("preserves every finding with reduced motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/e2e/product_scan_complete");
    await page.getByRole("button", { name: "Open scan & rescan" }).click();
    await expect(page.getByText("Next.js", { exact: true })).toBeVisible();
    await expect(page.getByText("Brand / identity", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("product-logo").first()).toBeVisible({ timeout: 7_000 });
    await context.close();
  });

  test("keeps the scanner geometry fixed while individual findings arrive", async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto("/e2e/product_scan_reveal");

    const scanner = page.getByTestId("product-scan-graph");
    const experience = page.getByRole("region", { name: "Understanding your product" });
    const scannerHeightBefore = await scanner.evaluate((element) => element.getBoundingClientRect().height);
    const experienceHeightBefore = await experience.evaluate((element) => element.getBoundingClientRect().height);

    await expect(page.getByTestId("product-logo").first()).toBeVisible({ timeout: 12_000 });

    expect(await scanner.evaluate((element) => element.getBoundingClientRect().height)).toBe(scannerHeightBefore);
    expect(await experience.evaluate((element) => element.getBoundingClientRect().height)).toBe(experienceHeightBefore);
  });
});
