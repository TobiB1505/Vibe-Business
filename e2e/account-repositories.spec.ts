import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

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
    // The filter is a segmented control, not a popup: the options are on
    // screen, so this clicks the pill the way a reader does. The input behind
    // it is `sr-only` — 1px and clipped — which is exactly why the label is
    // the target here and in the product.
    await page
      .getByRole("group", { name: "Filter repository visibility" })
      .getByText("Public")
      .click();
    await expect(page.getByRole("radio", { name: "Public" })).toBeChecked();
    await expect(page).toHaveURL(/visibility=public/);
    await expect(page.getByText("Showing 1–3 of 3 repositories")).toBeVisible();
  });

  test("filters from the keyboard, because the segment is a real radio group", async ({ page }) => {
    await page.goto(REPOSITORIES);

    // The whole reason the pills are labels over inputs rather than buttons
    // with `aria-pressed`: arrow keys, grouping and the announcement come
    // from the browser. If this stops working the control has been rebuilt
    // out of divs and the keyboard has been dropped with it.
    await page.getByRole("radio", { name: "All" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Private" })).toBeChecked();
    await expect(page).toHaveURL(/visibility=private/);

    // And the focus is drawn on something a sighted keyboard user can see —
    // the input itself is 1px and clipped, so the ring has to be on the pill.
    const ring = await page
      .getByRole("radio", { name: "Private" })
      .evaluate((input) => getComputedStyle(input.closest("label")!).boxShadow);
    expect(ring).toMatch(/rgba?\(0, 229, 160/);
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

    // Measure on the real faces. This assertion failed once at 768px by 4px
    // under a full parallel run and passed three times in isolation: a
    // fallback face is wider, and nothing here waited for the web fonts.
    await page.evaluate(() => document.fonts.ready);

    await expectNoHorizontalOverflow(page);
  });
}

/**
 * The audit's findings, as assertions (UI-31).
 *
 * Each of these was measured on the rendered page and none of them is visible
 * in the source: a number that is true today and false after one click, a
 * focus ring that exists as a 26%-alpha border, and a control that is 61px
 * tall because its own words wrapped.
 */
test.describe("what the audit found", () => {
  test("prints no number it cannot compute", async ({ page }) => {
    await page.goto(REPOSITORIES);

    /*
     * The header printed `repositories.length` twice, once labelled Products.
     * A project whose repository was disconnected still exists and produces no
     * row here — so the count was the repositories, said twice, and it goes
     * wrong on the first Disconnect.
     */
    // Scoped to `main`: the settings rail has a *navigation* item called
    // Products, which is a different thing in a different place and is correct.
    const labels = await page.evaluate(() => {
      const heading = [...document.querySelectorAll("main h2")].find((n) =>
        (n.textContent || "").includes("GitHub"),
      );
      const card = heading?.closest("[class*='vibe-surface']");
      return [...(card?.querySelectorAll("span") ?? [])]
        .map((n) => (n.textContent || "").trim())
        .filter((text) => /^[A-Z][a-z]+$/.test(text));
    });

    expect(labels, "the header counts something it cannot compute").not.toContain("Products");
    expect(labels, "the header says one fact twice").toEqual(["Repositories", "Private"]);
  });

  test("draws a focus ring on the two controls that had none", async ({ page }) => {
    await page.goto(REPOSITORIES);

    // Real Tab presses, because `:focus-visible` is the browser's judgement
    // and `.focus()` does not always earn it.
    await page.getByRole("searchbox", { name: "Search repositories" }).press("Tab");
    for (const name of ["Search repositories", "Sort repositories"] as const) {
      const ring = await page
        .getByRole(name === "Sort repositories" ? "combobox" : "searchbox", { name })
        .evaluate((node) => {
          (node as HTMLElement).focus();
          const label = node.closest("label")!;
          return getComputedStyle(label).boxShadow;
        });
      expect(ring, `${name} has no ring of its own`).toMatch(/rgba?\(0, 229, 160/);
    }
  });

  test("keeps every control on one line at 1440", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(REPOSITORIES);
    await page.evaluate(() => document.fonts.ready);

    // "Manage connection" rendered 61px tall beside 40px controls, because its
    // two words wrapped in a column the metric strip had squeezed.
    const wrapped = await page.evaluate(() =>
      [...document.querySelectorAll("main a, main button")]
        .filter((n) => n.getBoundingClientRect().height > 46 && (n.textContent || "").trim())
        .map((n) => (n.textContent || "").trim().slice(0, 30)),
    );
    expect(wrapped, "a control wrapped to two lines").toEqual([]);
  });

  test("renders the list once", async ({ page }) => {
    await page.goto(REPOSITORIES);

    // A table above `md` and a card list below is two implementations that
    // drift, and they had. One row serves every width now.
    await expect(page.locator("main table")).toHaveCount(0);
  });
});

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
     * This used to filter to `visible=true`, because the page rendered a table
     * *and* a card list and hid one by breakpoint — so both notices existed in
     * the DOM and counting nodes would have asserted the layout rather than
     * the state. UI-31 left one renderer, so the honest count is the DOM
     * count, and it is now also the thing that fails if the second renderer
     * ever comes back.
     */
    await expect(
      page.getByText("Vibe can no longer read this repository — the GitHub App was removed."),
    ).toHaveCount(1);
  });
});
