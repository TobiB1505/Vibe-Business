import { expect, test } from "@playwright/test";

/**
 * Nova Home in a browser (UI Sourcing Spec §15, Slice 1).
 *
 * Every assertion here is one the unit tests cannot make: that the founder can
 * *see* the price before pressing, that a paused run does not read as
 * activity, that a missing score explains itself on screen, that the evidence
 * drawer opens and gives focus back, and that none of it disappears at 375px.
 */

const NOVA = (scenario: string) => `/e2e/${scenario}`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 780 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/**
 * The dead end a founder actually reached, and the rule that removes it.
 *
 * A change was waiting, the approval section said *"Start a preview and look
 * at the change first"*, and there was nothing to press anywhere on the
 * screen. Two things were wrong and the second one subsumed the first.
 *
 * `ChangeGates` matched its `stage` prop exactly, so the moment that mounted
 * it at `stage="review"` rendered the refusal and filtered out the panel that
 * answers it. That is fixed — a stage is a floor there now.
 *
 * But the gate was also the *wrong component*: the Agent workspace replaced it,
 * and the thread was the last surface still drawing it. Nova's block mounts the
 * Agent's own stage screens now, chosen by `AGENT_STAGE_FOR_CHANGE` from the
 * change's own stage — so a change whose next step is a preview is shown the
 * preview screen and never the decision. The refusal cannot appear without its
 * remedy because the screen that refuses is not the screen it is on.
 *
 * Only a browser proves this. Every unit test passed while the dead end
 * shipped: the copy was right, the block was mounted, each panel worked. What
 * was wrong was which of them reached the page together.
 */
test.describe("a change that still needs a preview", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("is shown the preview screen, with its control", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const gate = page.locator('[data-testid="gate-needs-preview"]');
    await expect(gate.locator('[data-testid="agent-preview"]')).toBeVisible();
    await expect(gate.getByRole("button", { name: "Start temporary preview" })).toBeEnabled();
  });

  /*
   * And not the decision it cannot take. This is the assertion the dead end
   * would fail: the approval refusal naming a step is only reachable on a
   * screen that also carries the step, and this change is not on that screen
   * at all.
   */
  test("is not shown an approval it cannot give", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const gate = page.locator('[data-testid="gate-needs-preview"]');
    await expect(gate.getByText(/approval needs a preview of this exact commit/)).toHaveCount(0);
    await expect(gate.locator('[data-testid="agent-merge"]')).toHaveCount(0);
  });

  /*
   * The comparison *is* the two frames, and a comparison exists after a
   * preview has run. Before one, an empty pair was the first eight hundred
   * pixels of the block on a phone — "No capture available for this change",
   * twice, above the control that would go and capture it.
   */
  test("draws no comparison before there is one", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const gate = page.locator('[data-testid="gate-needs-preview"]');
    await expect(gate.getByText("No capture available for this change.")).toHaveCount(0);
  });
});

/**
 * The run, watched from the thread.
 *
 * The block was the polling file list and nothing else — a real piece of the
 * Agent's build stage, and the only piece, so a founder who had just spent
 * Credits saw filenames appear and could not see the run.
 *
 * What a fixture can prove is the composition: the Agent's own stage, in block
 * presentation, with the task and the core in it. What it cannot prove is the
 * seam — in the product the stage arrives behind a `Suspense` boundary whose
 * fallback is that same file list, and a fixture has the whole reading in hand.
 */
test.describe("the agent at work in the thread", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("shows the run, not only the files it touched", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const block = page.locator('[data-testid="stage-build-block"]');
    await expect(block.locator('[data-testid="agent-build"]')).toBeVisible();
    /* The task that was asked for, which no other surface in the thread says. */
    await expect(block.getByText("Add a clear pricing section to your website")).toBeVisible();
    /* And the list, still there, as the stage's activity column. */
    await expect(block.getByText("src/lib/checkout.ts")).toBeVisible();
  });

  /*
   * Three assurances in a row on a page become three stacked rows in a thread
   * column — three hundred pixels that partly repeat each other. The claim is
   * kept; the bar is not.
   */
  test("makes its isolation claim once", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const block = page.locator('[data-testid="stage-build-block"]');
    await expect(block.locator('[data-testid="agent-assurance"]')).toHaveCount(0);
    await expect(
      block.getByText(/Nothing reaches your default branch without your approval/),
    ).toBeVisible();
  });
});

