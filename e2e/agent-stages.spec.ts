import { expect, test, type Page } from "@playwright/test";

/**
 * The Agent rail, in a real browser (UI-19).
 *
 * ## What only a browser proves here
 *
 * Two things, and the unit tests can reach neither.
 *
 * **That the six states are distinguishable.** `agentStageSteps` already proves
 * a stage is `skipped` rather than `pending`. Whether a founder can *see* that
 * is a property of the rendered rail, and a component that painted them
 * identically would pass every unit test in the module.
 *
 * **That reduced motion is honoured.** `prefers-reduced-motion` is a media
 * query. No assertion about it means anything until something has evaluated it.
 */

const IDLE = "/e2e/agent-stages-idle";
const BUILDING = "/e2e/agent-stages-building";
const PAUSED = "/e2e/agent-stages-paused";
const STOPPED = "/e2e/agent-stages-stopped";
const NO_PREVIEW = "/e2e/agent-stages-no-preview";
const VALIDATING = "/e2e/agent-stages-validating";
const PREVIEW = "/e2e/agent-stages-preview";
const MERGE = "/e2e/agent-stages-merge";

const stage = (page: Page, name: string) =>
  page.getByTestId("agent-stage-rail").locator(`[data-stage="${name}"]`);

test.describe("the workspace follows the target composition", () => {
  test("shows the ready hero instead of an empty stepper before a run", async ({ page }) => {
    await page.goto(IDLE);

    await expect(page.getByTestId("agent-ready-stage")).toBeVisible();
    await expect(page.getByTestId("agent-stage-rail")).toHaveCount(0);
    await expect(page.getByTestId("agent-core")).toHaveAttribute("data-state", "idle");
    await expect(page.getByTestId("agent-credit-estimate")).toContainText(
      "Up to 100 Credits",
    );
    await expect(page.getByRole("button", { name: "Run with Vibe" })).toBeVisible();
  });

  /** Once a run exists, every stage uses one stable tracker geometry. */
  test("does not change tracker height between running stages", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(BUILDING);
    const building = await page.getByTestId("agent-stage-rail").boundingBox();

    await page.goto(VALIDATING);
    const validating = await page.getByTestId("agent-stage-rail").boundingBox();

    expect(Math.abs(validating!.height - building!.height)).toBeLessThanOrEqual(1);
  });
});

test.describe("waiting is not working, and never was", () => {
  test("holds the core and names the wait when a question is open", async ({ page }) => {
    await page.goto(PAUSED);

    await expect(stage(page, "build")).toHaveAttribute("data-state", "paused");
    await expect(page.getByTestId("agent-core")).toHaveAttribute("data-state", "waiting");
    await expect(stage(page, "build")).toContainText(/waiting for you/i);
    // And the stages after it are still ahead, not written off.
    await expect(stage(page, "validate")).toHaveAttribute("data-state", "pending");
  });
});

test.describe("never reached does not read as not yet", () => {
  /**
   * The defect the rail's extra vocabulary exists to prevent. Both states are
   * grey and quiet; if they also share their words, the screen tells somebody
   * to keep waiting for work that will never happen.
   */
  test("says different words for a skipped stage than for a pending one", async ({ page }) => {
    await page.goto(STOPPED);

    await expect(stage(page, "build")).toHaveAttribute("data-state", "failed");
    await expect(stage(page, "validate")).toHaveAttribute("data-state", "skipped");
    await expect(stage(page, "validate")).toContainText(/never reached/i);
    await expect(stage(page, "validate")).not.toContainText(/pending/i);

    await page.goto(BUILDING);
    await expect(stage(page, "validate")).toContainText(/pending/i);
    await expect(stage(page, "validate")).not.toContainText(/never reached/i);
  });

  test("marks an inapplicable stage as such rather than parking it", async ({ page }) => {
    await page.goto(NO_PREVIEW);

    await expect(stage(page, "preview")).toHaveAttribute("data-state", "not_applicable");
    await expect(stage(page, "preview")).toContainText(/not applicable/i);
  });
});

