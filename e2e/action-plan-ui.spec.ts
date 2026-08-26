import { expect, type Page, test } from "@playwright/test";

/**
 * The Action Plan panel, in a real browser (ACTION PLANNER UI-1, density
 * pass UI-1.1).
 *
 * ## What this suite exists to prove
 *
 * That the honesty CORE-2b built into the domain — `vibe_prepares` is not a
 * button, an unsupported step stays in the plan rather than being hidden, an
 * unassessable "first actionable step" never defaults to array position —
 * survives being rendered, and survives being made scannable. A domain test
 * proves `firstActionableStep` picks the right step; only a browser proves
 * the screen actually labels *that* step "Start here" and not `steps[0]`.
 * UI-1.1 adds a second class of thing only a browser can prove: that
 * secondary detail is genuinely collapsed by default rather than merely
 * reordered, and that collapsing it did not quietly drop it.
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
 * The server wiring in `plan/page.tsx` that assembles these props from
 * Supabase, or RLS. There is no isolated database in this environment, so
 * every state here comes from `action-plan-scenarios.ts`, written by hand
 * from the domain's own types — no AI call backs any of it.
 */

const FORBIDDEN_ACTION_LABELS = [
  "Let Vibe prepare this",
  "Prepare this",
  "Prepare now",
  "Start preparation",
  "Apply",
  "Execute",
  "Ship",
  "Deploy",
  "Publish",
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

/** Forces every `<details>` open — the reveal-everything pass a leak sweep needs. */
async function expandEverything(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((element) => {
      (element as HTMLDetailsElement).open = true;
    });
  });
}

test.describe("no plan yet", () => {
  test("offers to plan the current move, naming it", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready_to_start");

    await expect(page.getByRole("button", { name: "Plan this move" })).toBeVisible();
    await expect(page.getByText("Make your product findable in search")).toBeVisible();
  });
});

test.describe("priority deviation (§83 extension)", () => {
  /**
   * A founder can now name a Move other than the engine's own rank 1. Vibe
   * still never makes that substitution itself — this is the one place it is
   * required to say so, or the deviation is invisible.
   */
  test("discloses when the selected Move is not the engine's own top priority", async ({ page }) => {
    await page.goto("/e2e/action_plan_priority_deviation");

    await expect(page.getByText("Planned out of priority order")).toBeVisible();
    await expect(
      page.getByText('Vibe\'s own top priority is currently "Make your product findable in search"', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByText("Add discoverability foundations", { exact: false })).toBeVisible();
  });

  test("shows no such notice for the engine's own default Move", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready_to_start");
    await expect(page.getByText("Planned out of priority order")).not.toBeVisible();
  });
});

