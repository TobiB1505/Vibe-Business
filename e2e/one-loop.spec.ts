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
    await expect(context).toContainText("2 moves address this");
  });

  test("keeps the finding as context without replacing priority order", async ({ page }) => {
    await page.goto(FROM_CONCLUSION);

    await expect(page.getByTestId("move-step")).toHaveCount(4);
    await expect(page.getByTestId("move-card")).toHaveCount(1);
    await expect(page.getByTestId("move-card")).toContainText("Decide how customers pay");
  });

  /** The stepper visualizes persisted rank and never renumbers context. */
  test("keeps every move's persisted rank", async ({ page }) => {
    await page.goto(FROM_CONCLUSION);

    const steps = page.getByTestId("move-step");
    await expect(steps.nth(0)).toHaveAttribute("data-rank", "1");
    await expect(steps.nth(1)).toHaveAttribute("data-rank", "2");
    await expect(steps.nth(2)).toHaveAttribute("data-rank", "3");
    await expect(steps.nth(3)).toHaveAttribute("data-rank", "4");
  });

  test("keeps the whole list reachable", async ({ page }) => {
    await page.goto(FROM_CONCLUSION);

    await expect(page.getByTestId("move-step")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "See the full priority order" })).toBeVisible();
  });

  /** §31: a malformed key is not an error page, it is the ordinary page. */
  test("falls back to the plain ranked list for an unusable context", async ({ page }) => {
    await page.goto(BAD_CONTEXT);

    await expect(page.getByTestId("moves-context")).toHaveCount(0);
    await expect(page.getByTestId("move-step")).toHaveCount(4);
    await expect(page.getByTestId("move-card")).toHaveCount(1);
    await expect(page.getByTestId("move-card")).toHaveAttribute("data-rank", "1");
  });
});

test.describe("the single-Move priority navigator", () => {
  test("shows the full order but only one active Move", async ({ page }) => {
    await page.goto(RANKED);

    await expect(page.getByTestId("moves-context")).toHaveCount(0);
    await expect(page.getByTestId("move-step")).toHaveCount(4);
    await expect(page.getByTestId("move-card")).toHaveCount(1);
    await expect(page.getByTestId("move-card")).toHaveAttribute("data-rank", "1");
    await expect(page.getByText("Now", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Next", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Later", { exact: true })).toHaveCount(2);
  });

  test("switches Move and details without route navigation", async ({ page }) => {
    await page.goto(RANKED);

    const navigationCount = await page.evaluate(
      () => performance.getEntriesByType("navigation").length,
    );
    await page.getByRole("tab", { name: /Add a pricing surface people can reach/ }).click();

    await expect(page.getByTestId("move-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Add a pricing surface people can reach" })).toBeVisible();
    await expect(page).toHaveURL(/\?plan=move-pricing-page$/);
    await expect(page.getByText("A decision nobody can see", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(
      navigationCount,
    );
  });

  test("supports arrow-key selection and browser history", async ({ page }) => {
    await page.goto(RANKED);

    const first = page.getByRole("tab", { name: /Decide how customers pay/ });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { name: "Add a pricing surface people can reach" })).toBeVisible();
    await page.getByRole("tab", { name: /Say who the product is for/ }).click();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Add a pricing surface people can reach" })).toBeVisible();
  });

  test("changes selection immediately when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(RANKED);
    await page.getByRole("tab", { name: /Add a pricing surface people can reach/ }).click();

    await expect(
      page.getByRole("heading", { name: "Add a pricing surface people can reach" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((animation) => animation.playState === "running").length,
        ),
      )
      .toBe(0);
  });
});

test.describe("a move card says one thing at a time", () => {
  test("shows readiness and impact, and not the rest", async ({ page }) => {
    await page.goto(RANKED);
    const card = page.getByTestId("move-card");

    await expect(card).toContainText("Needs your input");
    await expect(card).toContainText("High impact");
    await expect(card.getByText("High confidence")).not.toBeVisible();
    await expect(card.getByText("Medium effort")).toBeVisible();
  });

  test("states a dependency before anything is pressed", async ({ page }) => {
    await page.goto(RANKED);
    await page.getByRole("tab", { name: /Add a pricing surface people can reach/ }).click();

    const dependency = page.getByTestId("move-dependencies");
    await expect(dependency).toBeVisible();
    await expect(dependency).toContainText("Do this after: Decide how customers pay");
  });
});

test.describe("readiness decides what is offered", () => {
  test("offers one primary action only for the active executable Move", async ({ page }) => {
    await page.goto(RANKED);
    await expect(page.getByRole("button", { name: "Start with Vibe" })).toHaveCount(0);
    await page.getByRole("tab", { name: /Add a pricing surface people can reach/ }).click();
    await expect(page.getByRole("button", { name: "Start with Vibe" })).toHaveCount(1);
    await expect(page.getByTestId("move-card").getByRole("button")).toHaveCount(0);
  });

  test("gives a needs-your-input move no execution button", async ({ page }) => {
    await page.goto(RANKED);
    const card = page.getByTestId("move-card");
    await expect(card).toContainText("Needs your input");
    await expect(page.getByRole("button", { name: "Start with Vibe" })).toHaveCount(0);
  });

  test("never offers to do work Vibe cannot do", async ({ page }) => {
    await page.goto(RANKED);
    await page.getByRole("tab", { name: /Talk to ten people/ }).click();
    const card = page.getByTestId("move-card");
    await expect(card).toContainText("Not automated yet");
    await expect(page.getByRole("button", { name: /Start with Vibe|Let Vibe/ })).toHaveCount(0);
  });
});