test.describe("the surface invents no progress or duration estimate", () => {
  test("shows no duration, range or percentage in any state", async ({ page }) => {
    /*
     * The whole surface, not the rail and the core.
     *
     * It read those two because they were the only regions on every stage. The
     * core no longer is — the reference gives it the hero and the running run
     * and nothing else — and scoping an estimate ban to two components was
     * always narrower than the claim. This asserts the claim.
     */
    for (const url of [IDLE, BUILDING, PAUSED, STOPPED, NO_PREVIEW]) {
      await page.goto(url);
      const text = await page.locator("main").innerText();
      expect(text, url).not.toMatch(/\d+\s*[–-]\s*\d+\s*(hour|minute|file)|~\s*\d|\d+\s*%/i);
    }
  });

  /** Counts are real or absent. "6 files inspected" comes from the event log. */
  test("shows a measured count once one exists", async ({ page }) => {
    await page.goto(NO_PREVIEW);
    await expect(stage(page, "understand")).toContainText(/12 files inspected/i);
  });
});

test.describe("motion", () => {
  /**
   * The one claim that only exists in a browser. Reduced motion must remove the
   * animation without removing anything a reader needs.
   */
  test("runs no animation under prefers-reduced-motion, and still says everything", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BUILDING);

    const animated = await page
      .getByTestId("agent-stage-rail")
      .locator("*")
      .evaluateAll((nodes) =>
        nodes.filter((node) => {
          const name = getComputedStyle(node).animationName;
          return name !== "none" && name !== "";
        }).length,
      );
    expect(animated).toBe(0);

    // Everything still readable: five stages, their labels and their states.
    await expect(page.getByTestId("agent-stage-rail").locator("[data-stage]")).toHaveCount(5);
    await expect(stage(page, "build")).toContainText(/in progress/i);
    await expect(page.getByTestId("agent-core")).toBeVisible();
  });

  test("animates the active stage when motion is allowed", async ({ page }) => {
    await page.goto(BUILDING);

    /*
     * Polled, not sampled once.
     *
     * `useDocumentVisible` deliberately starts `false` — there is no `document`
     * during server rendering, and a motion that begins before we know whether
     * anyone is looking is the thing that hook exists to prevent. So the glow
     * appears one tick after hydration, and reading the computed style on the
     * first frame is a race the assertion loses at random. It made this test
     * flaky in CI: red on the first attempt, green on the retry.
     */
    await expect
      .poll(
        async () =>
          await stage(page, "build")
            .locator("*")
            .evaluateAll((nodes) =>
              nodes.some((node) => getComputedStyle(node).animationName.includes("vibe-step-glow")),
            ),
        { message: "the active stage never started its glow" },
      )
      .toBe(true);
  });
});

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("does not scroll sideways and keeps every stage readable", async ({ page }) => {
    await page.goto(BUILDING);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.getByTestId("agent-stage-rail").locator("[data-stage]")).toHaveCount(5);
    await expect(stage(page, "review")).toContainText(/pending/i);
  });
});


test.describe("agent activity and independent validation stay distinct", () => {
  test("keeps the Agent's live event record in Build", async ({ page }) => {
    await page.goto(BUILDING);

    await expect(page.getByTestId("agent-file-activity")).toContainText(
      "src/app/pricing/page.tsx",
    );
    await expect(page.getByTestId("agent-file-activity")).toContainText("Live activity");
  });

  test("names only checks the sandbox runs", async ({ page }) => {
    await page.goto(VALIDATING);

    const checks = page.getByTestId("agent-validation-checks");
    await expect(checks.locator("[data-check]")).toHaveCount(4);

    /*
     * The reference drew "Linting" and "Security scan". Neither step exists in
     * `planValidationSteps`, and a tick beside a check nobody ran is the one
     * thing a safety screen must never show.
     */
    await expect(checks).not.toContainText(/linting/i);
    await expect(checks).not.toContainText(/security scan/i);
  });

  test("does not repeat the Agent event record inside validation", async ({ page }) => {
    await page.goto(VALIDATING);

    await expect(page.getByTestId("agent-file-activity")).toHaveCount(0);
    await expect(page.getByTestId("agent-activity")).toHaveCount(0);
  });
});

