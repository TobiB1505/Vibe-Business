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

async function openFullPlannedWork(page: Page) {
  const disclosure = page.getByText("See the full planned work", { exact: false });
  if (await disclosure.isVisible()) await disclosure.click();
}

function plannedStep(page: Page, title: string) {
  return page.getByTestId("plan-step").filter({
    has: page.locator("summary").getByText(title, { exact: true }),
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

test.describe("ready plan — founder input focus", () => {
  test("makes the current founder question the panel's first answer", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    await expect(page.getByRole("heading", { name: "Vibe needs your input" })).toBeVisible();
    await expect(page.getByText("1 open question")).toBeVisible();

    await expect(page.getByText("See the full planned work · 6 steps · 1 founder decision")).toBeVisible();
  });

  /**
   * §7: no destructive truncation, ever. The clamp is visual only — the full
   * sentence is already in the DOM before anything is clicked, and expanding
   * must not rewrite it into something shorter.
   */
  test("keeps the full why-now text intact through the expand toggle", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    const fullSentence =
      "qualified visitors who are actively searching cannot find the product at all";
    // `.first()`: the move's why-now sentence is rendered in more than one place
    // on this screen. Which copy is asserted does not matter — the claim is that
    // the *full* sentence is in the DOM before anything is expanded.
    await expect(page.getByText(fullSentence, { exact: false }).first()).toBeAttached();

    await page.getByRole("button", { name: "More context" }).first().click();
    await expect(page.getByText(fullSentence, { exact: false }).first()).toBeVisible();
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
    await expect(page.getByText("Suggested by Vibe")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Independent founders/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /Small product teams/ })).toBeVisible();

    // The input is `sr-only` inside its own `<label>`, which is the accessible
    // custom-radio pattern: a person clicks the label, never the input. `.check()`
    // drives the input itself and is blocked by the label covering it, so this
    // clicks what a user clicks and then asserts the input actually became checked.
    const somethingElse = page.getByRole("radio", { name: /Something else/ });
    await somethingElse.scrollIntoViewIfNeeded();
    await page.locator("label").filter({ has: somethingElse }).click();
    await expect(somethingElse).toBeChecked();

    await expect(page.getByLabel("Your answer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
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
    await openFullPlannedWork(page);

    // Asserted on the row rather than as two independent text matches. The title
    // also appears in collapsed body copy elsewhere on the screen, so a bare
    // `getByText(...).first()` can resolve to a hidden paragraph — and, worse,
    // "Start here" being visible *somewhere* would pass even if it sat on the
    // wrong step, which is the exact defect this assertion exists to catch.
    const actionable = plannedStep(page, "Decide which segment to target first");
    await expect(actionable.locator("summary")).toContainText("Start here");

    for (const waiting of [
      "Draft the search-facing copy for that segment",
      "Submit the sitemap to Search Console",
    ]) {
      await expect(plannedStep(page, waiting).locator("summary")).not.toContainText("Start here");
    }
  });

  /**
   * §38 — the duplication regression this whole pass exists to fix. The
   * The active action may repeat the step's title and one short sentence, but
   * it must never also render the step's full detail (`purpose`, completion
   * criteria) outside that step's own collapsed checklist row.
   */
  test("does not duplicate full task detail outside its checklist row", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    // "Decide which segment" is Start Here. Its purpose sentence is real
    // detail that belongs only behind its own checklist disclosure.
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

    // Real-world work reports nothing: the sitemap is submitted or it is not,
    // and there is no finding to write down.
    await expect(page.getByTestId("attestation-finding")).toHaveCount(0);
  });
});

