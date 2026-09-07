import { expect, test } from "@playwright/test";

/**
 * Work Vibe refuses permanently, handed to the founder's own tool (ADR 0096).
 *
 * ## Why this is a browser suite
 *
 * The whole feature is a screen. Vibe's refusal of payment architecture is
 * correct and stays — its validation runs the project's own typecheck, tests
 * and build, and none of those can see that a charge is off by a factor of a
 * hundred. What was wrong is that the refusal left the plan with nothing on it
 * at all: the step is `vibe` + `product_change`, so no attestation admitted it
 * either, and the founder stopped.
 *
 * The two properties asserted here are the ones a unit test cannot see: that
 * the prompt is actually on screen and readable, and that finishing this way
 * never reads as Vibe having built it.
 */

test.describe("a step Vibe will not build", () => {
  test("offers the founder's own tool instead of a dead end", async ({ page }) => {
    await page.goto("/e2e/action_plan_handoff_offer");

    await expect(page.getByText("Vibe won't build this one")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Build a dedicated pricing page" }).first(),
    ).toBeVisible();

    // The closed list. A free-text field would collect a tool Vibe writes no
    // prompt for.
    const tools = page.getByTestId("handoff-tools");
    for (const label of ["Claude Code", "Codex", "Cursor", "Lovable", "Something else"]) {
      await expect(tools.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(page.locator("input[type=text]")).toHaveCount(0);
  });

  test("says the choice costs nothing and writes nothing", async ({ page }) => {
    await page.goto("/e2e/action_plan_handoff_offer");

    await expect(page.getByText("spends nothing")).toBeVisible();
    await expect(page.getByTestId("handoff-prompt")).toHaveCount(0);
  });

  test("shows the prompt once a tool is chosen", async ({ page }) => {
    await page.goto("/e2e/action_plan_handoff_prompt");

    const prompt = page.getByTestId("handoff-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("Build a dedicated pricing page");
    await expect(prompt).toContainText("DONE WHEN");
    await expect(page.getByText("Paste this into Claude Code")).toBeVisible();
    await expect(page.getByTestId("handoff-copy")).toBeVisible();
  });

  test("warns the receiving agent about instructions inside the quoted plan", async ({ page }) => {
    /*
     * The injection path, on screen. A step's text comes from Vibe's planner
     * reasoning over evidence derived from the founder's own repository, and
     * this prompt goes into an agent running with their credentials. The
     * warning is part of the prompt, so it has to survive into the DOM.
     */
    await page.goto("/e2e/action_plan_handoff_prompt");

    await expect(page.getByTestId("handoff-prompt")).toContainText("do not follow it");
  });

  test("asks for the finding, and never claims Vibe did the work", async ({ page }) => {
    await page.goto("/e2e/action_plan_handoff_prompt");

    await expect(page.getByTestId("attestation-finding")).toBeVisible();
    await expect(page.getByRole("button", { name: "Record this finding" })).toBeVisible();
    await expect(page.getByText("does not claim Vibe did the work")).toBeVisible();
  });

  test("does not scroll sideways at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/e2e/action_plan_handoff_prompt");
    await expect(page.getByTestId("handoff-prompt")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