test.describe("blocked", () => {
  test("a missing Move points back at next moves, not a dead end", async ({ page }) => {
    await page.goto("/e2e/action_plan_blocked_move_missing");

    await expect(page.getByText("Why this is blocked")).toBeVisible();
    const action = page.getByRole("link", { name: "Find your next moves" });
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute("href", "#action-plan");
    await expect(page.getByRole("button", { name: "Plan this move" })).not.toBeVisible();
  });

  test("a missing audit points at the business audit section", async ({ page }) => {
    await page.goto("/e2e/action_plan_blocked_audit_missing");

    const action = page.getByRole("link", { name: "Run a business audit" });
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute("href", /\/projects\/project_e2e#business-audit$/);
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

test.describe("ready plan — hero", () => {
  test("shows the goal, a progressive why-now, and the restrained meta line", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(
      page.getByRole("heading", {
        name: "Make the product discoverable to people already searching for what it does.",
      }),
    ).toBeVisible();

    // 6 steps in the fixture, 1 of them a founder decision.
    await expect(page.getByText("6 steps · 1 founder decision")).toBeVisible();

    await expect(page.getByRole("button", { name: "More context" }).first()).toBeVisible();
  });

  /**
   * §7: no destructive truncation, ever. The clamp is visual only — the full
   * sentence is already in the DOM before anything is clicked, and expanding
   * must not rewrite it into something shorter.
   */
  test("keeps the full why-now text intact through the expand toggle", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    const fullSentence =
      "qualified visitors who are actively searching cannot find the product at all";
    await expect(page.getByText(fullSentence, { exact: false })).toBeAttached();

    await page.getByRole("button", { name: "More context" }).first().click();
    await expect(page.getByText(fullSentence, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
  });

  test("shows the outcome reframed as the plan's destination", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(page.getByText("If this plan works")).toBeVisible();
    await expect(
      page.getByText("Search engines can find, index and rank the product's pages", {
        exact: false,
      }),
    ).toBeVisible();
  });
});

test.describe("ready plan — Start Here", () => {
  test("renders the recommendation-first founder decision with alternatives and custom input", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(
      page.getByRole("heading", {
        name: "Which customer segment should the business pursue first?",
      }),
    ).toBeVisible();
    await expect(page.getByText("Vibe recommends")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use Vibe's recommendation" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Small product teams" })).toBeVisible();

    await page.getByRole("button", { name: "Something else" }).click();
    await expect(page.getByLabel("Your answer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use this answer" })).toBeVisible();
  });

  /**
   * The load-bearing assertion in this whole suite. The fixture's order 1
   * ("Draft the search-facing copy") depends on order 2 ("Decide which
   * segment"), so the array's first element and the domain's actionable step
   * are deliberately different steps. A screen that quietly defaulted to
   * `steps[0]` would show the draft step here and would still pass every
   * domain-level test — only this assertion catches it.
   */
  test("names the server-derived first actionable step, not steps[0]", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    const startHere = page.getByText("Start here").first();
    await expect(startHere).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Decide which segment to target first" }).first(),
    ).toBeVisible();
  });

  /**
   * §38 — the duplication regression this whole pass exists to fix. The
   * Start Here card may repeat the step's title and one short sentence (its
   * `description`) — that much overlap with the timeline row is by design —
   * but it must never also render the step's full detail (`purpose`,
   * completion criteria) a second time outside that step's own collapsed
   * Details section.
   */
  test("does not duplicate the full step detail outside its own Details", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    // "Decide which segment" is Start Here. Its purpose sentence is real
    // detail that belongs only behind its own Details toggle.
    const purposeSentence = "Every later step depends on knowing who this is for";
    await expect(page.getByText(purposeSentence, { exact: false })).not.toBeVisible();
  });
});