test.describe("ready plan — a step no execution can finish", () => {
  /*
   * The dead end a founder actually hit, asserted where it was visible and
   * nowhere else. Every unit test passed while this screen offered a step
   * marked "Start here" with nothing under it to start.
   */
  test("offers a confirmation, and does not call Vibe's work the founder's", async ({ page }) => {
    await page.goto("/e2e/action_plan_vibe_no_executor");

    await expect(
      page.getByRole("heading", { name: "Draft the search-facing copy for that segment" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Vibe can't run this one").first()).toBeVisible();
    await expect(page.getByText("isn't a change to your product").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Record this finding" })).toBeVisible();

    // The claim it must never make. The founder is confirming the step's own
    // completion criterion, not testifying that Vibe did the work.
    await expect(page.getByText("does not claim Vibe did the work").first()).toBeVisible();
    await expect(page.getByText("Your action")).toHaveCount(0);
  });

  /*
   * The founder's objection, pinned (ADR 0092). The step asks whether billing
   * is fully working, partially wired, or absent; a tick answers none of the
   * three, and its successors are written to depend on which. So the step is
   * closed with the answer, not with a boolean.
   */
  test("asks for the finding rather than a tick", async ({ page }) => {
    await page.goto("/e2e/action_plan_vibe_no_executor");

    const field = page.getByTestId("attestation-finding");
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("required", "");
    await expect(page.getByText("What did you find?")).toBeVisible();
    await expect(page.getByText("The next plan is written with this in front of it.")).toBeVisible();

    // No invented choices. The step's criterion is model-written prose and Vibe
    // never turns it into options — it is shown, and the founder answers it.
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    // The step's own criterion is shown beside the field — that is the
    // question the founder is answering, in the plan's words rather than
    // Vibe's.
    await expect(page.getByText("Answer this")).toBeVisible();
    await expect(
      page.getByText("A drafted set of titles and descriptions exists.").first(),
    ).toBeVisible();
  });
});

test.describe("ready plan — a step a run covered rather than did", () => {
  /*
   * The distinction ADR 0091 turns on, asserted where a founder reads it.
   * "Done" and "covered" are the same fact for sequencing and different facts
   * for the record, and only the rendered row can show that the product keeps
   * them apart.
   */
  test("names the run that covered it, and does not call it done", async ({ page }) => {
    await page.goto("/e2e/action_plan_absorbed_step");
    await openFullPlannedWork(page);

    // `.first()` because a later row names this step in its own "Depends on"
    // line; rows render in plan order, so the first match is step 01 itself.
    const row = page
      .getByTestId("plan-step")
      .filter({ hasText: "Draft the search-facing copy for that segment" })
      .first();

    await expect(row).toContainText("Covered by step 03");
    await expect(row).not.toContainText("Waiting");
    // Its number stays a number. The tick belongs to work somebody carried out.
    await expect(row).toContainText("01");
  });
});

test.describe("ready plan — compact checklist", () => {
  test("shows every task title while every checklist row starts closed", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    const titles = [
      "Draft the search-facing copy for that segment",
      "Decide which segment to target first",
      "Publish the missing robots.txt and sitemap",
      "Submit the sitemap to Search Console",
      "Wait for Google to index the new pages",
      "Build a dedicated pricing page",
    ];
    // Scoped to each row's own summary. Two of these titles also appear in
    // collapsed body copy elsewhere, where `getByText(...).first()` resolves to
    // a hidden paragraph — and a title that renders only there would satisfy a
    // loose match while being invisible in the checklist this test is about.
    for (const title of titles) {
      await expect(plannedStep(page, title).locator("summary")).toBeVisible();
    }

    await expect(page.getByTestId("planned-steps").locator("details[open]")).toHaveCount(0);

    // Purpose text lives only inside each step's closed checklist row.
    await expect(
      page.getByText("Registering the sitemap directly speeds up how quickly pages get indexed", {
        exact: false,
      }),
    ).not.toBeVisible();
  });

  test("expanding a task reveals description, ownership, done-when, and dependencies", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    // "Submit the sitemap to Search Console" — has a real dependency and no
    // approval, so this also proves empty sections (Approval) stay absent.
    //
    const row = plannedStep(page, "Submit the sitemap to Search Console");
    await row.locator("summary").click();

    await expect(
      row.getByText("Register the sitemap with Google Search Console once it is live."),
    ).toBeVisible();
    await expect(row.getByText("You'll need to do this")).toBeVisible();
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

  test("keeps blocked rows compact, then names the exact dependency when opened", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    const row = plannedStep(page, "Wait for Google to index the new pages");
    await expect(row.getByText("Waiting", { exact: true })).toBeVisible();
    await expect(
      row.getByText("Waiting for step 4: Submit the sitemap to Search Console"),
    ).not.toBeVisible();
    await row.locator("summary").click();
    await expect(
      row.getByText("Waiting for step 4: Submit the sitemap to Search Console"),
    ).toBeVisible();
  });

  test("distinguishes the primary task from another task that is also ready", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    // The primary task uses Start here; the other unblocked task remains Ready now.
    await expect(page.getByText("Start here").first()).toBeVisible();
    await expect(
      page.getByTestId("planned-steps").locator("summary").getByText("Ready now", { exact: true }),
    ).toHaveCount(1);
  });

  test("distinguishes every responsibility without exposing an internal enum", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    const rows = page.getByTestId("plan-step");
    for (let index = 0; index < (await rows.count()); index += 1) {
      await rows.nth(index).locator("summary").click();
    }

    await expect(page.getByText("Vibe can prepare this").first()).toBeVisible();
    await expect(page.getByText("Vibe can do this").first()).toBeVisible();
    await expect(page.getByText("Needs your decision").first()).toBeVisible();
    await expect(page.getByText("You'll need to do this").first()).toBeVisible();
    await expect(page.getByText("Depends on something else").first()).toBeVisible();
  });

  test("keeps an unsupported step in the plan, distinct from failure", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    await expect(page.getByText("Build a dedicated pricing page")).toBeVisible();
    const row = plannedStep(page, "Build a dedicated pricing page");
    await expect(row.getByText("Vibe's work").first()).not.toBeVisible();
    await row.locator("summary").click();
    await expect(row.getByText("Vibe's work").first()).toBeVisible();
    await expect(row.getByText("Not automated yet")).toBeVisible();
  });

  test("shows approval only inside the expanded task", async ({
    page,
  }) => {
    await page.goto("/e2e/action_plan_ready");
    await openFullPlannedWork(page);

    // The SEO step is the one fixture step that requires approval.
    const row = plannedStep(page, "Publish the missing robots.txt and sitemap");
    await expect(row.getByText("Approval required")).not.toBeVisible();
    await row.locator("summary").click();
    await expect(row.getByText("Approval required before Vibe acts on this.")).toBeVisible();
  });
});