/**
 * The offer, in the thread.
 *
 * The last moment that sent a founder away: Nova said *there is a step here I
 * can build* and handed over a link to the plan. The reason was written down
 * and it was good — a build is two pieces of work at two prices, and offering
 * one of them in a thread is half a decision. So the block shows both, and
 * these are the assertions that say it does.
 *
 * The stand-in buttons carry the real labels; the real control binds a server
 * action and cannot be mounted in a lab with no session, which is what the
 * stage scenarios already say.
 */
const STEP_TITLE = "Add a clear pricing section to your website";

test.describe("the offer in the thread", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("shows both prices and leaves the single step reachable", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const block = page.locator('[data-testid="stage-ready-block"]');
    await expect(block.getByText("Build all 2 steps — 350")).toBeVisible();
    await expect(block.getByText("Build just this step — 200")).toBeVisible();
    /* And why the chain stops, so an offer that ends short is not read as a bug. */
    await expect(block.locator('[data-testid="agent-chain-boundary"]')).toBeVisible();
  });

  /*
   * The defect this catches shipped on the Agent page the day chains did.
   *
   * `AgentStartCta`'s slot clips to `rounded-full` and sweeps a highlight
   * across whatever it holds, which is right for one control and wrong for
   * three. Passing the pair plus the boundary sentence through it squeezed all
   * of them into a single pill and cut the sentence in half. Height is the
   * measurable form of that: two buttons and a paragraph inside one pill
   * collapse to roughly a button's worth.
   */
  test("does not clip the offer into a single pill", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const block = page.locator('[data-testid="stage-ready-block"]');
    const boundary = block.locator('[data-testid="agent-chain-boundary"]');

    /* The sentence is whole: a clipped one lost its second half. */
    await expect(boundary).toHaveText(/it stays yours/);

    const swept = block.locator('[data-testid="agent-start"] .rounded-full.overflow-hidden');
    const pill = await swept.first().boundingBox();
    const decline = await block.getByText("Build just this step — 200").boundingBox();
    /* The decline sits below the swept pill, not inside it. */
    expect(pill).not.toBeNull();
    expect(decline).not.toBeNull();
    expect(decline!.y).toBeGreaterThanOrEqual(pill!.y + pill!.height - 1);
  });

  /*
   * The thread said the step title three times: a grey aside from Nova, then
   * the task panel's headline in thirty-two point type three lines below it,
   * then the same string again as the first row of what Vibe will do.
   *
   * Two survive and they are different claims — this is the step, and this is
   * one of the two things the run delivers. The aside is the one that went, by
   * `BLOCK_SAYS_THE_DETAIL`. Three means it came back.
   */
  test("does not open with the sentence the panel is about to print", async ({ page }) => {
    await page.goto("/e2e/study-block");

    const block = page.locator('[data-testid="stage-ready-block"]');

    /* Said inside the composed stage, where the two claims are different. */
    await expect(
      block.locator('[data-testid="agent-ready-stage"]').getByText(STEP_TITLE).first(),
    ).toBeVisible();

    /* And said by no bubble above it, which is where the third copy was. */
    await expect(block.locator(`.bubble:has-text("${STEP_TITLE}")`)).toHaveCount(0);
  });
});

/**
 * Nova Home, in the room a founder actually opens (ADR 0109, Slice 8).
 *
 * ## What these assertions used to be about
 *
 * A Focus Card, a Working Strip, an Attention Stack, a Product Identity and a
 * Health Score, under `design-studies/legacy-*`. Every one of them was true of
 * that screen and none of them was about a screen a founder could reach — the
 * thread replaced it, and the fixture kept mounting what the tests had been
 * written against. Eight assertions titled *"Nova Home"* were passing about
 * something that was not Nova Home.
 *
 * The claims survive the move intact, because they were never about those
 * components. They are about what a founder can see before pressing, what a
 * paused run is allowed to look like, and what a settled project offers.
 *
 * ## Two that did not move, and where they went instead
 *
 * **A missing score explains itself rather than printing a zero** is asserted
 * against the production business map in `business-audit.spec.ts` — *"only 2
 * of 9 areas could be assessed"*, the words, and the colour that is not the
 * healthy one. Home has no score on it: Business Health is its own destination
 * and its own artifact, and the copy here was of a component that is gone.
 *
 * **A 44px tap target on an attention row** described a stack of links. The
 * other true things are sentences now, with no controls at all — which is the
 * stronger version of the claim below it and is asserted as such.
 */