test.describe("preparing leads to the prepared change", () => {
  test("links onward to the change that was prepared", async ({ page }) => {
    await page.goto(RANKED);
    await page.getByRole("tab", { name: /Say who the product is for/ }).click();

    const link = page.getByTestId("review-prepared-change");
    await expect(link).toBeVisible();
    await expect(link).toHaveText("Review prepared change");
    await expect(link).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/agent?plan=move-audience-copy&change=prepared_change_e2e#prepared-change-prepared_change_e2e",
    );
  });

  test("still says what a prepared change is not", async ({ page }) => {
    await page.goto(RANKED);
    await page.getByRole("tab", { name: /Say who the product is for/ }).click();
    await expect(page.getByTestId("planned-work")).toContainText(
      "Not merged · Not deployed · Not runtime-tested",
    );
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
    await expect(page.getByTestId("move-step")).toHaveCount(4);
    await expect(page.getByTestId("move-card")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Re-scan business" })).toBeEnabled();
  });
});

test.describe("the plan forms before the first move exists", () => {
  test("reserves the full workspace and reports real named stages", async ({ page }) => {
    await page.goto("/e2e/moves_generating");

    await expect(page.getByTestId("plan-generating")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Generating your Action Plan" })).toBeVisible();
    await expect(page.getByText("Finding high-impact opportunities")).toBeVisible();
    await expect(page.getByTestId("move-stepper")).toHaveCount(0);

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\d+%/);
    expect(body).not.toMatch(/step \d+ of \d+/i);
  });

  test.describe("with reduced motion", () => {
    test("keeps the same information without looping animation", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/e2e/moves_generating");

      await expect(page.getByRole("heading", { name: "Generating your Action Plan" })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length))
        .toBe(0);
    });
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

  test("swipes between Moves while keeping details below", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(RANKED);

    const active = page.getByTestId("active-move");
    const box = await active.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.45, { steps: 8 });
    await page.mouse.up();

    await expect(
      page.getByRole("heading", { name: "Add a pricing surface people can reach" }),
    ).toBeVisible();
    await expect(page.getByText("A decision nobody can see", { exact: false })).toBeVisible();
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

/**
 * The last leg: Move → Agent → back (UI-S3).
 *
 * The seam these cover is the one a founder used to fall through. They picked
 * a Move, opened the Agent, and the Agent had never heard of it — so every
 * assertion here is about whether the Move a person chose is still the Move
 * the next screen is talking about.
 */
test.describe("the agent knows which Move the founder arrived with", () => {
  const FOCUS_TITLE = "Fix missing technical SEO foundations";

  test("names the Move and points back at it in the Action Plan", async ({ page }) => {
    await page.goto("/e2e/agent-focus-preparable");

    const focus = page.getByTestId("agent-focus");
    await expect(focus).toContainText(FOCUS_TITLE);
    // The engine's persisted rank, not this Move's position in a list of one.
    await expect(focus).toContainText("03");

    const back = focus.getByRole("link", { name: "Open this move in your Action Plan" });
    await expect(back).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/plan?plan=3-seo-fix-missing-technical-seo-foundations#planned-work",
    );
  });

  test("offers no way to spend anything from the agent card", async ({ page }) => {
    await page.goto("/e2e/agent-focus-preparable");

    // Starting the work is priced and confirmed beside the Move. This card
    // recognises and points back; it must never become a second checkout.
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("agent-focus")).not.toContainText("Credit");
  });

  test("leads to the exact prepared change once one exists", async ({ page }) => {
    await page.goto("/e2e/agent-focus-prepared");

    const focus = page.getByTestId("agent-focus");
    await expect(focus).toContainText(FOCUS_TITLE);
    await expect(focus.getByRole("link", { name: "Review the prepared change" })).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/agent#prepared-change-prepared_e2e",
    );
  });

  /** The regression the whole seam exists to prevent. */
  test("names no Move at all when the one asked for is not this project's", async ({ page }) => {
    await page.goto("/e2e/agent-focus-unresolved");

    await expect(page.getByTestId("agent-focus")).toHaveCount(0);
    // And it must not have quietly substituted the one Move it does have.
    await expect(page.getByText(FOCUS_TITLE)).toHaveCount(0);
    // The rest of the card is untouched: this is the ordinary Agent page.
    await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
  });

  test("a prepared change links back to the Move it answers", async ({ page }) => {
    await page.goto("/e2e/change_agentic_review_required");

    const card = page.getByTestId("prepared-change");
    const back = card.getByRole("link", { name: "Give the landing page a proper social preview" });
    await expect(back).toHaveAttribute(
      "href",
      /\/plan\?plan=[^"]+#planned-work$/,
    );
  });

  test("a deterministic change keeps its rationale and still links to its Move", async ({
    page,
  }) => {
    await page.goto("/e2e/merge_ready");

    const card = page.getByTestId("prepared-change");
    // One account of why, not two: the written rationale, plus a link.
    await expect(card).toContainText("Answers your move");
    await expect(card.getByRole("link", { name: "Fix missing technical SEO foundations" })).toHaveAttribute(
      "href",
      "/app/projects/project_e2e/plan?plan=3-seo-fix-missing-technical-seo-foundations#planned-work",
    );
  });

  test("the focused agent card does not scroll sideways at 390px", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/e2e/agent-focus-preparable");

    await expect(page.getByTestId("agent-focus")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
