import { expect, test, type Page } from "@playwright/test";

/** The checklist starts collapsed; the same helper `action-plan-ui.spec.ts` uses. */
async function openFullPlannedWork(page: Page) {
  const disclosure = page.getByText("See the full planned work", { exact: false });
  if (await disclosure.isVisible()) await disclosure.click();
}

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

    // The classic control: on the block it copies, not a second full-width
    // button competing with the action that advances the plan.
    const copy = page.getByTestId("handoff-copy");
    await expect(copy).toBeVisible();
    await expect(copy).toHaveAccessibleName("Copy prompt");
    expect(await copy.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
  });

  test("shows the step once, not twice", async ({ page }) => {
    /*
     * The confirmation used to be the whole `FounderActionCard`, nested inside
     * this one — so the same step drew two bordered panels, each with its own
     * status pill and its own copy of the title and description, saying two
     * different things about itself (ADR 0096).
     */
    await page.goto("/e2e/action_plan_handoff_prompt");

    await expect(
      page.getByRole("heading", { name: "Build a dedicated pricing page" }),
    ).toHaveCount(1);
    await expect(page.getByText("Vibe won't build this one")).toHaveCount(1);
    await expect(page.getByText("Vibe can't run this one")).toHaveCount(0);

    // And the sentence that would be false here: this step *is* a change to
    // the product. Vibe declined it; that is a different claim.
    await expect(page.getByText("isn't a change to your product")).toHaveCount(0);
  });

  test("carries what the founder already worked out into the prompt", async ({ page }) => {
    // Vibe holds the finding from step 1. A handoff that dropped it would send
    // the founder's own tool to rediscover it.
    await page.goto("/e2e/action_plan_handoff_prompt");

    const prompt = page.getByTestId("handoff-prompt");
    await expect(prompt).toContainText("Stripe is wired but the route 404s.");
    await expect(prompt).toContainText("context, not");
  });

  test("carries the decision the plan already settled", async ({ page }) => {
    /*
     * The defect the founder reported off a real prompt: it said "using the
     * confirmed plan structure" and did not carry it. A decision lives only in
     * Vibe's database, so the receiving tool had no way to reach it — the
     * sentence read as though the information had been supplied.
     *
     * Asserted in the browser rather than only against the compiler, because
     * what was broken was the wiring: the value was loaded, and nothing passed
     * it on.
     */
    await page.goto("/e2e/action_plan_handoff_midplan");

    await expect(page.getByTestId("handoff-prompt")).toContainText(
      "Prioritize small product teams.",
    );
  });

  test("tells the tool where this task stops", async ({ page }) => {
    // A step with no stated edge lets an agent work until its context runs out.
    // Vibe does not invent the edge: the plan's later steps are the edge.
    await page.goto("/e2e/action_plan_handoff_midplan");

    const prompt = page.getByTestId("handoff-prompt");
    await expect(prompt).toContainText("NOT THIS TASK");
    await expect(prompt).toContainText("Step 4 · Submit the sitemap to Search Console");
    await expect(prompt).toContainText("Step 6 · Build a dedicated pricing page");
  });

  test("states no edge when the handed-off step is the plan's last", async ({ page }) => {
    // The counter-case, so the block is a fact about the plan rather than
    // boilerplate every prompt carries.
    await page.goto("/e2e/action_plan_handoff_prompt");

    await expect(page.getByTestId("handoff-prompt")).not.toContainText("NOT THIS TASK");
  });

  test("ends by asking the tool to print the summary", async ({ page }) => {
    await page.goto("/e2e/action_plan_handoff_prompt");

    const prompt = page.getByTestId("handoff-prompt");
    await expect(prompt).toContainText("VIBE SUMMARY");
    await expect(prompt).toContainText("Left undone");
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
    /*
     * A paste, not an essay. The founder has just watched their tool do the
     * work; asking them to summarise it afterwards is homework for something
     * the machine already wrote down.
     */
    await expect(page.getByRole("button", { name: "Done — next step" })).toBeVisible();
    /*
     * The field names the artifact the prompt asked for, so the founder is
     * looking for one thing rather than composing one. Asserted against the
     * prompt block separately, because the same two words now appear in both
     * places and a loose match would pass on either alone.
     */
    await expect(page.getByText("Paste the VIBE SUMMARY here")).toBeVisible();
    await expect(page.getByTestId("handoff-prompt")).toContainText("VIBE SUMMARY");
    await expect(page.getByText("does not claim Vibe did the work")).toBeVisible();
  });

  test("says the criterion once, because the prompt already carries it", async ({ page }) => {
    await page.goto("/e2e/action_plan_handoff_prompt");
    await expect(page.getByTestId("handoff-prompt")).toBeVisible();

    /*
     * The prompt Vibe just wrote ends with `DONE WHEN: <criterion>`, and the
     * attestation form used to print the same sentence again under "Answer
     * this" — one screen, one sentence, twice, the second time under a heading
     * asking the founder to do what the prompt had already asked their tool.
     * Counted in the rendered text rather than by locator, because the point is
     * how many times a person reads it.
     */
    const criterion = "A pricing page exists at a public URL.";
    const shown = await page.evaluate(
      (text) => document.body.innerText.split(text).length - 1,
      criterion,
    );

    expect(shown).toBe(1);
    await expect(page.getByText("Answer this")).toHaveCount(0);
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

  test("moves the plan on once the founder says their tool built it", async ({ page }) => {
    /*
     * The end of the loop the founder asked for. Recording the finding is a
     * durable attestation, so the handed-off step is finished and the plan's
     * entry point is somewhere else — no prompt, no "answer this", nothing
     * still asking to be built.
     *
     * The seam under this is what broke twice: the routing set decides whether
     * the *next* step may start, and it did not know handoffs existed. This
     * scene sees the plan's answer; `completion-call-sites.test.ts` pins the
     * calls that produce it.
     */
    await page.goto("/e2e/action_plan_handoff_done");

    await expect(page.getByTestId("handoff-prompt")).toHaveCount(0);
    await expect(page.getByText("Vibe won't build this one")).toHaveCount(0);
    await expect(page.getByTestId("attestation-finding")).toHaveCount(0);

    // The step is on the checklist as done rather than gone.
    await openFullPlannedWork(page);
    const row = page
      .getByTestId("plan-step")
      .filter({ hasText: "Build a dedicated pricing page" })
      .first();
    await expect(row).not.toContainText("Start here");
  });
});
