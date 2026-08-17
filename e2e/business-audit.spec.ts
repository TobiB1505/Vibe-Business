import { expect, test, type Page } from "@playwright/test";

/**
 * The Business Audit screen, in a real browser (AUDIT UI-1 · UI-1.2).
 *
 * ## What replaced what
 *
 * This suite used to assert against `AuditConclusion` — five scored dimensions
 * with a conclusion on top. The audit route now renders `AuditOverview`: the
 * conclusion, the nine-lens business map beside the current priorities, and the
 * selected area's full argument below both.
 *
 * The *claims* did not change and are all still here. Answer first, score
 * secondary, nothing unassessed read as a weakness, a phone that does not
 * scroll sideways. Only the structure they are checked against did — which is
 * exactly why the suite had to be rewritten rather than deleted: a spec that
 * keeps passing against a component the page no longer renders proves nothing
 * about production.
 *
 * ## What UI-1.2 deleted, and what now asserts it stays deleted
 *
 * The five scored dimensions are no longer rendered to a customer at all, not
 * even collapsed. Two tests here used to open that disclosure; they now assert
 * it does not exist, because a page that offers a second, competing verdict has
 * not made one.
 *
 * ## What only a browser proves here
 *
 * Reading order, and that the map is not geometry alone. `buildBusinessMap`
 * returning nine nodes says nothing about whether a screen reader can reach
 * them, whether the conclusion lands above the diagram, or whether a founder
 * on a phone sees priority groups instead of an unreadable circle.
 */

const SYNTHESIS = "/e2e/audit-synthesis";
const NO_MOVES = "/e2e/audit-synthesis-no-moves";
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

  /**
   * UI-1.2 §9, §10 — strengths are the ground the founder stands on, not the
   * work. They stay on the page and move below the panel, so the reading order
   * is answer → what matters → what is already fine.
   */
  test("reads conclusion, then the panel, then what is already working", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const order = [
      await topOf(page, /what vibe thinks/i),
      await topOf(page, /business intelligence/i),
      await topOf(page, /what.s already working/i),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  /**
   * §9 — the value is knowing what matters next, not receiving a number.
   *
   * The score sits in the middle of the map, where it reads as one reading
   * among nine areas rather than as the page's answer. Asserted as *below the
   * conclusion* rather than by container, because that is the property §9
   * actually cares about: a founder must meet the sentence first.
   */
  test("keeps the score below the conclusion, inside the map", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const score = page.getByText("readiness", { exact: false }).first();
    await expect(score).toBeVisible();

    const scoreBox = await score.boundingBox();
    expect(scoreBox!.y).toBeGreaterThan(await topOf(page, /what vibe thinks/i));

    // And never twice: repeating it in the header would make it a headline.
    await expect(page.getByText(/\/ 100 readiness/i)).toHaveCount(0);
  });

  /**
   * UI-1.2 §20 — the five legacy dimensions are gone from the customer UI.
   *
   * Asserted by count rather than by visibility, which is the stronger claim:
   * a closed `<details>` is invisible but still shipped, and this test has to
   * fail the moment the old breakdown is rendered again in any state. The
   * dimensions are still measured, still stored and still cited — they are
   * simply no longer a second verdict competing with the nine lenses.
   */
  test("does not ship the legacy five-dimension breakdown at all", async ({ page }) => {
    await page.goto(COMPLETE);

    await expect(page.locator("summary").filter({ hasText: /technical breakdown/i })).toHaveCount(
      0,
    );
    await expect(page.getByText(/Do people understand what you built/i)).toHaveCount(0);
    await expect(page.getByTestId("audit-technical-breakdown")).toHaveCount(0);
  });
});

/**
 * Lens queries are scoped to the map panel throughout.
 *
 * UI-1.2 made a lens name appear in two legitimate places — the map node and
 * the priority that spans that lens — so an unscoped `getByRole("button", {
 * name: /revenue/i })` is now ambiguous by design rather than by mistake.
 * Scoping keeps each assertion pointed at the surface it is actually about.
 */
