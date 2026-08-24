import { expect, test } from "@playwright/test";

const PRODUCTS = "/e2e/account-products";

test.describe("My Products", () => {
  test("keeps the reference hierarchy without fabricated account metrics", async ({ page }) => {
    await page.goto(PRODUCTS);

    await expect(page.getByRole("heading", { name: "My Products" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Product summary" })).toBeVisible();
    await expect(page.getByTestId("product-list-card")).toHaveCount(3);
    await expect(page.getByText(/average business signal/i)).toHaveCount(0);
    await expect(page.getByText(/active products/i)).toHaveCount(0);
  });

  test("searches the real product context", async ({ page }) => {
    await page.goto(PRODUCTS);

    await page.getByRole("searchbox", { name: "Search products" }).fill("monetizing");

    await expect(page.getByTestId("product-list-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Needs You Now" })).toBeVisible();
  });

  test("filters setup products and can reset the result", async ({ page }) => {
    await page.goto(PRODUCTS);

    await page.getByRole("combobox", { name: "Filter products" }).selectOption("setup");
    await expect(page.getByTestId("product-list-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Half Set Up" })).toBeVisible();

    await page.getByRole("searchbox", { name: "Search products" }).fill("does not exist");
    await expect(page.getByRole("heading", { name: "No matching products" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search and filters" }).click();
    await expect(page.getByTestId("product-list-card")).toHaveCount(3);
  });

  test("sorts scored products above missing signals", async ({ page }) => {
    await page.goto(PRODUCTS);

    await page.getByRole("combobox", { name: "Sort products" }).selectOption("signal");
    const names = await page.getByTestId("product-list-card").locator("h2").allTextContents();

    expect(names).toEqual(["Quietly Fine", "Needs You Now", "Half Set Up"]);
  });
});

for (const width of [1440, 1024, 768, 375]) {
  test(`the product index fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PRODUCTS);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
