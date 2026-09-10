import { expect, test, type Page } from "@playwright/test";

/**
 * A price sits on the digits' optical centre, not the line box's.
 *
 * Flex centres the coin against the text's line box, which reserves room for
 * descenders — and "35" has none, so the coin sat a pixel low. One pixel is
 * enough to look like a mistake and not enough to see why, which is exactly
 * the kind of thing that comes back the moment somebody composes a price by
 * hand instead of using the component.
 *
 * Only a browser can answer this: it needs the loaded face's real cap height.
 *
 * ## What this used to miss
 *
 * The claim above — checked at more than one size — was not true. Every
 * composition on the study drew the default, so the correction was verified at
 * 16px and nowhere else, and the `-0.06em` constant it verified was measured
 * wrong at 13px in *both* palettes and in opposite directions: 0.47px low in
 * the first, 0.53px high in the second, because Inter and Geist disagree about
 * where a capital ends. The study now renders all three sizes, and the coin is
 * placed from the `cap` unit rather than from a guess about a face.
 *
 * ## Why both palettes
 *
 * Because the defect was face-specific and one palette passed while the other
 * failed. A guard that only ever runs in the deployed palette would have gone
 * on passing.
 */

async function offsetFromOpticalCentre(page: Page, index: number) {
  return page
    .locator("[data-credit-amount]")
    .nth(index)
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const digits = context.measureText("35");
      const face = context.measureText("Hg");

      const node = [...element.childNodes].find(
        (child) => child.nodeType === 3 && child.textContent!.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();

      const ascent = face.fontBoundingBoxAscent;
      const descent = face.fontBoundingBoxDescent;
      const baseline = box.top + (box.height - (ascent + descent)) / 2 + ascent;
      const inkCentre =
        (baseline - digits.actualBoundingBoxAscent + baseline + digits.actualBoundingBoxDescent) /
        2;

      const coin = element.querySelector("svg")!.getBoundingClientRect();
      return coin.top + coin.height / 2 - inkCentre;
    });
}

for (const palette of ["v1", "v2"] as const) {
  test(`the coin sits on the digits' optical centre in ${palette}`, async ({ page }) => {
    await page.goto("/e2e/study-credits");
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-vibe", value);
    }, palette);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);

    // Every price on the page. The study renders all three sizes on purpose,
    // so this is a claim about the rule rather than about one number.
    const prices = page.locator("[data-credit-amount]");
    const count = await prices.count();
    expect(count).toBeGreaterThan(0);

    const sizes = new Set<string>();
    for (let index = 0; index < count; index++) {
      sizes.add(await prices.nth(index).evaluate((element) => getComputedStyle(element).fontSize));
      const offset = await offsetFromOpticalCentre(page, index);
      // Half a pixel of tolerance: sub-pixel layout and hinting move this
      // slightly, and the defect being guarded was a full pixel.
      expect(Math.abs(offset), `price ${index} is ${offset.toFixed(2)}px off centre`).toBeLessThan(
        0.5,
      );
    }

    // The claim the old docblock made and the page did not keep.
    expect(sizes.size, `only ${[...sizes].join(", ")} rendered`).toBeGreaterThanOrEqual(3);
  });
}