test.describe("stage four compares", () => {
  test("shows both frames at the same size", async ({ page }) => {
    await page.setViewportSize({ width: 1560, height: 1000 });
    await page.goto(PREVIEW);

    const frames = page.getByTestId("agent-preview").locator("figure");
    await expect(frames).toHaveCount(2);

    const before = await frames.nth(0).boundingBox();
    const after = await frames.nth(1).boundingBox();
    expect(Math.abs(before!.width - after!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(before!.height - after!.height)).toBeLessThanOrEqual(2);
  });

  /**
   * A capture that is still running, failed, or past its retention deadline
   * produces no signed URL. The frame has to say so rather than break.
   */
  test("says so when there is no capture, instead of a broken image", async ({ page }) => {
    await page.goto(PREVIEW);

    await expect(page.getByTestId("agent-preview")).toContainText(/no capture available/i);
    await expect(page.getByTestId("agent-preview").locator("img")).toHaveCount(0);
  });

  /**
   * This used to assert that neither row appeared at all, because nothing
   * measured them. Something does now — both sides of every file are compared
   * when the change is prepared — so the claim moves from "never shown" to
   * "shown exactly as counted". What it still forbids is a number nobody
   * computed, which is the next test.
   */
  test("shows the verified file count and the measured line totals", async ({ page }) => {
    await page.goto(PREVIEW);

    const preview = page.getByTestId("agent-preview");
    await expect(preview).toContainText(/files changed/i);
    await expect(preview).toContainText("+410");
    await expect(preview).toContainText("\u2212" + "25");
  });
});

test.describe("stage five tells the truth about merging", () => {
  test("does not promise a deployment", async ({ page }) => {
    await page.goto(MERGE);

    const merge = page.getByTestId("agent-merge");
    await expect(merge).not.toContainText(/merge & deploy/i);
    await expect(merge).not.toContainText(/deployed automatically/i);
  });

  /**
   * And does not claim the opposite either. Moving a default branch can start
   * the customer's own pipeline, and they are entitled to know before the click.
   */
  test("says merging can start the repository's own pipeline", async ({ page }) => {
    await page.goto(MERGE);

    const merge = page.getByTestId("agent-merge");
    await expect(merge).toContainText(/vibe does not deploy anything/i);
    await expect(merge).toContainText(/merging will start it/i);
  });

  /** A passing validation is not a safety verdict (rule 66). */
  test("does not call a passing check safe to merge", async ({ page }) => {
    await page.goto(MERGE);

    const merge = page.getByTestId("agent-merge");
    await expect(merge).toContainText(/all checks passed/i);
    await expect(merge).not.toContainText(/safe to merge/i);
  });

  test("lists every changed file with its own path", async ({ page }) => {
    await page.goto(MERGE);

    const files = page.getByTestId("agent-merge").locator("li");
    await expect(files).toHaveCount(8);
    await expect(page.getByTestId("agent-merge")).toContainText("src/lib/stripe/checkout.ts");
  });

  /**
   * The counts are per file, and not every file has them: a change is measured
   * file by file, and one too large to compare carries none. The failure this
   * guards is the tempting default — rendering that file as `+0 \u22120`, which
   * says "nothing changed here" about a file that did change.
   */
  test("shows each file's own counts, and none for one it could not measure", async ({ page }) => {
    await page.goto(MERGE);

    const counted = page
      .getByTestId("agent-merge")
      .locator("li")
      .filter({ hasText: "src/app/pricing/page.tsx" });
    await expect(counted).toContainText("+186");

    const uncounted = page
      .getByTestId("agent-merge")
      .locator("li")
      .filter({ hasText: "public/images/pricing-hero.svg" });
    await expect(uncounted).not.toContainText("+0");
    await expect(uncounted).not.toContainText(/[+\u2212]\s*\d/);
  });
});


test.describe("the ready state promises nothing it cannot measure", () => {
  /**
   * The reference draws "Estimated time ~1-2 hours" and "Expected changes 8-15
   * files". No estimator exists, and how many files a run touches is unknown
   * until it has touched them — the same reason this product refuses progress
   * percentages.
   */
  test("shows what is true before a run instead of an estimate", async ({ page }) => {
    await page.goto(IDLE);

    const facts = page.getByTestId("agent-ready-facts");
    await expect(facts).toContainText(/isolated environment/i);
    await expect(facts).toContainText(/working from your code/i);

    await expect(facts).not.toContainText(/estimated time/i);
    await expect(facts).not.toContainText(/expected changes/i);
    expect(await facts.innerText()).not.toMatch(/~\s*\d|\d+\s*[–-]\s*\d+/);
  });
});


test.describe("the rail opens what it can open", () => {
  /**
   * The design's stepper is a map of the run, and a founder looking at stage
   * four wants to be able to look back at stage three. Every stage carrying a
   * verdict is a link; the ones with nothing behind them are not, because a
   * stepper whose steps all look clickable and half of which do nothing is
   * worse than one that never invites the click.
   */
  test("links only the stages that have something to show", async ({ page }) => {
    await page.setViewportSize({ width: 1560, height: 1000 });
    await page.goto(PREVIEW);

    const rail = page.getByTestId("agent-stage-rail");
    for (const stage of ["understand", "build", "validate", "preview"]) {
      await expect(rail.locator(`[data-stage="${stage}"] button`)).toHaveCount(1);
    }

    /*
     * A button rather than a link, and that is the point: switching stages
     * costs nothing because every body was rendered by the read that drew the
     * page. As a `?stage=` link each click re-ran that read — up to four GitHub
     * calls per change — to change which of five already-fetched things was on
     * screen.
     */
    await expect(rail.locator('[data-stage="review"] button')).toHaveCount(1);
  });

  test("switches without going back to the server", async ({ page }) => {
    await page.goto(PREVIEW);

    // Opening another stage must not navigate: the URL is unchanged and the
    // body swaps in place.
    const before = page.url();
    await page.getByTestId("agent-stage-rail").locator('[data-stage="validate"] button').click();
    await expect(page.getByTestId("agent-validation-checks")).toBeVisible();
    expect(page.url()).toBe(before);
  });

  test("says which stage is open, to a screen reader as well", async ({ page }) => {
    await page.goto(PREVIEW);

    const rail = page.getByTestId("agent-stage-rail");
    await expect(rail.locator('[data-stage="preview"] [aria-current="step"]')).toHaveCount(1);
  });
});

test.describe("the rail stays one line per stage", () => {
  /**
   * The measured counts moved out. Appending "· 11 files inspected" to a
   * status word gave five cells different heights and wrapped them at the
   * widths this rail actually gets; the numbers live in the activity list.
   */
  test("shows the status word alone, with no measured detail", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(PREVIEW);

    /*
     * Visible text only. The measured count stays in each cell's screen-reader
     * announcement — a founder who cannot see the activity list should still be
     * told what was inspected — so `innerText` would find it and prove nothing
     * about the rail's own lines.
     */
    const rail = page.getByTestId("agent-stage-rail");
    const visible = await rail
      .locator("[data-stage] span:not(.sr-only)")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => !node.closest(".sr-only"))
          .map((node) => node.textContent ?? "")
          .join(" "),
      );
    expect(visible).not.toMatch(/files inspected|files changed/i);

    // And every cell is the same height, which is what "clean" means here.
    const heights = await rail
      .locator("[data-stage]")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  });
});


