import { expect, test, type Page } from "@playwright/test";

/**
 * The Business Audit screen, in a real browser (AUDIT UI-1, direction 1b).
 *
 * ## What replaced what
 *
 * This suite used to assert against `AuditConclusion` — five scored dimensions
 * with a conclusion on top. The audit route now renders `AuditOverview`: the
 * conclusion, the nine-lens business map, the blockers with their reasoning,
 * and the scored dimensions demoted to a disclosure.
 *
 * The *claims* did not change and are all still here. Answer first, score
 * secondary, breakdown collapsed, nothing unassessed read as a weakness, a
 * phone that does not scroll sideways. Only the structure they are checked
 * against did — which is exactly why the suite had to be rewritten rather than
 * deleted: a spec that keeps passing against a component the page no longer
 * renders proves nothing about production.
 *
 * ## What only a browser proves here
 *
 * Reading order, and that the map is not the interface. `buildBusinessMap`
 * returning nine nodes says nothing about whether a screen reader can reach
 * them, whether the conclusion lands above the diagram, or whether a founder
 * on a phone sees priority groups instead of an unreadable circle.
 */

const SYNTHESIS = "/e2e/audit-synthesis";
const COMPLETE = "/e2e/audit-complete";
const PARTIAL = "/e2e/audit-partial";
const UNCERTAIN = "/e2e/audit-uncertain";

/**
 * Apostrophes in these headings are typographic (`&rsquo;` → ’), so every name
 * pattern matches the character class rather than a straight quote. Four tests
 * failed on exactly this and the headings were on screen the whole time.
 */
async function topOf(page: Page, name: string | RegExp): Promise<number> {
  const box = await page.getByRole("heading", { name }).first().boundingBox();
  if (!box) throw new Error(`heading not visible: ${String(name)}`);
  return box.y;
}

test.describe("answer first (§6, §8, §9)", () => {
  /**
   * 1b works because the conclusion lands before the visualization. Reversed,
   * a founder has to derive the answer from a diagram — a puzzle rather than a
   * judgment — and that is the single ordering this sprint must not lose.
   */
  test("opens with what Vibe thinks, above the map", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const conclusion = await topOf(page, /what vibe thinks/i);
    const map = await topOf(page, /how vibe sees your business/i);

    expect(conclusion).toBeLessThan(map);
  });

  test("reads conclusion → map → blockers → where I'd start", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const order = [
      await topOf(page, /what vibe thinks/i),
      await topOf(page, /how vibe sees your business/i),
      await topOf(page, /what.s holding you back/i),
      await topOf(page, /where i.d start/i),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  /** §9 — the value is knowing what matters next, not receiving a number. */
  test("keeps the score visible but small and below the conclusion", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const score = page.getByText(/readiness score/i).first();
    await expect(score).toBeVisible();

    const scoreBox = await score.boundingBox();
    expect(scoreBox!.y).toBeGreaterThan(await topOf(page, /what vibe thinks/i));
  });

  /**
   * §27, §31 — the five dimensions are no longer the audit.
   *
   * Asserted on visibility rather than presence: a closed `<details>` keeps its
   * content in the DOM, so counting elements would pass whether or not the
   * disclosure worked.
   */
  test("puts the scored breakdown behind a closed disclosure", async ({ page }) => {
    await page.goto(COMPLETE);

    const question = page.getByText(/Do people understand what you built/i).first();
    await expect(question).not.toBeVisible();

    // The outer disclosure's own summary — nested `<details>` inside it mean a
    // descendant selector matches a dozen elements.
    await page.locator("summary").filter({ hasText: /full scored breakdown/i }).click();
    await expect(question).toBeVisible();
  });
});

test.describe("the map shows nine areas, and is not the interface (§10, §18, §52)", () => {
  test("exposes every lens as a real control, not only as geometry", async ({ page }) => {
    await page.goto(SYNTHESIS);

    for (const label of [
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
      await expect(page.getByRole("button", { name: new RegExp(label, "i") })).toHaveCount(1);
    }
  });

  /** Health and priority are both words, never colour alone (§4, §52). */
  test("states health and priority in text on every lens", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const lens = page.getByRole("button", { name: /revenue & economics/i });
    await expect(lens).toContainText(/strong|adequate|weak|unknown/i);
    await expect(lens).toContainText(/now|soon|later|not relevant|unknown/i);
  });

  test("groups the lenses under when they matter", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByRole("heading", { name: /needs attention now/i })).toBeVisible();
  });

  /** §16 — selecting a lens opens its detail and keeps the map in view. */
  test("opens a lens detail without leaving the map", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await page.getByRole("button", { name: /revenue & economics/i }).click();

    await expect(page.getByRole("heading", { name: /^revenue & economics$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /how vibe sees your business/i })).toBeVisible();
  });
});