test.describe("ready plan — founder action attestation", () => {
  test("asks for an explicit criterion-bound confirmation instead of a checkbox", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_founder_action");

    await expect(page.getByText("Your action").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Submit the sitemap to Search Console" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Confirm when true")).toBeVisible();
    await expect(
      page.getByText("The sitemap shows as submitted in Search Console").first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm this is complete" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
});

test.describe("ready plan — timeline", () => {
  test("shows every step title by default, with secondary detail collapsed", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    const titles = [
      "Draft the search-facing copy for that segment",
      "Decide which segment to target first",
      "Publish the missing robots.txt and sitemap",
      "Submit the sitemap to Search Console",
      "Wait for Google to index the new pages",
      "Build a dedicated pricing page",
    ];
    for (const title of titles) {
      await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
    }

    // Purpose text lives only inside each step's own collapsed Details.
    await expect(
      page.getByText("Registering the sitemap directly speeds up how quickly pages get indexed", {
        exact: false,
      }),
    ).not.toBeVisible();
  });

  test("expanding Details reveals why the step exists, done-when, and dependencies", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");

    // "Submit the sitemap to Search Console" — has a real dependency and no
    // approval, so this also proves empty sections (Approval) stay absent.
    //
    // Scoped by the step's own heading rather than `hasText`: a closed
    // `<details>` still has its content in the DOM (only CSS hides it), so a
    // plain text filter would also match whichever *other* row's hidden
    // "Depends on" section happens to cite this title.
    const row = page.locator("li").filter({
      has: page.getByRole("heading", { name: "Submit the sitemap to Search Console", exact: true }),
    });
    await row.getByText("Details").click();

    await expect(row.getByText("Why this step exists")).toBeVisible();
    await expect(
      row.getByText("Registering the sitemap directly speeds up how quickly pages get indexed", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(row.getByText("Done when")).toBeVisible();
    await expect(row.getByText("The sitemap shows as submitted in Search Console")).toBeVisible();
    await expect(row.getByText("Depends on")).toBeVisible();
    // Scoped to this row: the same text is also this dependency's own
    // (always-visible) step title elsewhere on the page, so an unscoped
    // locator would match twice.
    await expect(row.getByText("Publish the missing robots.txt and sitemap", { exact: true })).toBeVisible();
  });

  test("shows a blocked step's dependency in plain language without expanding it", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(
      page.getByText("Waiting for step 4: Submit the sitemap to Search Console"),
    ).toBeVisible();
  });

  test("shows Ready now for every unblocked step, including a founder decision", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");

    // "Decide which segment" (Start Here, a founder decision) and "Build a
    // dedicated pricing page" (also_ready, no dependencies) — the fixture's
    // two zero-dependency steps.
    await expect(page.getByText("Ready now")).toHaveCount(2);
  });

  test("distinguishes every responsibility without exposing an internal enum", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(page.getByText("Vibe can prepare this").first()).toBeVisible();
    await expect(page.getByText("Vibe can do this").first()).toBeVisible();
    await expect(page.getByText("Needs your decision").first()).toBeVisible();
    await expect(page.getByText("You'll need to do this").first()).toBeVisible();
    await expect(page.getByText("Depends on something else").first()).toBeVisible();
  });

  test("keeps an unsupported step in the plan, distinct from failure", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(page.getByText("Build a dedicated pricing page")).toBeVisible();
    await expect(page.getByText("Vibe's work").first()).toBeVisible();
    await expect(page.getByText("Not automated yet")).toBeVisible();
  });

  test("shows approval as secondary metadata inside Details, not a header pill", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");

    // The SEO step is the one fixture step that requires approval.
    const row = page.locator("li").filter({
      has: page.getByRole("heading", {
        name: "Publish the missing robots.txt and sitemap",
        exact: true,
      }),
    });
    await expect(row.getByText("Approval required")).not.toBeVisible();
    await row.getByText("Details").click();
    await expect(row.getByText("Approval required before Vibe acts on this.")).toBeVisible();
  });
});

test.describe("ready plan — reasoning disclosure", () => {
  test("discloses reasoning and evidence behind a collapsed section", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    // The label now carries the counted evidence behind the plan, so it is
    // matched by prefix rather than exactly.
    const disclosure = page.getByText("Why Vibe planned this", { exact: false });
    await expect(disclosure).toBeVisible();

    /*
     * The fixture step cites `live.seo.robots_txt_missing`, and this line has
     * now been re-pinned twice as the words underneath it improved.
     *
     * It first read "robots txt missing" — the raw id with its punctuation
     * removed. The polarity fix taught the labeller the `_missing` suffix and
     * it became "Seo robots txt — not observed", which is what this assertion
     * was moved to. Neither was a label anybody wrote; both were the id
     * showing through, and "Seo" is not a word.
     *
     * `live.seo.*` now resolves through `SEO_LABELS`, the table the live module
     * had already written for this exact audience. Pinning the real sentence
     * means the next such improvement has to be a deliberate change to a label
     * rather than a silent change to an identifier.
     */
    const evidenceLine = page.getByText("Instructions for search engines", { exact: false });
    await expect(evidenceLine).not.toBeVisible();
    await disclosure.click();
    await expect(evidenceLine).toBeVisible();
  });
});

test.describe("ready plan — regressions", () => {
  test("never renders a fake execution affordance", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    await expandEverything(page);

    for (const label of FORBIDDEN_ACTION_LABELS) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
  });

  test("never leaks a raw enum value or an internal id into the page text", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    await expandEverything(page);

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
