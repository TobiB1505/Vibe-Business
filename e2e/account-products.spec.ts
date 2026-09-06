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
    // The heading is the name the product goes by. "Needs You Now" is the
    // label the founder typed at connection time, and it stays on the card
    // below — see the next test.
    await expect(page.getByRole("heading", { name: "Payflow" })).toBeVisible();
  });

  test("leads with the product's own name and keeps the founder's label", async ({ page }) => {
    await page.goto(PRODUCTS);

    const card = page.getByTestId("product-list-card").filter({ hasText: "Payflow" });
    await expect(card.getByRole("heading", { name: "Payflow" })).toBeVisible();
    await expect(card).toContainText("Project: Needs You Now");

    // A row whose product name is the label already needs no second line.
    const same = page.getByTestId("product-list-card").filter({ hasText: "Quietly Fine" });
    await expect(same).not.toContainText("Project:");
  });

  test("finds a product by the name on the card", async ({ page }) => {
    // The search box has to index what the founder can read. Leaving it on the
    // project label made "Payflow" return nothing at all.
    await page.goto(PRODUCTS);

    await page.getByRole("searchbox", { name: "Search products" }).fill("payflow");

    await expect(page.getByTestId("product-list-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Payflow" })).toBeVisible();
  });

  test("shows the product's logo where it has one, and initials where it does not", async ({
    page,
  }) => {
    await page.goto(PRODUCTS);

    const withLogo = page.getByTestId("product-list-card").filter({ hasText: "Quietly Fine" });
    await expect(withLogo.getByTestId("product-logo")).toBeVisible();

    const withoutLogo = page.getByTestId("product-list-card").filter({ hasText: "Payflow" });
    await expect(withoutLogo.getByTestId("product-logo")).toHaveCount(0);
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

    expect(names).toEqual(["Quietly Fine", "Payflow", "Half Set Up"]);
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
