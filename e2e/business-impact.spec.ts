import { expect, test, type Page } from "@playwright/test";

/**
 * The Business impact panel, in a real browser (Sprint 12B §40).
 *
 * ## What this suite exists to prove
 *
 * That the last panel in the chain keeps three claims apart on screen, and that
 * the four states which are **not results** never read as one:
 *
 * ```
 * Merged                ✅   the branch moved              Sprint 11C
 * Production outcome    ✅   the behaviour appeared        Sprint 12A
 * Business impact       ?    ← and "?" has four shapes
 * ```
 *
 * The state that matters most is `source_required`, because it is the state
 * every project is in today. Rendering it as "No impact" would blame a change
 * for a gap in Vibe's own setup, and that is the specific misreading this whole
 * sprint is built to prevent.
 *
 * ## What it does not prove
 *
 * The wiring in `page.tsx`, or RLS. There is no isolated database here, so the
 * states come from fixtures — the same gap Sprint 11C.1 documented, still real.
 */

function impactSection(page: Page) {
  // The direct-child heading disambiguates: the panels are nested `<section>`s,
  // so "a section containing a Business impact heading" would match the wrapper.
  return page.locator('section:has(> h4:text-is("Business impact"))');
}

/**
 * Fails the test if the page reaches any external host.
 *
 * §45's "zero provider calls on render" has to be a counter rather than a
 * promise. A panel that quietly queried an analytics vendor on render would be
 * a page load that spends somebody's API quota.
 */
async function forbidExternalCalls(page: Page): Promise<string[]> {
  const attempted: string[] = [];

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      attempted.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });

  return attempted;
}

