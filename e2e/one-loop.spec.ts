import { expect, test, type Page } from "@playwright/test";

/**
 * Audit → Move → Prepare → Prepared, in a real browser (UI-S2 §41, §42).
 *
 * ## What this suite is arguing
 *
 * That the four screens are one product story rather than four surfaces a
 * founder has to reassemble. Every assertion is about something a person can
 * see and act on: whether a finding leads anywhere, whether the Moves it leads
 * to say what they are answering, whether the card offers exactly one thing to
 * do, and whether preparing a change tells you where the change went.
 *
 * ## What it deliberately does not assert
 *
 * Anything about ranking *quality*, evidence *quality*, or the Opportunity
 * Engine's judgment. Those are the domain's, they are tested there, and this
 * sprint changed none of them.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const RANKED = "/e2e/moves_ranked";
const FROM_CONCLUSION = "/e2e/moves_from_conclusion";
const BAD_CONTEXT = "/e2e/moves_bad_context";

const PAYMENT = "People don't yet have a clear way to pay you.";

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

test.describe("the audit hands off to the moves that answer it", () => {
  test("the top priority carries a real action, not an inert label", async ({ page }) => {
    await page.goto("/e2e/audit-synthesis");

    const priorities = page.getByTestId("current-priorities");
    const primary = priorities.getByRole("link", { name: "View 2 next moves" });

    await expect(primary).toBeVisible();
    // The seam: the link carries the finding's stable key, so the Moves page
    // opens knowing what the founder came to solve.
    await expect(primary).toHaveAttribute("href", /\/plan\?from=blocker-1$/);
  });

  test("secondary priorities stay reachable through the quieter remaining-priorities link", async ({
    page,
  }) => {
    await page.goto("/e2e/audit-synthesis");

    const secondary = page.getByTestId("current-priorities").getByRole("link", {
      name: "See 1 more priority",
    });
    await expect(secondary).toHaveAttribute("href", /\/plan$/);
  });

  /** §5: the key is an address, never something a founder reads. */
  test("never shows the conclusion key on screen", async ({ page }) => {
    await page.goto("/e2e/audit-synthesis");

    const body = page.locator("body");
    for (const internal of ["blocker-1", "blocker-2", "sourceConclusionKey", "conclusion_key"]) {
      await expect(body, internal).not.toContainText(internal);
    }
  });

  /** §19: an audit with no Moves behind it used to be a sentence and a full stop. */
  test("offers a way forward even when no moves exist yet", async ({ page }) => {
    await page.goto("/e2e/audit-synthesis-no-moves");

    const priorities = page.getByTestId("current-priorities");
    await expect(priorities.getByRole("link", { name: "Find next moves" })).toBeVisible();
  });
});

test.describe("moves entered from one finding", () => {
  test("says which finding, in the audit's own words", async ({ page }) => {
    await page.goto(FROM_CONCLUSION);

    const context = page.getByTestId("moves-context");
    await expect(context).toBeVisible();
    await expect(context).toContainText("From your audit");
    await expect(context).toContainText(PAYMENT);
    await expect(context).toContainText("2 ways Vibe can help");
  });

  test("elevates only the moves that address it", async ({ page }) => {
    await page.goto(FROM_CONCLUSION);

    // Everything above "Your other moves" is the contextual group.
    const heading = page.getByRole("heading", { name: "Your other moves" });
    await expect(heading).toBeVisible();

    const first = page.getByTestId("move-card").first();
    await expect(first).toContainText("Decide how customers pay");
  });

  /** §44: elevation is not reranking. The numbers are the engine's. */
  test("keeps every move's persisted rank", async ({ page }) => {
    await page.goto(FROM_CONCLUSION);

    const cards = page.getByTestId("move-card");
    // Contextual group first: ranks 1 and 2. Then the rest: 3 and 4. No card is
    // renumbered by having been elevated.
    await expect(cards.nth(0)).toHaveAttribute("data-rank", "1");
    await expect(cards.nth(1)).toHaveAttribute("data-rank", "2");
    await expect(cards.nth(2)).toHaveAttribute("data-rank", "3");
    await expect(cards.nth(3)).toHaveAttribute("data-rank", "4");
  });

  test("keeps the whole list reachable", async ({ page }) => {
    await page.goto(FROM_CONCLUSION);

    await expect(page.getByTestId("move-card")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "See all next moves" })).toBeVisible();
  });

  /** §31: a malformed key is not an error page, it is the ordinary page. */
  test("falls back to the plain ranked list for an unusable context", async ({ page }) => {
    await page.goto(BAD_CONTEXT);

    await expect(page.getByTestId("moves-context")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your other moves" })).toHaveCount(0);
    await expect(page.getByTestId("move-card")).toHaveCount(4);
    await expect(page.getByTestId("move-card").first()).toHaveAttribute("data-rank", "1");
  });
});