test.describe("Nova Home", () => {
  test("leads with one dominant action and its price, before any click", async ({ page }) => {
    await page.goto(NOVA("nova-priced"));

    // The focus: one sentence about what needs the founder, in her own voice.
    const focus = page.getByRole("region", { name: "What needs your attention" });
    await expect(focus).toContainText(/audit behind what I am showing you/i);

    // The price is on screen with nothing expanded and nothing pressed.
    await expect(page.getByText(/\d+ Credits/)).toBeVisible();
    // And the balance is not. Vibe states what a thing costs and never what
    // is left: the balance lives once in the chrome, not under every control,
    // and a refusal carries the way out.
    await expect(page.getByText(/available|Not enough/i)).toHaveCount(0);

    // Exactly one primary control. The quiet lines below carry none.
    await expect(page.getByRole("button", { name: "Run the audit again" })).toBeVisible();
    await expect(page.locator("main").getByRole("button")).toHaveCount(1);
  });

  test("never shows a currency or a percentage", async ({ page }) => {
    await page.goto(NOVA("nova-review"));

    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/\$\d|USD/);
    expect(body).not.toMatch(/\d+\s?%/);
  });

  /**
   * The state lives in the line under her name now, where a chat puts it — it
   * was a panel below the thread, which is a box saying what Nova is doing
   * under Nova saying it. The claim is unchanged: a run paused on the founder
   * must never read as activity.
   */
  test("shows a paused run as waiting, never as working", async ({ page }) => {
    await page.goto(NOVA("nova-waiting"));

    const header = page.locator("header").first();
    await expect(header).toContainText(/waiting/i);
    await expect(header).not.toContainText(/working/i);
  });

  test("says nothing about a run when none is going", async ({ page }) => {
    await page.goto(NOVA("nova-review"));

    // This scenario has no operation, so the line carries the moment's own
    // word rather than a stage — and never an idle one it invented.
    const header = page.locator("header").first();
    await expect(header).not.toContainText(/working|running/i);
  });

  test("names a stall as a stall rather than a failure", async ({ page }) => {
    await page.goto(NOVA("nova-stalled"));

    const header = page.locator("header").first();
    await expect(header).toContainText(/stalled/i);
    await expect(header).not.toContainText(/failed/i);
  });

  test("says so, and offers nothing, when there is nothing to do", async ({ page }) => {
    await page.goto(NOVA("nova-settled"));

    const focus = page.getByRole("region", { name: "What needs your attention" });
    await expect(focus).toContainText(/Nothing needs you/i);
    // The failure mode this replaces is a button that does nothing.
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  });

  /**
   * The other things that are also true, and the rule they exist under.
   *
   * They were a stack of cards with a control each, which is the wall of
   * equally weighted choices Nova exists to replace. They are quiet sentences
   * now — and the claim that survived the redesign is the one that matters:
   * **no controls and no prices**, because giving each one a button would
   * rebuild the wall.
   */
  test("keeps the other true things ordered and free of controls", async ({ page }) => {
    await page.goto(NOVA("nova-review"));

    const focus = page.getByRole("region", { name: "What needs your attention" });

    // The ranking raised the change; the plan and the audit are the other two,
    // and all three are on screen — a founder with three things pending used to
    // see one, because `secondary` was computed and discarded.
    await expect(focus).toContainText(/change waiting for you to look at/i);
    await expect(focus).toContainText(/nothing left in it that I can act on/i);
    await expect(focus).toContainText(/audit behind what I am showing you/i);

    /*
      And not one control between them. The moment that leads here is a change,
      whose control is a review gate — a block, which this fixture does not
      mount — so every button on this screen would be one a quiet line had
      grown. That is the failure mode the asides exist under: a button each
      rebuilds the wall of equally weighted choices Nova replaced.
    */
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps the focus action and the price visible at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(NOVA("nova-priced"));

      await expect(page.getByRole("region", { name: "What needs your attention" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Run the audit again" })).toBeVisible();
      await expect(page.getByText(/\d+ Credits/)).toBeVisible();

      // Nothing pushes the page sideways at any width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `${viewport.name} scrolls horizontally`).toBe(false);
    });
  }
});