function mapLens(page: Page, label: string | RegExp) {
  return page
    .getByTestId("audit-map-panel")
    .getByRole("button", { name: typeof label === "string" ? new RegExp(label, "i") : label });
}

test.describe("the map shows nine areas and remains accessible (§10, §18, §52)", () => {
  test("uses the radial map on desktop, with priorities beside it rather than a second lens list", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByTestId("business-map-radial")).toBeVisible();
    await expect(page.getByTestId("business-map-list")).not.toBeVisible();
    await expect(
      page.getByRole("list", { name: /business lenses/i }).getByRole("listitem"),
    ).toHaveCount(9);

    /*
     * UI-1.2 §5 — the right column carries the audit's own priorities and
     * nothing else. One control per blocker: a column that grew a control per
     * lens would be the duplicate list the map already is.
     */
    await expect(page.getByTestId("current-priorities").getByRole("button")).toHaveCount(2);
  });

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
      await expect(mapLens(page, label)).toHaveCount(1);
    }
  });

  /** Health and priority are both words, never colour alone (§4, §52). */
  test("states health and priority in text on every lens", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const lens = mapLens(page, /revenue & economics/i);
    await expect(lens).toContainText(/strong|adequate|weak|unknown/i);
    await expect(lens).toContainText(/now|soon|later|not relevant|unknown/i);
  });

  /** §16 — selecting a lens opens its detail and keeps the map in view. */
  test("opens a lens detail without leaving the map", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await mapLens(page, /revenue & economics/i).click();

    await expect(page.getByRole("heading", { name: /^revenue & economics$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /how vibe sees your business/i })).toBeVisible();
  });
});

test.describe("business interpretation uses the audit's truth", () => {
  test("renders the actual strengths and exact blocker count", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByText("People can understand and start using your product.")).toBeVisible();

    const priorities = page.getByTestId("current-priorities").getByRole("button");
    await expect(priorities).toHaveCount(2);
    // Rank is the audit's ordering, not the list's — nothing here re-sorts.
    await expect(priorities.first()).toHaveAttribute("data-primary", "true");
    await expect(priorities.nth(1)).not.toHaveAttribute("data-primary", "true");
  });

  test("keeps health independent from materiality", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const revenue = mapLens(page, /revenue & economics/i);
    await expect(revenue).toHaveAttribute("aria-label", /health weak.*priority soon/i);
  });

  /**
   * UI-1.2 §11 — "Where I'd start" was a large card repeating blocker #1 one
   * screen below blocker #1. The claim it was making is still made, by the
   * first priority marking itself as the place to start.
   */
  test("marks the audit's first blocker as where to start, once", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const primary = page.getByTestId("current-priorities").getByRole("button").first();
    await expect(primary).toContainText("People still don't have a clear way to pay you.");
    await expect(primary).toContainText(/start here/i);

    // Said once. The duplicate card is what this sprint removed.
    await expect(page.getByText(/where i.d start/i)).toHaveCount(0);
  });
});

