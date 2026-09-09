import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

const PRODUCTS = "/e2e/account-products";

test.describe("My Products", () => {
  test("keeps the reference hierarchy without fabricated account metrics", async ({ page }) => {
    await page.goto(PRODUCTS);

    await expect(page.getByRole("heading", { name: "My Products" })).toBeVisible();
    await expect(page.getByTestId("product-list-row")).toHaveCount(3);
    await expect(page.getByText(/average business signal/i)).toHaveCount(0);
    await expect(page.getByText(/active products/i)).toHaveCount(0);
  });

  /**
   * The metric row is gone, and it is not coming back as prose (UI-33).
   *
   * It held `3 Products`, `2/3 Analysed` and `2 Need attention` directly above
   * three rows that say all three — arithmetic on a list a reader can see. The
   * summary region that carried them was asserted here, so the deletion has to
   * change this test rather than slip past it.
   */
  test("counts nothing the list underneath already says", async ({ page }) => {
    await page.goto(PRODUCTS);

    await expect(page.getByRole("region", { name: "Product summary" })).toHaveCount(0);

    // Not "no numbers on the page" — a business signal is a real measurement.
    // The claim is narrower: no tally *of the rows*.
    const main = page.getByRole("main");
    await expect(main.getByText(/^\s*Products\s*$/)).toHaveCount(0);
    await expect(main.getByText(/analysed products/i)).toHaveCount(0);
    await expect(main.getByText(/need attention/i)).toHaveCount(0);
  });

  /**
   * One action, through `Button`, and it is not a statistic (UI-33).
   *
   * `Connect product` was the fourth tile in a row of three counts — the same
   * size and shape as `3 Products` — drawn with its own border, fill and hover
   * after 0185 folded every pressable control into one component.
   */
  test("offers connecting a product as the page's one primary", async ({ page }) => {
    await page.goto(PRODUCTS);

    const connect = page.getByRole("link", { name: "Connect product" });
    await expect(connect).toBeVisible();

    const mint = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-mint)";
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return [...document.querySelectorAll("main a, main button")]
        .filter((el) => {
          const style = getComputedStyle(el);
          return `${style.backgroundImage} ${style.backgroundColor}`.includes(accent);
        })
        .map((el) => el.textContent?.trim() ?? "");
    });

    expect(mint).toEqual(["Connect product"]);
  });

  /**
   * Every row the same height, whatever Vibe knows about the product.
   *
   * Three products rendered at 252, 194 and 231 pixels, because each card
   * carried a grid of profile facts that collapses when there is no profile.
   * A list whose rows change height with how much is known cannot be scanned.
   */
  test("gives every product the same row height", async ({ page }) => {
    await page.goto(PRODUCTS);
    await page.evaluate(() => document.fonts.ready);

    // The row's own box, not the `<li>`: every row but the first carries a
    // hairline above it, so measuring the list items compares 76 against 77
    // and fails on a divider rather than on a layout.
    const heights = await page
      .getByTestId("product-list-row")
      .locator("a")
      .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));

    expect(heights).toHaveLength(3);
    expect(new Set(heights).size, `rows differ in height: ${heights.join(", ")}`).toBe(1);
  });

  /**
   * An unread product says so once.
   *
   * The card said it seven times in five wordings — `NOT ANALYSED`, "No
   * product summary is available yet", "Not established yet" three times,
   * "Product profile pending", "No data yet", and "Analysed not yet", which is
   * not English and disagreed with the pill two lines above it.
   */
  test("states an absence once", async ({ page }) => {
    await page.goto(PRODUCTS);

    const row = page.getByTestId("product-list-row").filter({ hasText: "Half Set Up" });
    const text = (await row.textContent()) ?? "";

    const absences = text.match(
      /not (established|analysed) yet|no data yet|pending|not analysed/gi,
    );
    expect(absences ?? [], `the row says its absence ${absences?.length ?? 0} times`).toHaveLength(
      1,
    );
    expect(text).not.toContain("Analysed not yet");
  });

  /**
   * The ring the repositories page had and this one did not (UI-33).
   *
   * There were two hand-written search fields, and when 0189 found focus
   * invisible on one of them it fixed that one. Measured here with a real Tab
   * press: `box-shadow: none` against `rgb(0, 229, 160) 0px 0px 0px 2px` one
   * page over. They are the same component now, and this asserts it on the
   * page that had the defect rather than only on the page that was repaired.
   */
  test("draws a focus ring on its search field", async ({ page }) => {
    await page.goto(PRODUCTS);

    // A real Tab press, because `:focus-visible` is the browser's judgement
    // and `.focus()` does not always earn it.
    const search = page.getByRole("searchbox", { name: "Search products" });
    await search.press("Tab");
    await search.focus();

    const ring = await search.evaluate((node) => {
      const label = node.closest("label")!;
      return getComputedStyle(label).boxShadow;
    });

    expect(ring, "the search field has no ring of its own").toMatch(/rgba?\(0, 229, 160/);
  });

  test("searches the real product context", async ({ page }) => {
    await page.goto(PRODUCTS);

    await page.getByRole("searchbox", { name: "Search products" }).fill("monetizing");

    await expect(page.getByTestId("product-list-row")).toHaveCount(1);
    // The heading is the name the product goes by. "Needs You Now" is the
    // label the founder typed at connection time, and it stays on the card
    // below — see the next test.
    await expect(page.getByRole("heading", { name: "Payflow" })).toBeVisible();
  });

  test("leads with the product's own name and keeps the founder's label", async ({ page }) => {
    await page.goto(PRODUCTS);

    const card = page.getByTestId("product-list-row").filter({ hasText: "Payflow" });
    await expect(card.getByRole("heading", { name: "Payflow" })).toBeVisible();
    await expect(card).toContainText("Project: Needs You Now");

    // A row whose product name is the label already needs no second line.
    const same = page.getByTestId("product-list-row").filter({ hasText: "Quietly Fine" });
    await expect(same).not.toContainText("Project:");
  });

  test("finds a product by the name on the card", async ({ page }) => {
    // The search box has to index what the founder can read. Leaving it on the
    // project label made "Payflow" return nothing at all.
    await page.goto(PRODUCTS);

    await page.getByRole("searchbox", { name: "Search products" }).fill("payflow");

    await expect(page.getByTestId("product-list-row")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Payflow" })).toBeVisible();
  });

  test("shows the product's logo where it has one, and initials where it does not", async ({
    page,
  }) => {
    await page.goto(PRODUCTS);

    const withLogo = page.getByTestId("product-list-row").filter({ hasText: "Quietly Fine" });
    await expect(withLogo.getByTestId("product-logo")).toBeVisible();

    const withoutLogo = page.getByTestId("product-list-row").filter({ hasText: "Payflow" });
    await expect(withoutLogo.getByTestId("product-logo")).toHaveCount(0);
  });

  test("filters setup products and can reset the result", async ({ page }) => {
    await page.goto(PRODUCTS);

    // The pill is the click target; the radio behind it is `sr-only`.
    await page.getByRole("group", { name: "Filter products" }).getByText("Setup").click();
    await expect(page.getByRole("radio", { name: "Setup" })).toBeChecked();
    await expect(page.getByTestId("product-list-row")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Half Set Up" })).toBeVisible();

    await page.getByRole("searchbox", { name: "Search products" }).fill("does not exist");
    await expect(page.getByRole("heading", { name: "No matching products" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search and filters" }).click();
    await expect(page.getByTestId("product-list-row")).toHaveCount(3);
  });

  test("sorts scored products above missing signals", async ({ page }) => {
    await page.goto(PRODUCTS);

    await page.getByRole("combobox", { name: "Sort products" }).selectOption("signal");
    const names = await page.getByTestId("product-list-row").locator("h2").allTextContents();

    expect(names).toEqual(["Quietly Fine", "Payflow", "Half Set Up"]);
  });
});

for (const width of [1440, 1024, 768, 375]) {
  test(`the product index fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PRODUCTS);

    // Measure on the real faces. This failed at 768px by 4px under a full
    // parallel run — the second time this session, after the same mechanism on
    // the repository index: a fallback face is wider, and nothing here waited
    // for the web fonts.
    await page.evaluate(() => document.fonts.ready);

    await expectNoHorizontalOverflow(page);
  });
}
