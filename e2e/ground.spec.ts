import { expect, test, type Page } from "@playwright/test";

/**
 * The ground, in a browser.
 *
 * The unit guard asserts that some component wears each ground class. Only a
 * browser can say whether the rule then paints anything — and the defect this
 * pair replaces was exactly a rule that existed, a class nobody wore, and a
 * product drawing glass over a flat field while every test passed.
 *
 * The palette is still dormant, so `data-vibe` is set from here. That is the
 * same way the scoped tokens were proved before any route opted in: the
 * attribute is the switch, and nothing in the product throws it yet.
 */

const NOVA = "/e2e/nova-priced";
/** A route that deliberately did not opt into the contained field. */
const DENSE = "/e2e/repository_intelligence";

async function paletteV2(page: Page) {
  await page.evaluate(() => document.documentElement.setAttribute("data-vibe", "v2"));
  // One frame for the new custom properties to resolve.
  await page.waitForTimeout(200);
}

function layer(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        image: style.backgroundImage,
        position: style.position,
        zIndex: style.zIndex,
        opacity: style.opacity,
        events: style.pointerEvents,
      };
    });
}

test.describe("the ground exists and stays out of the way", () => {
  test("paints nothing at all in the first palette", async ({ page }) => {
    await page.goto(NOVA);
    for (const selector of [".vibe-atmosphere", ".vibe-grain", ".vibe-atmosphere-field"]) {
      const found = await layer(page, selector);
      // The hooks are rendered in v1 too; they simply match no rule there,
      // which is what makes the palette switchable without touching a route.
      expect(found.image, `${selector} must be inert in v1`).toBe("none");
      expect(found.position).toBe("static");
    }
  });

  test("paints the ramp and the grain in the second", async ({ page }) => {
    await page.goto(NOVA);
    await paletteV2(page);

    const ramp = await layer(page, ".vibe-atmosphere");
    expect(ramp.image).toContain("linear-gradient");
    expect(ramp.position).toBe("fixed");
    expect(ramp.zIndex).toBe("-1");

    const grain = await layer(page, ".vibe-grain");
    expect(grain.image).toContain("data:image/svg+xml");
    // Present but nearly not there; a grain you can see is noise.
    expect(Number(grain.opacity)).toBeLessThan(0.06);
    expect(Number(grain.opacity)).toBeGreaterThan(0);
  });

  test("gives the contained field only to the screen that opted in", async ({ page }) => {
    await page.goto(NOVA);
    await paletteV2(page);
    const field = await layer(page, ".vibe-atmosphere-field");
    expect(field.image).toContain("radial-gradient");
    expect(field.position).toBe("fixed");

    await page.goto(DENSE);
    await paletteV2(page);
    await expect(page.locator(".vibe-atmosphere-field")).toHaveCount(0);
    // The ramp is still there — a route that does not opt in gets the quiet
    // ground, never no ground at all.
    expect((await layer(page, ".vibe-atmosphere")).image).toContain("linear-gradient");
  });

  test("takes no pointer and no tab stop", async ({ page }) => {
    await page.goto(NOVA);
    await paletteV2(page);
    for (const selector of [".vibe-atmosphere", ".vibe-grain", ".vibe-atmosphere-field"]) {
      expect((await layer(page, selector)).events).toBe("none");
    }
    const focusable = await page
      .locator(".vibe-atmosphere, .vibe-grain, .vibe-atmosphere-field")
      .evaluateAll((nodes) => nodes.filter((n) => (n as HTMLElement).tabIndex >= 0).length);
    expect(focusable).toBe(0);
  });
});