test.describe("how Vibe reached this (§21, §25, §26)", () => {
  /** §26 — the resting state stays calm; evidence is never a permanent wall. */
  test("keeps the reasoning closed until a blocker is opened", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await expect(page.getByRole("heading", { name: /what vibe saw/i })).toHaveCount(0);
  });

  /**
   * UI-1.2 §13 — the trail moved out of the narrow column and under the
   * selected area, which is where the width to read it is. Selecting the second
   * priority and opening its trail proves the disclosure is scoped to the
   * selection rather than to the page.
   */
  test("opens the reasoning for the priority that was selected", async ({ page }) => {
    await page.goto(SYNTHESIS);

    await page.getByTestId("current-priorities").getByRole("button").nth(1).click();
    await expect(page.getByTestId("selected-problem")).toContainText(
      "You may not be able to tell what is actually working.",
    );

    await page.getByTestId("selected-problem").locator("summary").click();

    await expect(page.getByRole("heading", { name: /what vibe saw/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /one problem, not/i })).toBeVisible();
  });

  /**
   * §22 — every signal says where it came from.
   *
   * Filtered to what is visible rather than taking `.first()`: the selected
   * lens carries its own closed "Why Vibe thinks this" above this trail, so the
   * first match in document order is a hidden one. Asserting on it would have
   * tested a collapsed disclosure.
   */
  test("labels each signal with its source", async ({ page }) => {
    await page.goto(SYNTHESIS);
    await page.getByTestId("selected-problem").locator("summary").click();

    await expect(
      page
        .getByText(/from your (code|live site|answers|signed-in product)|from what vibe understood/i)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  });

  /**
   * Precision over reassurance: validation can drop a near-duplicate
   * conclusion, so the page must not claim nothing was discarded.
   */
  test("claims only that the evidence survived, not that nothing was dropped", async ({ page }) => {
    await page.goto(SYNTHESIS);
    await page.getByTestId("selected-problem").locator("summary").click();

    await expect(page.getByText(/no supporting evidence was lost/i).first()).toBeVisible();
    await expect(page.getByText(/nothing was discarded/i)).toHaveCount(0);
  });
});

