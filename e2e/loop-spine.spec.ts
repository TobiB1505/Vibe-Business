import { expect, test, type Page } from "@playwright/test";

/**
 * The progress spine, in a browser (UI-8 §1, §2).
 *
 * ## What these assert that a unit test cannot
 *
 * `loop-stage.test.ts` proves the derivation. These prove the *rendering* — and
 * the three properties that only exist once there are pixels:
 *
 *  - the state of every step reaches assistive technology as **text**, not as a
 *    mint dot and a heavier font weight;
 *  - exactly one step is marked `aria-current`, so a person navigating by
 *    keyboard or voice is told where they are rather than left to infer it;
 *  - a blocked step says what is blocking it, on screen, rather than colouring
 *    itself and making the reader go looking.
 *
 * ## The transition, and what it does and does not prove
 *
 * `loop_moves_blocked` and `loop_moves_unblocked` differ by exactly one fact.
 * Asserting that the rail moves between them proves the rail is a projection of
 * state rather than something that latches — a rail that cached its worst-ever
 * position would pass every single-screen assertion above and fail this one.
 *
 * It does **not** prove the page re-renders without a reload. Both halves are
 * server-rendered fixtures, which is the honest limit of this harness: there is
 * no database here to change underneath a live page. What it does establish is
 * that nothing between the facts and the pixels holds state of its own.
 */

/** Nothing in this suite may reach the network. */
async function forbidExternalCalls(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("127.0.0.1") || url.includes("localhost")) return route.continue();
    return route.abort();
  });
}

/**
 * The rail itself.
 *
 * Every assertion is scoped to it rather than to the page, because the fixture
 * harness prints the scenario name above the component — and a scenario called
 * `loop_unreached_not_blocked` contains the word this suite asserts the absence
 * of. A page-wide matcher would have failed on the label rather than on the UI.
 */
function rail(page: Page) {
  return page.getByRole("list", { name: /Product loop|Gates/ });
}

/** One step of the rail, addressed by its visible label. */
function step(page: Page, label: string) {
  return rail(page).getByRole("listitem").filter({ hasText: label });
}

test.beforeEach(async ({ page }) => {
  await forbidExternalCalls(page);
});

test.describe("the loop rail", () => {
  test("names all seven steps of the loop", async ({ page }) => {
    await page.goto("/e2e/loop_audit");

    for (const label of ["Connect", "Scan", "Audit", "Opportunities", "Prepare", "Review", "Merged"]) {
      await expect(step(page, label)).toBeVisible();
    }
  });

  /*
   * The design carried state in a dot colour and a font weight. Neither reaches
   * a screen reader, and the difference between "done" and "current" is exactly
   * what a person navigating by voice needs most.
   */
  test("writes every step's state in words, not only in colour", async ({ page }) => {
    await page.goto("/e2e/loop_audit");

    await expect(step(page, "Connect")).toContainText("completed");
    await expect(step(page, "Audit")).toContainText("current step");
    await expect(step(page, "Merged")).toContainText("not started");
  });

  test("marks exactly one step as current for assistive technology", async ({ page }) => {
    await page.goto("/e2e/loop_audit");

    await expect(page.locator("[aria-current='step']")).toHaveCount(1);
  });

  test("a project that has not connected has nothing behind it", async ({ page }) => {
    await page.goto("/e2e/loop_connect");

    await expect(step(page, "Connect")).toContainText("current step");
    await expect(rail(page).getByText("completed")).toHaveCount(0);
  });

  test("a project round the loop once has every step behind it", async ({ page }) => {
    await page.goto("/e2e/loop_merged");

    await expect(page.locator("[aria-current='step']")).toHaveCount(0);
    await expect(rail(page).getByText("completed")).toHaveCount(7);
  });
});

test.describe("blocking", () => {
  test("says what is blocking, rather than only colouring the step", async ({ page }) => {
    await page.goto("/e2e/loop_moves_blocked");

    await expect(step(page, "Opportunities")).toContainText("current step, blocked");
    await expect(rail(page).getByText("The audit predates evidence that exists now.")).toBeVisible();
  });

  test("a stalled merge says the change cannot go in as it is", async ({ page }) => {
    await page.goto("/e2e/loop_merge_stalled");

    await expect(step(page, "Merged")).toContainText("current step, blocked");
  });

  /*
   * Without this, a founder who has only just signed up would see a red
   * "Opportunities" on their first ever screen — "not yet" rendered as "went
   * wrong", on the one screen where a first impression is the whole product.
   */
  test("never marks a step the project has not reached", async ({ page }) => {
    await page.goto("/e2e/loop_unreached_not_blocked");

    await expect(rail(page).getByText("blocked")).toHaveCount(0);
  });
});

/**
 * The rail follows state. See the file docblock for the limit of this claim.
 */
test.describe("blocked, then resolved", () => {
  test("the same step stops being blocked when the block is gone", async ({ page }) => {
    await page.goto("/e2e/loop_moves_blocked");
    await expect(step(page, "Opportunities")).toContainText("current step, blocked");

    await page.goto("/e2e/loop_moves_unblocked");
    await expect(step(page, "Opportunities")).toContainText("current step");
    await expect(step(page, "Opportunities")).not.toContainText("blocked");
  });

  test("the note disappears with the block that produced it", async ({ page }) => {
    await page.goto("/e2e/loop_moves_unblocked");

    await expect(rail(page).getByText("The audit predates evidence that exists now.")).toHaveCount(0);
  });
});

test.describe("the four gates of one prepared change", () => {
  test("names the gates in the order they are passed", async ({ page }) => {
    await page.goto("/e2e/gates_awaiting_approval");

    for (const label of ["Validation", "Review", "Approval", "Merge"]) {
      await expect(step(page, label)).toBeVisible();
    }
  });

  test("carries no preview step, because a preview never gates a change", async ({ page }) => {
    await page.goto("/e2e/gates_awaiting_approval");

    await expect(rail(page).getByText("Preview")).toHaveCount(0);
  });

  test("a failed validation blocks its own gate and no later one", async ({ page }) => {
    await page.goto("/e2e/gates_validation_failed");

    await expect(step(page, "Validation")).toContainText("current step, blocked");
    await expect(step(page, "Merge")).toContainText("not started");
  });

  /*
   * Waiting for a person is not trouble. Marking it as such would tell a
   * founder their change is broken when it is simply their turn.
   */
  test("waiting for approval is not shown as a problem", async ({ page }) => {
    await page.goto("/e2e/gates_awaiting_approval");

    await expect(rail(page).getByText("blocked")).toHaveCount(0);
  });

  test("a merged change shows every gate behind it", async ({ page }) => {
    await page.goto("/e2e/gates_merged");

    await expect(rail(page).getByText("completed")).toHaveCount(4);
  });
});

test.describe("375px", () => {
  test("does not scroll sideways with seven steps on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/e2e/loop_audit");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