test.describe("ready plan — reasoning disclosure", () => {
  test("discloses reasoning and evidence behind a collapsed section", async ({ page }) => {
    await page.goto("/e2e/action_plan_ready");

    // The label now carries the counted evidence behind the plan, so it is
    // matched by prefix rather than exactly.
    const disclosure = page.getByText("Evidence & details", { exact: false });
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

  test("still offers a replan while a founder question is open", async ({ page }) => {
    // The panel rewrite gated "Plan options" on there being no open founder
    // question. That withheld the replan at the one moment it matters most:
    // when the plan is asking something the founder cannot or will not answer,
    // replanning is how they leave it. Collapsed behind a summary is the
    // density decision and is fine; absent from the page is a dead end.
    await page.goto("/e2e/action_plan_ready");

    await expect(page.getByRole("heading", { name: "Vibe needs your input" })).toBeVisible();

    const planOptions = page.locator("details").filter({ hasText: "Plan options" });
    await expect(planOptions).toHaveCount(1);
    await planOptions.locator("summary").click();
    await expect(page.getByRole("button", { name: "Replan this move" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Vibe needs your input" })).toBeVisible();
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

/**
 * What the plan screen believes about "can Vibe do this".
 *
 * The stored classification knows only the deterministic capability registry —
 * one entry — so a step the coding agent could build read "Not automated yet"
 * here while the Agent workspace offered to run it. Both sentences were true of
 * the same step at the same time.
 */
test.describe("a step the agent could build says so", () => {
  test("reads as buildable, not as unautomated", async ({ page }) => {
    await page.goto("/e2e/action_plan_agentic_step");
    await openFullPlannedWork(page);
    await expandEverything(page);

    const step = plannedStep(page, "Build a dedicated pricing page");
    await expect(step.getByText("Vibe could build this")).toBeVisible();
    await expect(step.getByText("Not automated yet")).toHaveCount(0);
  });

  test("promises nothing is already running, and offers no control", async ({ page }) => {
    await page.goto("/e2e/action_plan_agentic_step");
    await openFullPlannedWork(page);
    await expandEverything(page);

    // Scoped to the step's own responsibility line: the fixture's *purpose*
    // prose legitimately says "Vibe cannot yet write and ship a new page like
    // this automatically", and that sentence is not what changed here.
    const step = plannedStep(page, "Build a dedicated pricing page");
    await expect(step.getByText("Vibe could build this")).toBeVisible();
    await expect(step.getByText("is happening")).toHaveCount(0);
    await expect(step.getByText("Vibe is building")).toHaveCount(0);

    // The copy changed; the affordance did not. This is the assertion that
    // proves it did not become a fake button.
    for (const label of FORBIDDEN_ACTION_LABELS) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
  });

  test("leaves a founder-owned step exactly as it was", async ({ page }) => {
    await page.goto("/e2e/action_plan_agentic_step");
    await openFullPlannedWork(page);
    await expandEverything(page);

    const step = plannedStep(page, "Decide which segment to target first");
    await expect(step.getByText("Needs your decision")).toBeVisible();
  });
});

/**
 * And a step Vibe cannot build says which repository fact stands in the way.
 *
 * The counterpart of the suite above, and the half of its own argument that was
 * never applied. The resolver is asked on this screen because the stored
 * classification knows only the deterministic registry; when it answers *yes*
 * the row says so, and when it answered **no** it also said why — which the
 * screen dropped, so a founder one analyzer version behind read the same four
 * words as one asking for something Vibe genuinely cannot do.
 */
test.describe("a step Vibe cannot build says why", () => {
  test("names the repository fact instead of calling the work unautomated", async ({ page }) => {
    await page.goto("/e2e/action_plan_repository_blocked");
    await openFullPlannedWork(page);
    await expandEverything(page);

    const step = plannedStep(page, "Build a dedicated pricing page");
    await expect(step.getByText("predates this check")).toBeVisible();

    // The sentence this replaces is not merely vague for a stale analysis — it
    // is false. The work is automated; the read of the code is old.
    await expect(step.getByText("Not automated yet")).toHaveCount(0);
  });

  test("says whose work it still is", async ({ page }) => {
    // The headline does not move. Who owns the work is a different question
    // from whether Vibe can currently start it, and only the second changed.
    await page.goto("/e2e/action_plan_repository_blocked");
    await openFullPlannedWork(page);
    await expandEverything(page);

    const step = plannedStep(page, "Build a dedicated pricing page");
    await expect(step.getByText("Vibe's work")).toBeVisible();
  });

  test("offers no control it cannot honour", async ({ page }) => {
    await page.goto("/e2e/action_plan_repository_blocked");
    await openFullPlannedWork(page);
    await expandEverything(page);

    for (const label of FORBIDDEN_ACTION_LABELS) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
  });
});

