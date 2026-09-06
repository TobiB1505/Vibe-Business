import { expect, test, type Page } from "@playwright/test";

const SYNTHESIS = "/e2e/audit-synthesis";
const UNSCORED = "/e2e/audit-unscored";
const NO_MOVES = "/e2e/audit-synthesis-no-moves";

function lens(page: Page, name: string | RegExp) {
  return page
    .getByTestId("audit-map-panel")
    .getByRole("button", { name: typeof name === "string" ? new RegExp(name, "i") : name });
}

test.describe("signature Business Brain", () => {
  test("makes the connected brain dominant and keeps the decision panel beside it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);

    const map = page.getByTestId("audit-map-panel");
    const panel = page.getByRole("heading", { name: /what matters now/i });
    await expect(map).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(map.getByRole("heading", { name: /^business map$/i })).toBeVisible();
    await expect(map.getByText(/^your business brain$/i)).toHaveCount(0);
    await expect(page.getByText(/^business intelligence$/i)).toBeVisible();
    await expect(page.locator('[data-workspace-header="intelligence"]')).toBeVisible();
    await expect(page.getByText(/how we score your business/i)).toHaveCount(0);

    const mapBox = await map.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(mapBox!.width).toBeGreaterThan(700);
    expect(panelBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width);
  });

  test("exposes exactly the nine domain lenses as semantic controls", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByRole("list", { name: /business dimensions/i }).first().getByRole("button")).toHaveCount(9);
    for (const name of [
      "Offer",
      "Audience",
      "Revenue & Economics",
      "Acquisition",
      "Conversion",
      "Retention",
      "Measurement",
      "Business Readiness",
      "Scalability",
    ]) {
      await expect(lens(page, name)).toHaveCount(1);
    }
  });

  test("shows validated lens scores and keeps unsupported lenses absent", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(lens(page, /revenue & economics/i)).toHaveAttribute(
      "aria-label",
      /score 38 out of 100.*weak.*priority soon/i,
    );
    await expect(lens(page, /scalability/i)).toHaveAttribute(
      "aria-label",
      /not scored.*unknown/i,
    );
    await expect(page.getByText(/missing evidence is never scored as zero/i)).toBeVisible();
  });

  /*
   * The remaining-count assertion this test used to carry is gone with the
   * behaviour: R11 replaces "and 1 more priority" with the blockers
   * themselves. What survives unchanged is the ranking — one blocker leads,
   * and it is the one the audit ranked first.
   */
  test("leads with the highest real priority and its impact", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByTestId("primary-priority")).toContainText(
      "People still don't have a clear way to pay you.",
    );
    await expect(page.getByTestId("primary-priority")).toContainText(/high impact/i);
    await expect(page.getByTestId("primary-priority")).toContainText(/medium effort/i);
  });

  test("opens selected-area detail in a stable two-column layout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);
    const before = page.url();

    const mapBefore = await page.getByTestId("audit-map-panel").boundingBox();
    await lens(page, /revenue & economics/i).click();

    const detail = page.getByTestId("selected-lens-detail");
    await expect(detail.getByRole("heading", { name: /^revenue & economics$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /what matters now/i })).toHaveCount(0);
    expect(page.url()).toBe(before);

    const mapBox = await page.getByTestId("audit-map-panel").boundingBox();
    const detailBox = await detail.boundingBox();
    expect(Math.abs(mapBox!.width - mapBefore!.width)).toBeLessThanOrEqual(2);
    expect(detailBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width);
    await expect(detail.getByText(/connected areas/i)).toBeVisible();
    await expect(page.getByTestId("selected-scoring-context")).toHaveCount(0);
    await detail.getByRole("tab", { name: /^signals$/i }).click();
    const signalsPanel = detail.getByRole("tabpanel");
    await expect(signalsPanel).toContainText(/current lens score/i);
    await expect(signalsPanel).toContainText(/38\s*\/100/i);
    await expect(signalsPanel).toContainText(/signals behind this score/i);
    await expect(signalsPanel).toContainText(/individual signals do not carry invented point values/i);
    /*
     * Three, not four. The evidence tab's numbered citation cards were the
     * shared drawer's content one tab away from the conclusion it supports;
     * they moved behind the count in the header.
     */
    await expect(detail.getByRole("tab")).toHaveCount(3);
    await expect(page.getByTestId("business-map-radial")).toBeVisible();
  });

  /*
   * The tablist arrows browse; they do not choose.
   *
   * This column's tabs used to select as the arrow key moved, which means a
   * screen-reader user cannot walk the four sections without hearing four
   * panels replace each other. The shared `TabList` moves focus and waits for
   * Enter, and this is the assertion that keeps it that way — the difference
   * is invisible to a mouse and only observable here.
   */
  test("lets the keyboard browse the detail tabs before committing to one", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);
    await lens(page, /revenue & economics/i).click();

    const detail = page.getByTestId("selected-lens-detail");
    const overview = detail.getByRole("tab", { name: /^overview$/i });
    await overview.click();
    await expect(overview).toHaveAttribute("aria-selected", "true");

    await overview.press("ArrowRight");

    const signals = detail.getByRole("tab", { name: /^signals$/i });
    await expect(signals).toBeFocused();
    await expect(signals).toHaveAttribute("aria-selected", "false");
    await expect(overview).toHaveAttribute("aria-selected", "true");

    await signals.press("Enter");
    await expect(signals).toHaveAttribute("aria-selected", "true");
    await expect(overview).toHaveAttribute("aria-selected", "false");

    // End reaches the last tab, and still only moves.
    await signals.press("End");
    await expect(detail.getByRole("tab", { name: /^history$/i })).toBeFocused();
    await expect(signals).toHaveAttribute("aria-selected", "true");
  });

  /*
   * R11. The blockers after the first were a number and a link to Moves: the
   * founder was told more existed and sent to a page that does not list them.
   * They are read here now, in the audit's order, and each opens the same
   * evidence drawer as every other finding.
   */
  test("reads the rest of the blockers in rank order, with the cost first", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(SYNTHESIS);

    const second = page.getByRole("article").filter({ hasText: /actually working/i });
    await expect(second).toBeVisible();
    await expect(second).toContainText("02");

    // Why-first: the consequence leads, the diagnosis follows it.
    const paragraphs = await second.locator("p").allInnerTexts();
    const why = paragraphs.findIndex((text) => /every change you make is a guess/i.test(text));
    const diagnosis = paragraphs.findIndex((text) => /couldn't find anything measuring/i.test(text));
    expect(why).toBeGreaterThanOrEqual(0);
    expect(diagnosis).toBeGreaterThan(why);

    await expect(page.getByText(/see \d+ more priorit/i)).toHaveCount(0);
  });

  test("opens one evidence drawer from a blocker, and never shows an evidence id", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(SYNTHESIS);

    const second = page.getByRole("article").filter({ hasText: /actually working/i });
    await second.getByRole("button", { name: /sources?$/ }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(/evidence/i);

    /*
     * Rule 45 and the audit's acceptance both: a citation is a founder
     * sentence and a named source. The raw id behind it is never on screen.
     */
    const drawerText = await drawer.innerText();
    expect(drawerText).not.toMatch(/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/);

    await drawer.getByRole("button", { name: /close/i }).click();
    await expect(drawer).toBeHidden();
  });

  /*
   * R9's unscored state. The em dash was on screen and the sentence behind it
   * was computed and rendered nowhere, so the founder saw the product decline
   * to answer without being told why it could not.
   */
  test("says why there is no score, and does not colour the non-answer green", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(UNSCORED);

    const map = page.getByTestId("business-map-radial");
    await expect(map).toContainText(/only 2 of 9 areas could be assessed/i);

    const label = map.getByText("Not enough evidence");
    await expect(label).toBeVisible();
    const colour = await label.evaluate((node) => getComputedStyle(node).color);
    // The mint the product uses for a healthy reading.
    const mint = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-mint").trim(),
    );
    expect(mint).not.toBe("");
    expect(colour).not.toBe(mint);
  });

  test("opens the lens's own citations from the detail header", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);
    await lens(page, /revenue & economics/i).click();

    const detail = page.getByTestId("selected-lens-detail");
    await detail.getByRole("button", { name: /sources?$/ }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Revenue & Economics");
    await drawer.getByRole("button", { name: /close/i }).click();
    await expect(drawer).toBeHidden();
  });

  /*
   * Slice 2: contradictions belong on My Product *and* on the Brain. Here they
   * qualify the scores beside them — a capability the audit read out of the
   * repository may be one no visitor can reach.
   */
  test("carries a code-against-live disagreement as evidence about the business", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(SYNTHESIS);

    const heading = page.getByRole("heading", {
      name: /your code against your live product/i,
    });
    await expect(heading).toBeVisible();

    const finding = heading.locator("xpath=..").getByRole("article").first();
    await expect(finding).toBeVisible();
    await expect(finding).toContainText(/your code · your live product/i);
    await expect(finding).toContainText(/needs attention/i);
  });

  /*
   * R39 at strip density: one line saying what the audit about to be paid for
   * rests on, leading with the first gap. It lives on the route that already
   * reads all three snapshots, so it costs no extra read.
   */
  test("says in one line what the audit rests on, and names the first gap", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const strip = page.getByTestId("source-coverage-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute("data-gap", "deep_scan");

    const text = (await strip.textContent()) ?? "";
    expect(text).toContain("Rests on");
    expect(text).toContain("code");
    expect(text).toContain("signed-in product");

    // The remedy for the gap, and only for the gap.
    await expect(strip.getByRole("link")).toHaveCount(1);
    await expect(strip.getByRole("link")).toContainText(/deep scan/i);
  });

  test("closes selected detail without collapsing or overlapping the overview", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);
    await lens(page, /acquisition/i).click();

    await page.getByRole("button", { name: /back to business health overview/i }).click();

    const intelligence = page.getByTestId("audit-intelligence");
    await expect(intelligence).toHaveAttribute("data-view", "overview");
    const mapBox = await page.getByTestId("audit-map-panel").boundingBox();
    const prioritiesBox = await page.getByTestId("current-priorities").boundingBox();
    expect(prioritiesBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width);
    expect(prioritiesBox!.width).toBeGreaterThan(400);
  });

  test("keeps every desktop planet on one consistent footprint", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);

    /*
     * Retried until the layout settles, because `boundingBox()` does not wait
     * for one. The map animates in, so a single sample taken while the entrance
     * is still running measures a frame rather than the design — which is what
     * made this test fail under a loaded parallel run and pass alone, three
     * times in one session. The assertion is unchanged; only the moment it is
     * taken is. A footprint that genuinely differs still fails, at the timeout.
     */
    await expect(async () => {
      const offerBox = await lens(page, /^offer,/i).boundingBox();
      const scalabilityBox = await lens(page, /^scalability,/i).boundingBox();
      expect(Math.abs(offerBox!.width - scalabilityBox!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(offerBox!.height - scalabilityBox!.height)).toBeLessThanOrEqual(1);
    }).toPass();
  });

  test("keeps every planet evenly spaced around the orbit", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);

    // Same reason as the footprint test above: measured once the layout has
    // stopped moving, rather than at whatever frame `goto` happens to return on.
    await expect(async () => {
      const orbit = await Promise.all(
        [
          "Offer",
          "Audience",
          "Acquisition",
          "Conversion",
          "Revenue & Economics",
          "Business Readiness",
          "Retention",
          "Measurement",
          "Scalability",
        ].map(async (name) => (await lens(page, new RegExp(`^${name},`, "i")).boundingBox())!),
      );

      const distances = orbit.map((current, index) => {
        const next = orbit[(index + 1) % orbit.length];
        const centerDistance = Math.hypot(
          current.x + current.width / 2 - (next.x + next.width / 2),
          current.y + current.height / 2 - (next.y + next.height / 2),
        );
        const visibleGap = centerDistance - (current.width + next.width) / 2;
        expect(visibleGap).toBeGreaterThan(34);
        return centerDistance;
      });

      expect(Math.max(...distances) - Math.min(...distances)).toBeLessThanOrEqual(3);
    }).toPass();
  });

  test("keeps unsupported per-lens history honest in the selected focus view", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);
    await lens(page, /revenue & economics/i).click();

    const detail = page.getByTestId("selected-lens-detail");
    await detail.getByRole("tab", { name: /^history$/i }).click();
    await expect(
      detail.getByRole("heading", { name: /no comparable history for this area yet/i }),
    ).toBeVisible();
    await expect(detail).not.toContainText(/score improved|score declined|\+\d+ points/i);

    await page.getByRole("button", { name: /back to overview/i }).click();
    await expect(page.getByRole("heading", { name: /what matters now/i })).toBeVisible();
  });

  test("supports keyboard selection and a visible focus ring", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const offer = lens(page, /offer/i);
    await offer.focus();
    await expect(offer).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("selected-lens-detail").getByRole("heading", { name: /^offer$/i })).toBeVisible();
  });

  test("renders an honest no-history state", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByTestId("recent-changes")).toContainText(/no comparable history yet/i);
    await expect(page.getByTestId("recent-changes")).not.toContainText(/improved|declined|\+\d/);
  });

  test("routes a real lineage-backed priority to its Move context", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const href = await page.getByRole("link", { name: /view 2 next moves/i }).getAttribute("href");
    expect(href).toContain("from=blocker-1");
  });

  test("offers generation honestly when no Moves exist", async ({ page }) => {
    await page.goto(NO_MOVES);

    /*
     * Scoped to the leading priority. The blocker stack below offers the same
     * label on its own cards now, and both are right — the ambiguity is in the
     * locator, not on the page.
     */
    await expect(
      page.getByTestId("primary-priority").getByRole("link", { name: /find next moves/i }),
    ).toBeVisible();
  });

  test("removes particles and large choreography for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(SYNTHESIS);

    await expect(page.getByTestId("business-map-radial")).toBeVisible();
    await expect(page.locator("[data-business-signal]")).toHaveCount(0);
    const animationDuration = await page.locator(".business-brain-node").first().evaluate(
      (element) => getComputedStyle(element).animationDuration,
    );
    expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.001);
  });
});