test.describe("no source connected — the real state today", () => {
  test("says a source is required, and never that there was no impact", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/business_impact_source_required");

    const impact = impactSection(page);

    await expect(impact.getByText("Measurement source required")).toBeVisible();
    await expect(impact).toContainText("Connect an analytics source");
    await expect(impact).toContainText(
      "Production behavior was verified, but Vibe does not yet have a connected data source",
    );

    // The sentence this sprint exists to prevent.
    await expect(impact).not.toContainText("No impact");
    await expect(impact).not.toContainText("Unknown impact");

    // And rendering it contacted nobody (§45).
    expect(external, "the business impact screen reached an external host").toEqual([]);
  });

  test("still names what would be measured, so the screen is useful", async ({ page }) => {
    await page.goto("/e2e/business_impact_source_required");
    const impact = impactSection(page);

    await expect(impact).toContainText("Search impressions");
  });

  test("offers no connect button, because no connector exists", async ({ page }) => {
    await page.goto("/e2e/business_impact_source_required");

    await expect(page.getByRole("button", { name: "Connect analytics" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start measuring" })).toHaveCount(0);
  });
});

test.describe("waiting for the window", () => {
  test("shows both windows and when a result becomes available", async ({ page }) => {
    await page.goto("/e2e/business_impact_scheduled");
    const impact = impactSection(page);

    await expect(impact.getByText("Measurement scheduled")).toBeVisible();

    const windows = impact.getByTestId("business-impact-windows");
    await expect(windows).toContainText("Baseline");
    await expect(windows).toContainText("Measurement window");
    await expect(windows).toContainText("Result available after");
    // The zone the calendar days were counted in (§32).
    await expect(windows).toContainText("UTC");
  });

  test("states no result while waiting", async ({ page }) => {
    await page.goto("/e2e/business_impact_scheduled");
    const impact = impactSection(page);

    await expect(impact.getByTestId("business-impact-values")).toHaveCount(0);
    await expect(impact).not.toContainText("Improved");
    await expect(impact).not.toContainText("Degraded");
  });
});

test.describe("measuring", () => {
  test("reports complete days, never a percentage or a verdict", async ({ page }) => {
    await page.goto("/e2e/business_impact_measuring");
    const impact = impactSection(page);

    await expect(impact.getByText("Collecting post-change data")).toBeVisible();
    await expect(impact).toContainText("3 of 28 complete days observed");
    await expect(impact).not.toContainText("%");
    await expect(impact).not.toContainText("looking good");
  });
});

test.describe("improved", () => {
  test("shows before, after and the observed change", async ({ page }) => {
    const external = await forbidExternalCalls(page);
    await page.goto("/e2e/business_impact_improved");
    const impact = impactSection(page);

    await expect(impact.locator('p:text-is("Improved")')).toBeVisible();

    const values = impact.getByTestId("business-impact-values");
    await expect(values).toContainText("420");
    await expect(values).toContainText("486");
    await expect(values).toContainText("+15.7%");
    // Never "Impact" and never "Uplift" (§10, §24).
    await expect(values).toContainText("Observed change");

    expect(external).toEqual([]);
  });

  test("carries the disclaimer that denies causation", async ({ page }) => {
    await page.goto("/e2e/business_impact_improved");
    const impact = impactSection(page);

    await expect(impact).toContainText(
      "It does not by itself prove that this code change caused the difference.",
    );
  });

  test("never claims the change caused the movement", async ({ page }) => {
    await page.goto("/e2e/business_impact_improved");
    const body = page.locator("body");

    for (const forbidden of [
      "caused a",
      "driven by",
      "led to",
      "thanks to",
      "resulted in",
      "This change increased",
    ]) {
      await expect(body).not.toContainText(forbidden);
    }
  });
});

test.describe("degraded", () => {
  test("shows the negative result as fully as a positive one", async ({ page }) => {
    await page.goto("/e2e/business_impact_degraded");
    const impact = impactSection(page);

    await expect(impact.locator('p:text-is("Degraded")')).toBeVisible();

    const values = impact.getByTestId("business-impact-values");
    await expect(values).toContainText("1,200");
    await expect(values).toContainText("1,062");
    // Signed, so a fall reads as a fall (§25).
    await expect(values).toContainText("−11.5%");
  });

  test("offers no revert, rollback or redeploy (§28)", async ({ page }) => {
    await page.goto("/e2e/business_impact_degraded");

    for (const forbidden of ["Revert", "Roll back", "Undo", "Redeploy", "Deploy", "Re-merge"]) {
      await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
    }
  });

  test("does not rewrite the merge or the production outcome (§27)", async ({ page }) => {
    // All three coexist. A bad business result does not unmake what was
    // historically true about delivery or the product.
    await page.goto("/e2e/business_impact_degraded");

    const merge = page.locator('section:has(> h4:text-is("Merge"))');
    const outcome = page.locator('section:has(> h4:text-is("Outcome"))');

    await expect(merge.getByText("Merged", { exact: true })).toBeVisible();
    await expect(outcome.getByText("Production outcome verified")).toBeVisible();
  });
});

test.describe("insufficient data", () => {
  test("says what was needed and what was seen, and is not a result", async ({ page }) => {
    await page.goto("/e2e/business_impact_insufficient");
    const impact = impactSection(page);

    await expect(impact.getByText("Insufficient data")).toBeVisible();
    await expect(impact).toContainText(
      "Not enough traffic was observed to make a meaningful comparison.",
    );

    const samples = impact.getByTestId("business-impact-samples");
    await expect(samples).toContainText("500");
    await expect(samples).toContainText("10");
    await expect(samples).toContainText("8");

    // No before/after comparison is shown, because there is not one.
    await expect(impact.getByTestId("business-impact-values")).toHaveCount(0);
    await expect(impact).not.toContainText("No impact");
  });
});

test.describe("the three levels stay separate on screen (§33)", () => {
  test("the ladder reflects the real business state, not a constant", async ({ page }) => {
    await page.goto("/e2e/business_impact_improved");
    const ladder = page.getByTestId("outcome-ladder");

    await expect(ladder).toContainText("Merged");
    await expect(ladder).toContainText("Production outcome");
    await expect(ladder).toContainText("Business impact");
    await expect(ladder).toContainText("Improved");
  });

  test("the ladder says not measured when nothing is connected", async ({ page }) => {
    await page.goto("/e2e/business_impact_source_required");
    const ladder = page.getByTestId("outcome-ladder");

    await expect(ladder).toContainText("Not measured — no source");
  });
});

test.describe("nothing anywhere claims a deployment or an automatic action", () => {
  const scenarios = [
    "business_impact_not_planned",
    "business_impact_source_required",
    "business_impact_scheduled",
    "business_impact_measuring",
    "business_impact_improved",
    "business_impact_degraded",
    "business_impact_insufficient",
  ];

  for (const scenario of scenarios) {
    test(`${scenario} offers no deploy, revert or rollback control`, async ({ page }) => {
      await page.goto(`/e2e/${scenario}`);

      for (const forbidden of ["Deploy", "Revert", "Roll back", "Rollback", "Ship", "Publish"]) {
        await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
      }
      await expect(page.locator("body")).not.toContainText("Deployed");
    });
  }
});

test.describe("reload recovery", () => {
  test("a degraded result is still degraded after a full reload", async ({ page }) => {
    await page.goto("/e2e/business_impact_degraded");
    const impact = impactSection(page);
    await expect(impact.locator('p:text-is("Degraded")')).toBeVisible();

    await page.reload();

    await expect(impact.locator('p:text-is("Degraded")')).toBeVisible();
    await expect(impact.getByTestId("business-impact-values")).toContainText("−11.5%");
  });

  test("a source requirement is still a source requirement after a reload", async ({ page }) => {
    await page.goto("/e2e/business_impact_source_required");
    const impact = impactSection(page);
    await expect(impact.getByText("Measurement source required")).toBeVisible();

    await page.reload();

    await expect(impact.getByText("Measurement source required")).toBeVisible();
    await expect(impact).not.toContainText("No impact");
  });
});

test.describe("the section is absent until something is merged", () => {
  test("an unmerged prepared change shows no Business impact panel", async ({ page }) => {
    await page.goto("/e2e/merge_ready");

    await expect(impactSection(page)).toHaveCount(0);
  });
});