test.describe("the new stage replaces the old panel, it does not sit above it", () => {
  /**
   * Every stage used to render its own card and then mount the gate panel
   * underneath, which repeated the change's status sentence and held the only
   * button. A founder saw the same answer twice and had to scroll past the new
   * card to act on it.
   */
  test("says the change's status once, not once per surface", async ({ page }) => {
    await page.setViewportSize({ width: 1560, height: 1200 });
    await page.goto(PREVIEW);

    const preview = page.getByTestId("agent-preview");
    await expect(preview).toBeVisible();

    // The gates' own header is the duplicate. It stays away inside a stage.
    const statuses = page.locator('[data-testid="prepared-change"] [role="status"]');
    await expect(statuses).toHaveCount(0);
  });

  test("keeps the built-from record out of the stage that already lists files", async ({
    page,
  }) => {
    await page.goto(MERGE);

    await expect(page.getByTestId("agent-merge")).toContainText(/files changed/i);
    await expect(page.getByText(/how this was built/i)).toHaveCount(0);
  });
});

/**
 * A refused start, on screen.
 *
 * The incident this covers: the founder pressed "Run with Vibe", the fresh
 * chain refused because the default branch had moved since Vibe last read the
 * repository, and the screen said "This step is no longer eligible — the page
 * will show why above." The page could not; its own render is what put the
 * button there.
 */
