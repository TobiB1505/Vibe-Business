import { expect, test } from "@playwright/test";

const REPOSITORIES = "/e2e/account-repositories";

test.describe("Repositories", () => {
  test("uses the reference hierarchy without inventing live GitHub activity", async ({ page }) => {
    await page.goto(REPOSITORIES);

    await expect(page.getByRole("heading", { name: "Repositories", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "GitHub connected" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connected repositories" })).toBeVisible();
    await expect(page.getByText(/recent activity across/i)).toHaveCount(0);
    await expect(page.getByText(/pull requests/i)).toHaveCount(0);
    await expect(page.getByText("Showing 1–5 of 7 repositories")).toBeVisible();
  });

  test("keeps search, filter and page state in the URL", async ({ page }) => {
    await page.goto(REPOSITORIES);

    await page.getByRole("searchbox", { name: "Search repositories" }).fill("develop");
    await expect(page).toHaveURL(/q=develop/);
    await expect(page.getByRole("link", { name: "Landing Pro", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Team Monitor", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Clear repository search" }).click();
    await page.getByRole("combobox", { name: "Filter repository visibility" }).selectOption("public");
    await expect(page).toHaveURL(/visibility=public/);
    await expect(page.getByText("Showing 1–3 of 3 repositories")).toBeVisible();
  });

  test("paginates the bounded repository ledger", async ({ page }) => {
    await page.goto(REPOSITORIES);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("Showing 6–7 of 7 repositories")).toBeVisible();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
  });

  test("has an honest first-connection state", async ({ page }) => {
    await page.goto("/e2e/account-repositories-empty");

    await expect(page.getByRole("heading", { name: "No repositories connected" })).toBeVisible();
    await expect(page.getByText("GitHub connected")).toHaveCount(0);
  });
});

for (const width of [1440, 1024, 768, 375]) {
  test(`the repository index fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(REPOSITORIES);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
