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

test.describe("a repository Vibe can no longer read (VB-041)", () => {
  /**
   * Removing the GitHub App is the ordinary way to withdraw access, and until
   * this the page went on describing those repositories as connected. Vibe had
   * already been told — a 404 on the installation probe is recorded on the
   * installation row — so the gap was never detection, it was that nothing
   * said anything.
   */
  test("says so, on the row, rather than looking connected", async ({ page }) => {
    await page.goto(REPOSITORIES);

    const notice = page
      .getByText("Vibe can no longer read this repository — the GitHub App was removed.")
      .first();

    await expect(notice).toBeVisible();
  });

  test("offers the way back, which is a fresh installation", async ({ page }) => {
    await page.goto(REPOSITORIES);

    // `?new=1` is the only route that starts a real installation for a user
    // who already has an installation row — the flow VB-041 gave a reason to
    // reach and nothing linked to.
    await expect(page.getByRole("link", { name: "Reconnect" }).first()).toHaveAttribute(
      "href",
      "/app/connect/github?new=1",
    );
  });

  test("marks the row without claiming the repository changed", async ({ page }) => {
    await page.goto(REPOSITORIES);

    // "No access" replaces Private/Public: the visibility Vibe recorded at
    // connection time is not a fact it can still vouch for, and the row should
    // not imply it looked.
    await expect(page.getByText("No access").first()).toBeVisible();
  });

  test("leaves every other row alone", async ({ page }) => {
    await page.goto(REPOSITORIES);

    /*
     * One revoked installation in the fixture. A notice on every row would
     * mean the state is being derived from the wrong thing.
     *
     * Filtered to what is *visible*: this page renders a table and a card list
     * and hides one of them by breakpoint, so both notices exist in the DOM
     * and only one is on screen. Counting DOM nodes here would assert the
     * layout rather than the state.
     */
    await expect(
      page
        .getByText("Vibe can no longer read this repository — the GitHub App was removed.")
        .locator("visible=true"),
    ).toHaveCount(1);
  });
});