test.describe("the default moves list", () => {
  test("shows the whole ranked list with no context required", async ({ page }) => {
    await page.goto(RANKED);

    await expect(page.getByTestId("moves-context")).toHaveCount(0);
    await expect(page.getByTestId("move-card")).toHaveCount(4);
    await expect(page.getByTestId("move-card").first()).toHaveAttribute("data-rank", "1");
    await expect(page.getByText("Best next move")).toHaveCount(1);
  });

  test("says which finding each move answers", async ({ page }) => {
    await page.goto(RANKED);

    const lineage = page.getByTestId("move-lineage");
    await expect(lineage.first()).toContainText("From your audit");
    await expect(lineage.first()).toContainText(PAYMENT);
    // Three of the four cite a conclusion; the legacy one claims no source
    // rather than being given a plausible-looking one.
    await expect(lineage).toHaveCount(3);
  });

  /**
   * §83 extension: every card, not only rank 1, can be the one a founder
   * plans — proven by a real, clickable link rather than by the domain
   * function it is built from.
   */
  test("every card offers to plan that specific Move", async ({ page }) => {
    await page.goto(RANKED);

    const cards = page.getByTestId("move-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(1);

    for (let index = 0; index < count; index++) {
      const link = cards.nth(index).getByRole("link", { name: "Plan this Move" });
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      expect(href).toMatch(/\/app\/projects\/project_e2e\/plan\?plan=.+#plan-this-move$/);
    }
  });
});

test.describe("a move card says one thing at a time", () => {
  /** §13: the chip soup, gone. Readiness and impact only. */
  test("shows readiness and impact, and not the rest", async ({ page }) => {
    await page.goto(RANKED);
    const card = page.getByTestId("move-card").first();

    await expect(card).toContainText("Needs your input");
    await expect(card).toContainText("High impact");

    // Effort and confidence are still on the card and no longer *visible* on
    // it — demoted behind the disclosure rather than deleted (§17).
    await expect(card.getByText("Medium effort")).not.toBeVisible();
    await expect(card.getByText("High confidence")).not.toBeVisible();

    // The business dimension chip is gone entirely: it competed with the audit
    // lineage for the same job, and the lineage answers it better (§14).
    await expect(card).not.toContainText("Monetization");
  });

  /** §17: demoted, not deleted. */
  test("keeps effort and confidence under Why now?", async ({ page }) => {
    await page.goto(RANKED);
    const card = page.getByTestId("move-card").first();

    await card.getByText("Why now?").click();
    await expect(card).toContainText("Medium effort");
    await expect(card).toContainText("High confidence");
  });

  test("Why now? is operable by keyboard alone", async ({ page }) => {
    await page.goto(RANKED);
    const summary = page.getByTestId("move-card").first().getByText("Why now?");

    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("move-card").first()).toContainText("Medium effort");
  });

  /** §18: an ordering constraint must not be discovered by pressing a button. */
  test("states a dependency before anything is pressed", async ({ page }) => {
    await page.goto(RANKED);

    const dependency = page.getByTestId("move-dependencies").first();
    await expect(dependency).toBeVisible();
    await expect(dependency).toContainText("Do this after: Decide how customers pay");
  });
});

test.describe("readiness decides what is offered", () => {
  /** §15, §16, §35: exactly one card may offer a write, and it is the ready one. */
  test("offers preparation only where an executor exists", async ({ page }) => {
    await page.goto(RANKED);

    const prepare = page.getByRole("button", { name: "Let Vibe prepare this" });
    await expect(prepare).toHaveCount(1);

    const card = page.getByTestId("move-card").filter({ hasText: "Add a pricing surface" });
    await expect(card.getByRole("button", { name: "Let Vibe prepare this" })).toBeVisible();
  });

  test("gives a needs-your-input move no execution button", async ({ page }) => {
    await page.goto(RANKED);

    const card = page
      .getByTestId("move-card")
      .filter({ has: page.getByRole("heading", { name: "Decide how customers pay" }) });
    await expect(card).toContainText("Needs your input");
    await expect(card.getByRole("button", { name: "Let Vibe prepare this" })).toHaveCount(0);
  });

  /** The praise-worthy behaviour this sprint had to preserve. */
  test("never offers to do work Vibe cannot do", async ({ page }) => {
    await page.goto(RANKED);

    const card = page.getByTestId("move-card").filter({ hasText: "Talk to ten people" });
    await expect(card).toContainText("Not automated yet");
    await expect(card.getByRole("button", { name: "Let Vibe prepare this" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Let Vibe/ })).toHaveCount(0);
  });
});

test.describe("preparing leads to the prepared change", () => {
  /** §26, §46: the exact change, by id — never "the newest one". */
  test("links onward to the change that was prepared", async ({ page }) => {
    await page.goto(RANKED);

    const link = page.getByTestId("review-prepared-change");
    await expect(link).toBeVisible();
    await expect(link).toHaveText("Review prepared change");
    await expect(link).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/agent#prepared-change-prepared_change_e2e",
    );
  });

  test("still says what a prepared change is not", async ({ page }) => {
    await page.goto(RANKED);

    const card = page.getByTestId("move-card").filter({ hasText: "Say who the product is for" });
    await expect(card).toContainText("Not merged · Not deployed · Not runtime-tested");
  });

  test("the prepared card is addressable by that exact fragment", async ({ page }) => {
    await page.goto("/e2e/merge_ready");

    const cards = page.getByTestId("prepared-change");
    await expect(cards.first()).toBeVisible();

    const id = await cards.first().getAttribute("data-prepared-change-id");
    expect(id).toBeTruthy();
    await expect(cards.first()).toHaveAttribute("id", `prepared-change-${id}`);
  });
});

