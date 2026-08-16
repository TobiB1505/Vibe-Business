import { expect, test, type Page } from "@playwright/test";

/**
 * The human-first Business Audit, in a real browser (CORE-2 §14, §62, §63).
 *
 * ## Why this suite exists
 *
 * CORE-2's claim about the audit is entirely about **reading order**. "Answer
 * first, evidence second, tech last" is not a property of a data structure:
 * `buildHumanAuditView` returning a conclusion proves the sentence exists, not
 * that a founder meets it before a number out of 100.
 *
 * The other reason is CLAUDE.md rule 44, which this project has paid for
 * before. A dimension that could not be assessed must never read as a finding
 * about the product. The unit tests prove it is absent from `blockersFrom`;
 * only a browser proves it is not sitting under the "what's holding you back"
 * heading on screen.
 *
 * ## What it does not prove
 *
 * That the score route assembles the right audit — the fixture supplies it,
 * from the real scoring function. The same documented gap the merge,
 * understanding and repository-intelligence suites carry.
 */

const COMPLETE = "/e2e/audit-complete";
const PARTIAL = "/e2e/audit-partial";
const UNCERTAIN = "/e2e/audit-uncertain";

/** Vertical position of the first element matching a heading, for ordering. */
async function headingTop(page: Page, name: string | RegExp): Promise<number> {
  const box = await page.getByRole("heading", { name }).first().boundingBox();
  if (!box) throw new Error(`heading not visible: ${String(name)}`);
  return box.y;
}

/**
 * The conclusion is the single sentence a founder reads first, so it gets its
 * own browser assertion. The first dogfood shipped "Where you're strongest: do
 * people understand what you built? Where you're weakest: can you make money
 * from it?" — question marks mid-clause — and every test was green, because the
 * unit test asserted that exact string.
 */
test.describe("the conclusion reads as a sentence (CORE-2 §14)", () => {
  test("contains no interpolated questions", async ({ page }) => {
    await page.goto(COMPLETE);

    const conclusion = await page
      .getByRole("heading", { name: "What Vibe thinks about the business" })
      .locator("xpath=following-sibling::p[1]")
      .innerText();

    expect(conclusion).not.toContain("?");
    expect(conclusion.trim()).toMatch(/\.$/);
  });
});

test.describe("answer first (CORE-2 §14)", () => {
  test("opens with what Vibe thinks, not with a score", async ({ page }) => {
    await page.goto(COMPLETE);

    await expect(
      page.getByRole("heading", { name: "What Vibe thinks about the business" }),
    ).toBeVisible();

    const conclusionTop = await headingTop(page, "What Vibe thinks about the business");
    const scoreTop = (await page.getByText(/Readiness score/).first().boundingBox())!.y;

    expect(conclusionTop).toBeLessThan(scoreTop);
  });

  test("reads working → holding you back → why it matters → where I'd start", async ({ page }) => {
    await page.goto(COMPLETE);

    const working = await headingTop(page, /What.s already working/);
    const blocking = await headingTop(page, /What.s holding you back/);
    const matters = await headingTop(page, "Why it matters");
    const start = await headingTop(page, /Where I.d start/);

    expect(working).toBeLessThan(blocking);
    expect(blocking).toBeLessThan(matters);
    expect(matters).toBeLessThan(start);
  });

  test("keeps the score visible but secondary", async ({ page }) => {
    await page.goto(COMPLETE);

    // Visible: hiding a number the product computed would be its own dishonesty.
    await expect(page.getByText(/Readiness score \d+\/100/)).toBeVisible();
    // Secondary: it is not a heading, and it is not the first thing on screen.
    await expect(page.getByRole("heading", { name: /Readiness score/ })).toHaveCount(0);
  });

  test("puts the per-dimension breakdown behind a disclosure", async ({ page }) => {
    await page.goto(COMPLETE);

    const disclosure = page.getByText("See the full breakdown by dimension");
    await expect(disclosure).toBeVisible();

    // Collapsed on first paint: the technical reading is available, not imposed.
    await expect(page.getByText("Business readiness")).toBeHidden();

    await disclosure.click();
    await expect(page.getByText("Business readiness")).toBeVisible();
  });
});

test.describe("missing evidence is never a weakness (CLAUDE.md rule 44)", () => {
  test("keeps an unassessed dimension out of what's holding you back", async ({ page }) => {
    await page.goto(PARTIAL);

    // Scoped by test id rather than by DOM traversal: the collapsed breakdown
    // legitimately names every dimension, so an unscoped query would find the
    // unassessed ones there and prove nothing about this section.
    const blockers = page.getByTestId("audit-blockers");

    // Both unassessed dimensions phrase their gap as "could not be observed".
    // Neither may appear in this section under any wording.
    await expect(blockers.getByText(/could not be observed/)).toHaveCount(0);
    await expect(blockers.getByText("Do people come back?")).toHaveCount(0);
    await expect(blockers.getByText("Do visitors become customers?")).toHaveCount(0);
  });

  test("reports what it could not see as its own section", async ({ page }) => {
    await page.goto(PARTIAL);

    const blindSpots = page.getByTestId("audit-blind-spots");

    await expect(blindSpots.getByText(/What Vibe couldn.t see/)).toBeVisible();
    await expect(blindSpots.getByText("Do people come back?")).toBeVisible();
    await expect(blindSpots.getByText("Do visitors become customers?")).toBeVisible();
  });

  test("states coverage in words, so a partial audit cannot read as complete", async ({ page }) => {
    await page.goto(PARTIAL);
    await expect(page.getByText("3 of 5 areas assessed")).toBeVisible();
  });

  test("shows no score and no zero when nothing could be assessed", async ({ page }) => {
    await page.goto(UNCERTAIN);

    await expect(page.getByText(/isn't enough evidence/)).toBeVisible();
    await expect(page.getByText(/Readiness score/)).toHaveCount(0);
    await expect(page.getByText("0/100")).toHaveCount(0);
  });
});

test.describe("next moves come from the Opportunity Engine (CORE-2 §18)", () => {
  test("links to the moves rather than listing recommendations of its own", async ({ page }) => {
    await page.goto(COMPLETE);

    const link = page.getByRole("link", { name: "See what Vibe would do first" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/app/projects/project_e2e/moves");
  });
});

test.describe("accessibility (CORE-2 §62)", () => {
  test("nests headings so the outline matches what is on screen", async ({ page }) => {
    await page.goto(COMPLETE);

    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "What Vibe thinks about the business",
    );
    // The four sections beneath it are all siblings at one level down.
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(4);
  });

  test("makes every evidence disclosure operable by keyboard alone", async ({ page }) => {
    await page.goto(COMPLETE);

    const why = page.getByText("Why?").first();
    await why.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("details[open]").first()).toBeVisible();
  });

  test("does not carry state by colour alone", async ({ page }) => {
    await page.goto(PARTIAL);

    // The bullet markers are decorative; the meaning lives in the headings and
    // in the question printed under each item.
    await expect(page.getByText("Do people understand what you built?").first()).toBeVisible();
    await expect(page.locator("[aria-hidden='true']").first()).toBeAttached();
  });
});

test.describe("responsive (CORE-2 §63)", () => {
  for (const width of [1440, 1024, 768, 375]) {
    test(`does not scroll sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(PARTIAL);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("keeps the conclusion readable on a phone without expanding anything", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(COMPLETE);

    await expect(
      page.getByRole("heading", { name: "What Vibe thinks about the business" }),
    ).toBeVisible();
    await expect(page.getByText(/You're strongest at/)).toBeVisible();
  });
});