test.describe("responsive Business Brain", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("uses a deliberate core and browsable dimension rail instead of a tiny map", async ({
    page,
  }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByTestId("business-map-radial")).not.toBeVisible();
    const list = page.getByTestId("business-map-list");
    await expect(list).toBeVisible();
    await expect(list.getByRole("button")).toHaveCount(9);
    await expect(list.getByText(/swipe through the nine business areas/i)).toBeVisible();
  });

  test("places selected detail below the mobile model without horizontal page overflow", async ({
    page,
  }) => {
    await page.goto(SYNTHESIS);
    await lens(page, /revenue & economics/i).click();

    const listBox = await page.getByTestId("business-map-list").boundingBox();
    const detailBox = await page.getByTestId("selected-lens-detail").boundingBox();
    expect(detailBox!.y).toBeGreaterThan(listBox!.y + listBox!.height);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("truthful lifecycle", () => {
  test("analyzing engages all lenses without inventing progress", async ({ page }) => {
    await page.goto("/e2e/audit-analyzing");
    await expect(page.getByText(/all nine areas are judged together/i)).toBeVisible();
    await expect(page.getByText(/5\s*\/\s*9/i)).toHaveCount(0);
  });

  test("waiting keeps the founder question ahead of unfinished analysis", async ({ page }) => {
    await page.goto("/e2e/audit-waiting");
    await expect(page.getByText("Vibe needs you", { exact: true })).toBeVisible();
    await expect(page.getByText(/preparing your business audit/i)).toHaveCount(0);
  });
});