test.describe("the empty states each have a next step", () => {
  test("no moves generated yet offers to find them", async ({ page }) => {
    await page.goto("/e2e/moves_none");

    await expect(page.getByRole("button", { name: "Find my next moves" })).toBeEnabled();
    await expect(page.getByTestId("move-card")).toHaveCount(0);
  });

  test("a blocked set explains itself and links out", async ({ page }) => {
    await page.goto("/e2e/moves_blocked");

    await expect(page.getByText("Why this is blocked")).toBeVisible();
    await expect(page.getByRole("link")).toHaveCount(1);
    // No offer to generate from a diagnosis that does not exist.
    await expect(page.getByRole("button", { name: "Find my next moves" })).toHaveCount(0);
  });

  test("a stale set says so without deleting anything", async ({ page }) => {
    await page.goto("/e2e/moves_stale");

    await expect(page.getByText("New business evidence is available")).toBeVisible();
    await expect(page.getByTestId("move-card")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Refresh my next moves" })).toBeEnabled();
  });
});

test.describe("no implementation language reaches the founder", () => {
  for (const [name, path] of [
    ["ranked", RANKED],
    ["contextual", FROM_CONCLUSION],
  ] as const) {
    test(`${name} moves speak business, not schema`, async ({ page }) => {
      await page.goto(path);

      const body = page.locator("body");
      for (const jargon of [
        "sourceConclusionKey",
        "executionType",
        "executionReadiness",
        "PreparedChange",
        "opportunity set",
        "the engine's",
        "as produced",
      ]) {
        await expect(body, jargon).not.toContainText(jargon);
      }
    });
  }
});

test.describe("the loop survives a phone", () => {
  for (const [name, path] of [
    ["ranked", RANKED],
    ["contextual", FROM_CONCLUSION],
  ] as const) {
    test(`${name} moves do not scroll sideways at 390px`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(path);

      await expect(page.getByTestId("move-card").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("the contextual header wraps a long finding cleanly", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(FROM_CONCLUSION);

    await expect(page.getByTestId("moves-context")).toContainText(PAYMENT);
    await expectNoHorizontalOverflow(page);
  });

  test("the audit handoff is reachable at 1440", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/e2e/audit-synthesis");

    await expect(
      page.getByTestId("current-priorities").getByRole("link", { name: "View 2 next moves" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
