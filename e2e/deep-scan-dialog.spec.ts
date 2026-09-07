import { expect, test } from "@playwright/test";

/*
 * The dialog had no browser coverage at all, and three defects reached the
 * founder inside it: an animation bound to the wrong state, a login countdown
 * that never appeared, and a closing check that never drew. Every one passed
 * unit tests and lint, because the states are only reachable through Server
 * Actions and a click — so nothing could look at them.
 */
test.describe("waiting for the founder to sign in", () => {
  test("shows the deadline as a clock", async ({ page }) => {
    await page.goto("/e2e/deep-scan-dialog-awaiting-login");

    // Two minutes, counting, in the founder's own words rather than seconds.
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByRole("timer")).toContainText("to sign in");
    await expect(page.getByRole("timer")).toContainText(/[12]:\d\d/);
  });

  test("shows it at a size somebody can find", async ({ page }) => {
    /*
     * It was `text-meta` in `fg-meta`, wrapped onto its own line under a
     * two-line paragraph — on screen, and reported missing. For a two-minute
     * deadline those are the same thing.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/e2e/deep-scan-dialog-awaiting-login");

    const timer = page.getByRole("timer");
    await expect(timer).toBeVisible();

    const box = await timer.boundingBox();
    // A chip, not a caption: tall enough to be a control-sized thing.
    expect(box!.height).toBeGreaterThan(24);

    const size = await timer.evaluate((node) => getComputedStyle(node).fontSize);
    expect(Number.parseFloat(size)).toBeGreaterThanOrEqual(13);
  });

  test("does not claim Vibe is reading before it is", async ({ page }) => {
    await page.goto("/e2e/deep-scan-dialog-awaiting-login");

    // The status panel and its clock were bound to `busy`, which is also true
    // while a browser is being created.
    await expect(page.getByText(/looking around your signed-in product/i)).toBeHidden();
    await expect(page.getByText(/elapsed/)).toBeHidden();
  });

  test("offers the analysis and a way out", async ({ page }) => {
    await page.goto("/e2e/deep-scan-dialog-awaiting-login");

    await expect(page.getByRole("button", { name: /logged in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /cancel/i })).toBeVisible();
  });
});

test.describe("the analysis has come back", () => {
  test("draws the check inside the dialog, not just in isolation", async ({ page }) => {
    await page.goto("/e2e/deep-scan-dialog-sealing");

    // The tick's own path. It exists only in the sealing scene.
    await expect(page.locator("svg path[d^='m5 12.5']")).toBeVisible();
  });

  test("stops the login clock once there is nothing left to sign in for", async ({ page }) => {
    await page.goto("/e2e/deep-scan-dialog-sealing");
    await expect(page.getByRole("timer")).toBeHidden();
  });
});

/*
 * The deadline used to terminate the browser, close the dialog, and leave a
 * sentence in the panel behind — so from the founder's side the window simply
 * vanished while they were typing a password. An ending nobody asked for has
 * to be told where the person is looking.
 */
test.describe("sign-in ran out of time", () => {
  test("says what happened, where the founder was looking", async ({ page }) => {
    await page.goto("/e2e/deep-scan-dialog-expired");

    // Scoped to the dialog: Next's own route announcer is also an alert.
    const notice = page.getByRole("dialog").getByRole("alert");
    await expect(notice).toContainText("Sign-in took longer than two minutes");
    // The question a person has when something they started ends by itself.
    await expect(notice).toContainText("Nothing was charged");
    // And the cooldown, named rather than discovered by a refused click.
    await expect(notice).toContainText("waits two minutes between attempts");
  });

  test("stops the clock and the analysis button once the browser is gone", async ({ page }) => {
    await page.goto("/e2e/deep-scan-dialog-expired");

    await expect(page.getByRole("timer")).toBeHidden();
    await expect(page.getByRole("button", { name: /logged in/i })).toBeDisabled();
  });
});