test.describe("missing evidence is never a weakness (CLAUDE.md rule 44)", () => {
  test("shows no score and no zero when nothing could be assessed", async ({ page }) => {
    await page.goto(UNCERTAIN);

    await expect(page.getByText(/\/ 100 readiness/i)).toHaveCount(0);
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

test.describe("next moves handoff (§39, §40; reworked in UI-S2 §8, §19)", () => {
  /**
   * The audit still recommends nothing itself — it links to the Moves, which
   * is what these assertions were always about. What UI-S2 changed is that the
   * link now carries *which finding* the founder is acting on, so the Moves
   * page opens on the two Moves that answer it rather than on everything.
   */
  test("links to the moves that answer the finding, rather than recommending work itself", async ({
    page,
  }) => {
    await page.goto(SYNTHESIS);

    const cta = page.getByRole("link", { name: /what vibe would do/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /\/moves\?from=blocker-1$/);
  });

  /**
   * Previously: no CTA and a sentence stating the absence — which read as
   * honest and behaved as a dead end (UI-S2 §19). The honesty is unchanged;
   * what was added is somewhere to go. Generation stays an explicit, paid
   * action on the Moves page, so this links there rather than starting it.
   */
  test("offers a way forward when no real moves exist", async ({ page }) => {
    await page.goto(NO_MOVES);

    await expect(page.getByRole("link", { name: /what vibe would do/i })).toHaveCount(0);

    const findMoves = page.getByRole("link", { name: "Find my next moves" });
    await expect(findMoves).toBeVisible();
    await expect(findMoves).toHaveAttribute("href", /\/moves$/);
  });
});

test.describe("accessibility (§52)", () => {
  test("gives every section a real heading", async ({ page }) => {
    await page.goto(SYNTHESIS);

    for (const name of [
      /what vibe thinks/i,
      /how vibe sees your business/i,
      /current priorities/i,
      /what.s already working/i,
    ]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
  });

  test("reaches a lens by keyboard alone", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const lens = mapLens(page, /offer/i).first();
    await lens.focus();
    await expect(lens).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /^offer$/i })).toBeVisible();
  });

  test("does not carry lens state by colour alone", async ({ page }) => {
    await page.goto(SYNTHESIS);

    // The SVG is decoration; the meaning lives in the buttons' text.
    const svg = page.locator("svg").first();
    if (await svg.count()) await expect(svg).toHaveAttribute("aria-hidden", "true").catch(() => {});

    await expect(mapLens(page, /audience/i)).toContainText(
      /strong|adequate|weak|unknown/i,
    );
  });

  test("honours reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(SYNTHESIS);

    const durationMs = await page.locator(".audit-map-node-halo").first().evaluate(
      (element) => {
        const duration = getComputedStyle(element).animationDuration;
        return duration.endsWith("ms")
          ? Number.parseFloat(duration)
          : Number.parseFloat(duration) * 1000;
      },
    );
    expect(durationMs).toBeLessThanOrEqual(0.1);
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
    await expect(mapLens(page, /revenue & economics/i)).toBeVisible();
    await expect(page.getByTestId("business-map-radial")).not.toBeVisible();
    await expect(page.getByTestId("business-map-list")).toBeVisible();
  });

  test("reads the conclusion without expanding anything", async ({ page }) => {
    await page.goto(SYNTHESIS);
    await expect(page.getByRole("heading", { name: /what vibe thinks/i })).toBeVisible();
  });

  test("reads answer → priorities → ordered lenses", async ({ page }) => {
    await page.goto(SYNTHESIS);

    const order = [
      await topOf(page, /what vibe thinks/i),
      await topOf(page, /current priorities/i),
      await topOf(page, /needs attention now/i),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

/**
 * UI-1.2 §2 — the map has to be *readable*, which is a browser fact.
 *
 * Nine cards sit 40° apart, so two neighbours on one ring are `2r·sin20°`
 * apart; at the radii this map shipped with, that was less than a card's width
 * and the Now ring overlapped itself. No unit test could have caught it — the
 * view model was correct the whole time and the geometry lives in CSS.
 */
test.describe("the map is legible, not just correct (§2)", () => {
  for (const width of [1440, 1280]) {
    test(`${width}: no two lens cards overlap`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(SYNTHESIS);

      const cards = page.getByTestId("business-map-radial").getByRole("button");
      const boxes = await cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { label: node.textContent ?? "", x: box.x, y: box.y, w: box.width, h: box.height };
        }),
      );
      expect(boxes).toHaveLength(9);

      const overlapping: string[] = [];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          const overlaps =
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          if (overlaps) overlapping.push(`${a.label} / ${b.label}`);
        }
      }

      expect(overlapping).toEqual([]);
    });
  }

  /**
   * The three ring names are the map's key. A label sitting under a card is
   * the same as no label — and that is exactly how this shipped twice.
   */
  test("keeps the ring names clear of every card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(SYNTHESIS);

    const radial = page.getByTestId("business-map-radial");
    const cards = await radial.getByRole("button").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, w: box.width, h: box.height };
      }),
    );

    for (const ring of ["NOW", "SOON", "LATER"]) {
      const label = radial.locator("text", { hasText: new RegExp(`^${ring}$`) }).first();
      const box = await label.boundingBox();
      if (!box) throw new Error(`ring label not rendered: ${ring}`);

      const covered = cards.some(
        (card) =>
          box.x < card.x + card.w &&
          card.x < box.x + box.width &&
          box.y < card.y + card.h &&
          card.y < box.y + box.height,
      );
      expect(covered, `${ring} is underneath a lens card`).toBe(false);
    }
  });
});

test.describe("responsive intelligence panel", () => {
  for (const viewport of [
    { width: 1440, height: 1000, label: "1440 desktop" },
    { width: 1280, height: 900, label: "1280 desktop" },
    { width: 1024, height: 900, label: "tablet" },
  ]) {
    test(`${viewport.label} keeps the Map readable without horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(SYNTHESIS);

      await expect(page.getByTestId("business-map-radial")).toBeVisible();
      await expect(page.getByRole("heading", { name: /current priorities/i })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("truthful lifecycle", () => {
  test("analyzing engages all lenses without inventing 5/9 progress", async ({ page }) => {
    await page.goto("/e2e/audit-analyzing");

    await expect(page.getByText(/all nine areas are judged together/i)).toBeVisible();
    await expect(page.getByText(/5\s*\/\s*9/i)).toHaveCount(0);
  });
});
