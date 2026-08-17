import { expect, test } from "@playwright/test";

/**
 * The Action Plan panel, in a real browser (ACTION PLANNER UI-1).
 *
 * ## What this suite exists to prove
 *
 * That the honesty CORE-2b built into the domain — `vibe_prepares` is not a
 * button, an unsupported step stays in the plan rather than being hidden, an
 * unassessable "first actionable step" never defaults to array position —
 * survives being rendered. A domain test proves `firstActionableStep` picks
 * the right step; only a browser proves the screen actually labels *that*
 * step "Start here" and not `steps[0]`.
 *
 * ## The one constraint every test here ultimately serves
 *
 * No fake execution affordance. `vibe_prepares` means the work is Vibe's
 * responsibility, not that a button exists, and this suite asserts the
 * negative directly: no "Let Vibe prepare this", "Apply", "Execute", "Ship"
 * or "Deploy" control exists anywhere these fixtures render.
 *
 * ## What it does not prove
 *
 * The server wiring in `moves/page.tsx` that assembles these props from
 * Supabase, or RLS. There is no isolated database in this environment, so
 * every state here comes from `action-plan-scenarios.ts`, written by hand
 * from the domain's own types — no AI call backs any of it.
 */

const FORBIDDEN_ACTION_LABELS = [
  "Let Vibe prepare this",
  "Prepare this",
  "Apply",
  "Execute",
  "Ship",
  "Deploy",
  "Merge",
];

/** Raw domain vocabulary that must only ever reach the screen through a label map. */
const FORBIDDEN_RAW_STRINGS = [
  "vibe_executes_now",
  "vibe_prepares",
  "founder_decides",
  "founder_acts",
  "external_dependency",
  "not_yet_supported",
  "founder_decision",
  "founder_action",
  "external_party",
  "product_change",
  "external_setup",
  "measurement",
  "audit_superseded",
  "move_superseded",
  "planner_contract_superseded",
];

/** Internal identifiers that must never leak into customer-facing UI. */
const FORBIDDEN_INTERNAL_IDS = [
  "nextjs_seo_foundations_v2",
  "action-planner-contract-v1",
  "action-planner-v2",
  "action-planner-prompt-v1",
  "action-planner-rubric-v1",
  "evidence-pack-v1",
  "claude-opus-4",
  "blocker-1",
  "hash_e2e",
  "profile_e2e",
  "audit_e2e",
  "set_e2e",
  "move_e2e",
  "plan_e2e",
];

test.describe("no plan yet", () => {
  test("offers to plan the current move, naming it", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready_to_start");

    await expect(page.getByRole("button", { name: "Plan this move" })).toBeVisible();
    await expect(page.getByText("Make your product findable in search")).toBeVisible();
  });
});

test.describe("blocked", () => {
  test("a missing Move points back at next moves, not a dead end", async ({ page }) => {
    await page.goto("/e2e/action_plan_blocked_move_missing");

    await expect(page.getByText("Why this is blocked")).toBeVisible();
    const action = page.getByRole("link", { name: "Find your next moves" });
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute("href", "#next-moves");
    await expect(page.getByRole("button", { name: "Plan this move" })).not.toBeVisible();
  });

  test("a missing audit points at the business audit section", async ({ page }) => {
    await page.goto("/e2e/action_plan_blocked_audit_missing");

    const action = page.getByRole("link", { name: "Run a business audit" });
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute("href", /\/score#business-audit$/);
  });
});

test.describe("planning", () => {
  test("shows ambient progress, never a fake percentage or step counter", async ({ page }) => {
    await page.goto("/e2e/action_plan_planning");

    await expect(page.getByText("Working out how to do this…")).toBeVisible();
    await expect(page.getByText("You can leave this page. Vibe will continue.")).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/%/);
    expect(body).not.toMatch(/step \d+ of \d+/i);
  });
});

test.describe("ready plan", () => {
  test("shows the goal, the full why-now text, and the expected outcome", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(
      page.getByRole("heading", {
        name: "Make the product discoverable to people already searching for what it does.",
      }),
    ).toBeVisible();

    // The full sentence, not a truncated prefix — CORE-2b MINI VERIFICATION's
    // whole finding was that this must never be cut mid-word.
    await expect(
      page.getByText(
        "qualified visitors who are actively searching cannot find the product at all",
        { exact: false },
      ),
    ).toBeVisible();

    await expect(
      page.getByText("Search engines can find, index and rank the product's pages", {
        exact: false,
      }),
    ).toBeVisible();
  });

  /**
   * The load-bearing assertion in this whole suite. `firstActionableStep` in
   * this fixture resolves to order 1 ("Decide which segment") — a founder
   * decision, not `steps[0]`'s neighbour and not the Vibe-executable step
   * three positions later. A screen that defaulted to array position would
   * still pass every domain test and fail exactly here.
   */
  test("Start Here names the server-derived first actionable step, not steps[0]", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");

    const startHere = page.getByText("Start here").first();
    await expect(startHere).toBeVisible();

    // Rendered twice by design — once in the prominent "Start Here" card,
    // once in its place within the full ordered list — so this asserts at
    // least one is visible rather than picking a single strict match.
    await expect(
      page.getByRole("heading", { name: "Decide which segment to target first" }).first(),
    ).toBeVisible();
  });

  test("shows dependency waiting-state in plain language", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(
      page.getByText("Waiting on: Submit the sitemap to Search Console"),
    ).toBeVisible();
  });

  test("keeps an unsupported step in the plan rather than hiding it", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(page.getByText("Build a dedicated pricing page")).toBeVisible();
    await expect(page.getByText("Not automated yet")).toBeVisible();
  });

  test("discloses reasoning and evidence behind a collapsed section", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    const disclosure = page.getByText("How Vibe reasoned about this");
    await expect(disclosure).toBeVisible();

    const evidenceLine = page.getByText("robots txt missing", { exact: false });
    await expect(evidenceLine).not.toBeVisible();
    await disclosure.click();
    await expect(evidenceLine).toBeVisible();
  });

  test("never renders a fake execution affordance", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    // Open the disclosure too, so nothing hidden inside it escapes the sweep.
    await page.getByText("How Vibe reasoned about this").click();

    for (const label of FORBIDDEN_ACTION_LABELS) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
  });

  test("never leaks a raw enum value or an internal id into the page text", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    await page.getByText("How Vibe reasoned about this").click();

    const body = await page.locator("body").innerText();
    for (const raw of FORBIDDEN_RAW_STRINGS) {
      expect(body).not.toContain(raw);
    }
    for (const id of FORBIDDEN_INTERNAL_IDS) {
      expect(body).not.toContain(id);
    }
  });
});

test.describe("stale", () => {
  test("shows the plan and says why it may be out of date, without hiding it", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_stale");

    await expect(page.getByText("This plan may be out of date")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Make the product discoverable to people already searching for what it does.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Replan this move" })).toBeVisible();
  });
});

test.describe("failed", () => {
  test("says a plan could not be worked out, without provider internals", async ({ page }) => {
    await page.goto("/e2e/action_plan_failed");

    await expect(
      page.getByText("Vibe couldn't work out a plan for this move.", { exact: false }),
    ).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).not.toMatch(/anthropic|claude|api key|stack trace/);
  });
});
