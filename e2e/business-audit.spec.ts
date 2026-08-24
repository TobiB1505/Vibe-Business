import { expect, test, type Page } from "@playwright/test";

const SYNTHESIS = "/e2e/audit-synthesis";
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

  test("keeps absent lens scores absent instead of copying reference numbers", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(lens(page, /revenue & economics/i)).toHaveAttribute(
      "aria-label",
      /not individually scored.*weak.*priority soon/i,
    );
    await expect(lens(page, /scalability/i)).toHaveAttribute(
      "aria-label",
      /not individually scored.*unknown/i,
    );
    await expect(page.getByText(/unknown is never scored as zero/i)).toBeVisible();
  });

  test("shows only the highest real priority by default and the exact remaining count", async ({
    page,
  }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByTestId("primary-priority")).toContainText(
      "People still don't have a clear way to pay you.",
    );
    await expect(page.getByText(/see 1 more priority/i)).toBeVisible();
    await expect(page.getByTestId("primary-priority")).toContainText(/high impact/i);
    await expect(page.getByTestId("primary-priority")).toContainText(/medium effort/i);
  });

  test("transitions the right panel into selected-area detail without navigation or a report below", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SYNTHESIS);
    const before = page.url();

    await lens(page, /revenue & economics/i).click();

    const detail = page.getByTestId("selected-lens-detail");
    await expect(detail.getByRole("heading", { name: /^revenue & economics$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /what matters now/i })).toHaveCount(0);
    expect(page.url()).toBe(before);

    const mapBox = await page.getByTestId("audit-map-panel").boundingBox();
    const detailBox = await detail.boundingBox();
    expect(detailBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width);
    await expect(detail.getByText(/connected areas/i)).toBeVisible();
    await expect(page.getByTestId("business-map-radial")).toBeVisible();
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

    await expect(page.getByRole("link", { name: /find next moves/i })).toBeVisible();
  });

  test("removes particles and large choreography for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(SYNTHESIS);

    await expect(page.getByTestId("business-map-radial")).toBeVisible();
    await expect(page.locator('path[stroke-dasharray="1 30"]')).toHaveCount(0);
    const animationDuration = await page.locator(".business-brain-node").first().evaluate(
      (element) => getComputedStyle(element).animationDuration,
    );
    expect(animationDuration).toBe("0s");
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
    await expect(page.getByText(/vibe needs you/i)).toBeVisible();
    await expect(page.getByText(/preparing your business audit/i)).toHaveCount(0);
  });
});
