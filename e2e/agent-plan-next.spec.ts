import { expect, test } from "@playwright/test";

/**
 * "This Move's next step is not one Vibe can run" — in a real browser.
 *
 * ## Why this suite exists
 *
 * The founder's own screenshot. The Agent screen said *"Vibe understands your
 * product, code and goals"* over *"This Move is selected, but an Agent run is
 * not currently available for it"* and then nothing at all — no step named, no
 * reason, no way on. Every unit test around it passed, because what was wrong
 * was a screen with nothing on it, and only a rendered DOM can say whether a
 * founder is told what to do next.
 *
 * The distinction the two scenes pin down is the whole value of the notice: a
 * step the founder can clear themselves is one click away, and a step waiting
 * on somebody else is not. Getting that word wrong sends a stuck founder to a
 * screen where there is nothing for them to do.
 */

test.describe("a Move whose next step Vibe cannot run", () => {
  test("names the step, the reason, and the way on", async ({ page }) => {
    await page.goto("/e2e/agent-plan-next-confirm");

    const notice = page.getByTestId("agent-plan-next");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Step 01");
    await expect(notice).toContainText("Establish what the existing billing route actually does");
    await expect(notice).toContainText("nothing for Vibe to build");
  });

  test("offers the confirmation when the founder can give it", async ({ page }) => {
    await page.goto("/e2e/agent-plan-next-confirm");

    const link = page.getByTestId("agent-plan-next-link");
    await expect(link).toHaveText("Confirm it on your Action Plan");
    await expect(link).toHaveAttribute("href", /\/plan$/);
    await expect(page.getByTestId("agent-plan-next")).toContainText("costs nothing");
  });

  test("does not offer it when the step is somebody else's", async ({ page }) => {
    // The failure this exists to prevent is a true sentence shown to the wrong
    // founder: "confirm it" over a step only a decision can clear.
    await page.goto("/e2e/agent-plan-next-waiting");

    const notice = page.getByTestId("agent-plan-next");
    await expect(notice).toContainText("Only you can settle this");
    await expect(page.getByTestId("agent-plan-next-link")).toHaveText("Open your Action Plan");
    await expect(notice).not.toContainText("costs nothing");
  });

  test("promises no end to a refusal that has none", async ({ page }) => {
    /*
     * The production defect, pinned. A checkout build is Vibe's own part of the
     * Move and Vibe refuses it because it touches payments — so the two
     * sentences this notice shipped with were both false: nothing was earlier,
     * and nothing would become available. A founder read them and waited.
     */
    await page.goto("/e2e/agent-plan-next-refused");

    const notice = page.getByTestId("agent-plan-next");
    await expect(notice).toContainText("Vibe will not do this one");
    await expect(notice).toContainText("Nothing you change here will unlock it");

    for (const promise of ["becomes available", "comes first", "once that step is done"]) {
      await expect(notice).not.toContainText(promise);
    }
    await expect(page.getByTestId("agent-plan-next-link")).toHaveText("Choose a different Move");
  });

  test("starts nothing from here", async ({ page }) => {
    // The way on is a link to the screen that owns the step's completion
    // criterion. A control here would separate the click from the sentence it
    // claims is true.
    await page.goto("/e2e/agent-plan-next-confirm");

    await expect(page.getByTestId("agent-plan-next").locator("button")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
  });

  test("does not scroll sideways at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/e2e/agent-plan-next-confirm");
    await expect(page.getByTestId("agent-plan-next")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  /*
   * The defect a founder photographed, and the one the scenes above cannot see.
   *
   * Passed as `startAction`, this notice went through `AgentStartCta` — a
   * control treatment that clips its child to `rounded-full` under
   * `overflow-hidden` and sweeps a highlight across it. The notice rendered as
   * an ellipse with its own footnote cut in half, captioned by a lock line
   * about what Vibe checks "before starting". Nothing was starting.
   *
   * `AgentStartCta`'s own docblock already forbade it: "the sweep and the lock
   * line never wrap something that cannot actually start."
   */
  test("brings no start treatment with it onto the stage", async ({ page }) => {
    await page.goto("/e2e/agent-stage-notice");

    const notice = page.getByTestId("agent-plan-next");
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("agent-start")).toHaveCount(0);
    await expect(page.getByText("before starting")).toHaveCount(0);

    // Not clipped: the whole footnote is on screen, not an ellipse's worth.
    await expect(notice).toContainText("Nothing you change here will unlock it");
    const clipped = await notice.evaluate((el) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.overflow === "hidden" && parseFloat(s.borderTopLeftRadius) > 100) return true;
      }
      return false;
    });
    expect(clipped).toBe(false);
  });
});
