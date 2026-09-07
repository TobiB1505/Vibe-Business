import { expect, test } from "@playwright/test";

/**
 * The switch that makes the redesign checkable.
 *
 * `VIBE_PALETTE` answers "what does this deployment show" and takes effect at
 * build time — the root layout is baked into every statically prerendered
 * page, so changing it means a redeploy (ADR 0098). That is right for
 * customers and useless for the question every screen in the redesign has to
 * answer twice: does this work in both.
 *
 * So there is a second, per-browser switch, and it is only worth having if
 * three things hold. It has to change the product, it has to survive a
 * reload, and it must not flash the other palette on the way — a switch that
 * repaints the ground, the corners and the type a frame late is worse than
 * no switch, because every navigation becomes a strobe.
 */

const SCREEN = "/e2e/account-repositories";

async function openAccountMenu(page: import("@playwright/test").Page) {
  await page.locator('[data-testid="account-menu"] summary').click();
}

test.describe("the palette can be flipped without a redeploy", () => {
  test("starts on what the deployment renders", async ({ page }) => {
    await page.goto(SCREEN);
    // Playwright's server sets no VIBE_PALETTE, so this is the customer's
    // palette — and the attribute is written in both states on purpose.
    await expect(page.locator("html")).toHaveAttribute("data-vibe", "v1");
    await openAccountMenu(page);
    await expect(page.getByRole("radio", { name: "v1" })).toBeChecked();
  });

  test("changes the product, and says the view is a local override", async ({ page }) => {
    await page.goto(SCREEN);
    await openAccountMenu(page);

    const before = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--radius-card").trim(),
    );
    await page.getByRole("group", { name: "Design system" }).getByText("v2").click();

    await expect(page.locator("html")).toHaveAttribute("data-vibe", "v2");
    const after = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--radius-card").trim(),
    );
    // A real token moved. Asserting the attribute alone would pass with the
    // whole second palette deleted.
    expect(after).not.toBe(before);

    // The two palettes look identical in a bug report, so the rail says which.
    await expect(page.getByText("local override")).toBeVisible();
  });

  test("survives a reload, and the first paint is already right", async ({ page }) => {
    await page.goto(SCREEN);
    await openAccountMenu(page);
    await page.getByRole("group", { name: "Design system" }).getByText("v2").click();
    await expect(page.locator("html")).toHaveAttribute("data-vibe", "v2");

    // `domcontentloaded`, not `load`: the claim is that the blocking script in
    // <head> has already applied the override by the time the document is
    // parsed. Waiting for the page to settle would let a late effect pass.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-vibe", "v2");
  });

  test("flips back, and stops being an override", async ({ page }) => {
    await page.goto(SCREEN);
    await openAccountMenu(page);
    const group = page.getByRole("group", { name: "Design system" });
    await group.getByText("v2").click();
    await expect(page.getByText("local override")).toBeVisible();

    await group.getByText("v1").click();
    await expect(page.locator("html")).toHaveAttribute("data-vibe", "v1");
    // Back on the deployment's own palette, so there is nothing to warn about.
    await expect(page.getByText("local override")).toHaveCount(0);
  });
});