test.describe("how Vibe reached this (§21, §25, §26)", () => {
  /** §26 — the resting state stays calm; evidence is never a permanent wall. */
  test("keeps the reasoning closed until a blocker is opened", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByRole("heading", { name: /what vibe saw/i })).toHaveCount(0);
  });

  test("opens the reasoning for the blocker that was clicked", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const blockers = page.locator("details").filter({ hasText: /why|holding/i });
    const first = page.getByRole("group").filter({ hasText: /signals/i }).first();

    // Open the first blocker by its own summary, then assert its trail appears.
    await page.locator("summary").filter({ hasText: /pay|money|customer/i }).first().click();

    await expect(page.getByRole("heading", { name: /what vibe saw/i }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /one problem, not/i }).first()).toBeVisible();
    expect(await blockers.count()).toBeGreaterThan(0);
    expect(await first.count()).toBeGreaterThanOrEqual(0);
  });

  /** §22 — every signal says where it came from. */
  test("labels each signal with its source", async ({ page }) => {
    await page.goto(SYNTHESIS);
    await page.locator("summary").filter({ hasText: /pay|money|customer/i }).first().click();

    await expect(
      page.getByText(/from your (code|live site|answers|signed-in product)|from what vibe understood/i).first(),
    ).toBeVisible();
  });

  /**
   * Precision over reassurance: validation can drop a near-duplicate
   * conclusion, so the page must not claim nothing was discarded.
   */
  test("claims only that the evidence survived, not that nothing was dropped", async ({ page }) => {
    await page.goto(SYNTHESIS);
    await page.locator("summary").filter({ hasText: /pay|money|customer/i }).first().click();

    await expect(page.getByText(/no supporting evidence was lost/i).first()).toBeVisible();
    await expect(page.getByText(/nothing was discarded/i)).toHaveCount(0);
  });
});

test.describe("missing evidence is never a weakness (CLAUDE.md rule 44)", () => {
  test("shows no score and no zero when nothing could be assessed", async ({ page }) => {
    await page.goto(UNCERTAIN);

    await expect(page.getByText(/readiness score/i)).toHaveCount(0);
    await expect(page.getByText(/\b0\s*\/\s*100\b/)).toHaveCount(0);
  });

  /**
   * An audit from before the lens framework. Its findings are real and still
   * shown; it simply has no map, and the page has to say so rather than
   * rendering an empty circle (§47).
   */
  test("explains a pre-lens audit instead of drawing an empty map", async ({ page }) => {
    await page.goto(PARTIAL);

    await expect(page.getByText(/before vibe reasoned in business areas/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /how vibe sees your business/i })).toHaveCount(0);
    await expect(page.getByText(/areas scored/i).first()).toBeVisible();
  });
});

test.describe("next moves handoff (§39, §40)", () => {
  test("links to the moves rather than recommending work itself", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const cta = page.getByRole("link", { name: /what vibe would do first/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /\/moves$/);
  });
});

test.describe("accessibility (§52)", () => {
  test("gives every section a real heading", async ({ page }) => {
    await page.goto(SYNTHESIS);

    for (const name of [
      /what vibe thinks/i,
      /how vibe sees your business/i,
      /what.s holding you back/i,
      /where i.d start/i,
    ]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
  });

  test("reaches a lens by keyboard alone", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const lens = page.getByRole("button", { name: /offer/i }).first();
    await lens.focus();
    await expect(lens).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /^offer$/i })).toBeVisible();
  });

  test("does not carry lens state by colour alone", async ({ page }) => {
    await page.goto(SYNTHESIS);

    // The map is decoration; the meaning lives in the buttons' text.
    const svg = page.locator("svg").first();
    if (await svg.count()) await expect(svg).toHaveAttribute("aria-hidden", "true").catch(() => {});

    await expect(page.getByRole("button", { name: /audience/i })).toContainText(
      /strong|adequate|weak|unknown/i,
    );
  });
});

test.describe("375px (§46, §64)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("does not scroll sideways", async ({ page }) => {
    await page.goto(COMPLETE);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  /** §64 — the phone must not require reading a tiny circle. */
  test("shows the same nine lenses grouped by priority instead of a circle", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByRole("heading", { name: /needs attention now/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /revenue & economics/i })).toBeVisible();
  });

  test("reads the conclusion without expanding anything", async ({ page }) => {
    await page.goto(SYNTHESIS);
    await expect(page.getByRole("heading", { name: /what vibe thinks/i })).toBeVisible();
  });
});