test.describe("a refused start says which gate stopped it", () => {
  test("names the moved branch and offers the read the founder starts", async ({ page }) => {
    await page.goto("/e2e/agent-start-refused-head-moved");

    const notice = page.getByTestId("agent-start-refusal");
    await expect(notice).toBeVisible();
    await expect(notice.getByText("Your code has changed since Vibe last read it.")).toBeVisible();

    // Offered, never taken: a re-read costs Credits and is the founder's to start.
    const recovery = notice.getByRole("link", { name: "Re-read my code" });
    await expect(recovery).toHaveAttribute("href", "/app/projects/project_e2e/product");
    await expect(notice.getByText("Vibe never re-reads your code on its own")).toBeVisible();
  });

  test("offers no paid re-read against a permanent refusal", async ({ page }) => {
    await page.goto("/e2e/agent-start-refused-payments");

    const notice = page.getByTestId("agent-start-refusal");
    await expect(notice).toBeVisible();
    await expect(
      notice.getByText("Vibe never changes anything to do with taking payments."),
    ).toBeVisible();
    await expect(notice.getByRole("link")).toHaveCount(0);
  });

  test("leaks no internal identifier and makes no promise about the page", async ({ page }) => {
    for (const scenario of ["agent-start-refused-head-moved", "agent-start-refused-payments"]) {
      await page.goto(`/e2e/${scenario}`);
      const notice = await page.getByTestId("agent-start-refusal").innerText();

      expect(notice).not.toContain("_");
      expect(notice).not.toContain("above");
    }
  });
});

/**
 * Which string is the heading.
 *
 * Only a browser can prove this one. A run executes one step; the screen used
 * to put the whole Move's title in the `<h2>` and list every plan step beneath
 * it, so a founder watching the agent work could not tell which part was being
 * built.
 */
test.describe("the run's subject is the step, with the Move as its context", () => {
  test("puts the step in the heading and keeps the Move above it", async ({ page }) => {
    await page.goto("/e2e/agent-stages-building");

    await expect(page.getByTestId("agent-task-headline")).toHaveText(
      "Add a clear pricing section to your website",
    );
    // The Move is still there — it says what the step is for.
    await expect(page.getByTestId("agent-task-move").first()).toContainText(
      "Make your pricing visible",
    );
    await expect(page.getByTestId("agent-task-move").first()).toContainText("Step 02");
  });

  test("keeps the step in the compact header above the approval stages", async ({ page }) => {
    await page.goto("/e2e/agent-stages-merge");

    const headline = page.getByTestId("agent-task-headline").first();
    await expect(headline).toHaveText("Add a clear pricing section to your website");
  });
});
