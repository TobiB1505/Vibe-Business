import { expect, type Page, test } from "@playwright/test";

async function openProfile(page: Page) {
  await page.goto("/e2e/account-profile");
  await expect(page.getByRole("heading", { name: "Account Profile", exact: true })).toBeVisible();
}

test.describe("account profile", () => {
  test("shows the connected identity and only facts Vibe owns", async ({ page }) => {
    await openProfile(page);

    const profile = page.getByTestId("account-profile");
    await expect(profile.getByText("TobiB1505", { exact: true }).first()).toBeVisible();
    await expect(profile.getByText("tobi.bayer@outlook.de", { exact: true }).first()).toBeVisible();
    await expect(profile.getByText("@TobiB1505", { exact: true }).first()).toBeVisible();
    await expect(profile.getByRole("heading", { name: "Connected accounts" })).toBeVisible();
    await expect(profile.getByRole("heading", { name: "Your workspace" })).toBeVisible();
    await expect(profile.getByText("5", { exact: true })).toBeVisible();
    await expect(profile.getByText("8", { exact: true })).toBeVisible();

    for (const unsupported of [
      "Google",
      "Language",
      "Time zone",
      "Two-factor authentication",
      "Last sign-in",
      "Edit profile",
    ]) {
      await expect(profile.getByText(unsupported, { exact: true })).toHaveCount(0);
    }
  });

  test("keeps every account destination a real link", async ({ page }) => {
    await openProfile(page);

    await expect(page.getByRole("link", { name: "Manage GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/settings/installations",
    );
    await expect(page.getByRole("link", { name: "Go to my products" })).toHaveAttribute(
      "href",
      "/app/products",
    );
    await expect(page.getByRole("link", { name: /Account settings/ })).toHaveAttribute(
      "href",
      "/app/settings",
    );
    await expect(page.getByRole("link", { name: /Billing/ })).toHaveAttribute(
      "href",
      "/app/billing",
    );
  });

  test("reflows without horizontal page overflow on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openProfile(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole("heading", { name: "Personal information" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Account controls" })).toBeVisible();
  });
});
