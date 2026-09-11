import { expect, test, type Page } from "@playwright/test";

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
 *
 * ## Why nothing is opened first
 *
 * The switch used to live inside the account menu. That menu held Profile,
 * Account settings, Billing and Sign out, and three of those are rows in the
 * Settings rail now — a disclosure whose contents are the navigation standing
 * next to it. It became a plain identity card, and the switch sits under it in
 * the rail footer both shells share.
 */

const SCREEN = "/e2e/account-repositories";

/**
 * The palette this build renders, read from the page rather than assumed.
 *
 * These tests used to name `v1` outright, on the reasoning that the suite's
 * server set no `VIBE_PALETTE`. It sets `v2` now (UI-37), and the honest
 * reading is that naming either was always the wrong shape: what this file is
 * about is the *switch* — that it moves the product away from whatever is
 * deployed, says so, and lets you back. Which palette is deployed is a
 * deployment's business.
 */
async function deployed(page: Page): Promise<"v1" | "v2"> {
  const value = await page.locator("html").getAttribute("data-vibe");
  expect(value, "the deployment writes its palette in both states").toMatch(/^v[12]$/);
  return value as "v1" | "v2";
}

/** The one this build does *not* render, which is what the switch reaches. */
const other = (palette: "v1" | "v2") => (palette === "v1" ? "v2" : "v1");

test.describe("the palette can be flipped without a redeploy", () => {
  test("starts on what the deployment renders", async ({ page }) => {
    await page.goto(SCREEN);

    // Whatever it is, the control agrees with the document about it.
    const current = await deployed(page);
    await expect(page.getByRole("radio", { name: current })).toBeChecked();
    await expect(page.getByText("local override")).toHaveCount(0);
  });

  test("changes the product, and says the view is a local override", async ({ page }) => {
    await page.goto(SCREEN);
    const away = other(await deployed(page));

    const before = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--radius-card").trim(),
    );
    await page.getByRole("group", { name: "Design system" }).getByText(away).click();

    await expect(page.locator("html")).toHaveAttribute("data-vibe", away);
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
    const away = other(await deployed(page));
    await page.getByRole("group", { name: "Design system" }).getByText(away).click();
    await expect(page.locator("html")).toHaveAttribute("data-vibe", away);

    // `domcontentloaded`, not `load`: the claim is that the blocking script in
    // <head> has already applied the override by the time the document is
    // parsed. Waiting for the page to settle would let a late effect pass.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-vibe", away);
  });

  test("flips back, and stops being an override", async ({ page }) => {
    await page.goto(SCREEN);
    const home = await deployed(page);
    const group = page.getByRole("group", { name: "Design system" });
    await group.getByText(other(home)).click();
    await expect(page.getByText("local override")).toBeVisible();

    await group.getByText(home).click();
    await expect(page.locator("html")).toHaveAttribute("data-vibe", home);
    // Back on the deployment's own palette, so there is nothing to warn about.
    await expect(page.getByText("local override")).toHaveCount(0);
  });
});
