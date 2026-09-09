import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

test.describe("Product Scan", () => {
  test("shows grounded individual discoveries and one re-scan action", async ({ page }) => {
    await page.goto("/e2e/product_scan_complete");

    await expect(
      page.getByRole("heading", { name: "Your product picture is ready" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understanding your product" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open scan & rescan" }).click();

    await expect(page.getByRole("heading", { name: "Understanding your product" })).toBeVisible();
    await expect(
      /*
        The tense follows the state (UI-34). A scan that has finished and
        produced a picture is not still discovering anything, so the heading
        over a settled panel reads "What Vibe worked out" — and this scenario is
        a completed scan. The assertion pinned the running tense against the
        settled state and was passing on a heading that was wrong.
      */
      page.getByRole("heading", { name: "What Vibe worked out" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Live activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we've discovered so far" })).toBeVisible();
    await expect(page.getByText("Next.js", { exact: true })).toBeVisible();
    await expect(page.getByText("authentication signal found")).toBeVisible();
    await expect(page.getByText("Product picture assembled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Scan my product again" })).toBeVisible();
    await expect(page.getByText("No invented percentage")).toHaveCount(0);

    await page.getByRole("button", { name: "Collapse scan" }).click();
    await expect(
      page.getByRole("heading", { name: "Your product picture is ready" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Open scan & rescan" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("keeps a partial source visible without treating it as a failed product", async ({
    page,
  }) => {
    await page.goto("/e2e/product_scan_partial");

    await page.getByRole("button", { name: "Open scan & rescan" }).click();

    await expect(page.getByText("Public product could not be fully read").first()).toBeVisible();
    await expect(page.getByText("Product picture assembled")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understanding your product" })).toBeVisible();
  });

  test("becomes a readable evidence rail on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/e2e/product_scan_complete");

    await page.getByRole("button", { name: "Open scan & rescan" }).click();

    await expect(
      page.getByTestId("product-scan-graph").getByText("Product type", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Brand / identity", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, "the scan graph scrolls sideways", 1);
  });

  test("preserves every finding with reduced motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/e2e/product_scan_complete");
    await page.getByRole("button", { name: "Open scan & rescan" }).click();
    await expect(page.getByText("Next.js", { exact: true })).toBeVisible();
    await expect(page.getByText("Brand / identity", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("product-logo").first()).toBeVisible({ timeout: 7_000 });
    await context.close();
  });

  test("keeps the scanner geometry fixed while individual findings arrive", async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto("/e2e/product_scan_reveal");

    const scanner = page.getByTestId("product-scan-graph");
    const experience = page.getByRole("region", { name: "Understanding your product" });

    /*
      The "before" has to be a settled reading, and it was not.

      `page.goto` resolves on `load`, which under parallel load can be ahead of
      the graph's own layout — the facet cards go from flow to absolute, and the
      face is still the fallback. Measured there, `scannerHeightBefore` came
      back 1062 against a settled 130, and the test then reported a geometry
      break that was really a stopwatch started too early. It passed alone and
      failed beside its neighbours, which is this repository's signature for
      exactly that. Same fix as `expectNoHorizontalOverflow`: wait for the face,
      and for the thing being measured to exist.
    */
    await expect(scanner).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const scannerHeightBefore = await scanner.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    const experienceHeightBefore = await experience.evaluate(
      (element) => element.getBoundingClientRect().height,
    );

    await expect(page.getByTestId("product-logo").first()).toBeVisible({ timeout: 12_000 });

    expect(await scanner.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      scannerHeightBefore,
    );
    expect(await experience.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      experienceHeightBefore,
    );
  });
});
