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

test.describe("the five stages are always present", () => {
  test("shows all five before anything has run", async ({ page }) => {
    await page.goto(IDLE);

    const rail = page.getByTestId("agent-stage-rail");
    await expect(rail.locator("[data-stage]")).toHaveCount(5);
    for (const name of ["understand", "build", "validate", "preview", "review"]) {
      await expect(stage(page, name)).toHaveAttribute("data-state", "pending");
    }
    await expect(page.getByTestId("agent-core")).toHaveAttribute("data-state", "idle");
  });

  /** Geometry is reserved: the rail is the same height whatever the run is doing. */
  test("does not change height between an idle and a running rail", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(IDLE);
    const idle = await page.getByTestId("agent-stage-rail").boundingBox();

    await page.goto(BUILDING);
    const building = await page.getByTestId("agent-stage-rail").boundingBox();

    expect(Math.abs(idle!.height - building!.height)).toBeLessThanOrEqual(1);
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

    await page.goto(IDLE);
    await expect(stage(page, "validate")).toContainText(/pending/i);
    await expect(stage(page, "validate")).not.toContainText(/never reached/i);
  });

  test("marks an inapplicable stage as such rather than parking it", async ({ page }) => {
    await page.goto(NO_PREVIEW);

    await expect(stage(page, "preview")).toHaveAttribute("data-state", "not_applicable");
    await expect(stage(page, "preview")).toContainText(/not applicable/i);
  });
});

test.describe("nothing on this surface estimates", () => {
  test("shows no duration, range or percentage in any state", async ({ page }) => {
    for (const url of [IDLE, BUILDING, PAUSED, STOPPED, NO_PREVIEW]) {
      await page.goto(url);
      const text = (await page.getByTestId("agent-stage-rail").innerText()) +
        (await page.getByTestId("agent-core").innerText());
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

    const names = await stage(page, "build")
      .locator("*")
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationName));

    expect(names.some((name) => name.includes("vibe-step-glow"))).toBe(true);
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


test.describe("stage three shows the checks, not a promise", () => {
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

  test("switches the rail from intent to record", async ({ page }) => {
    await page.goto(VALIDATING);

    // Paths, not phases: by this stage the question is what was touched.
    await expect(page.getByTestId("agent-file-activity")).toContainText("src/app/pricing/page.tsx");
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

  test("shows the verified file count and no invented line totals", async ({ page }) => {
    await page.goto(PREVIEW);

    const preview = page.getByTestId("agent-preview");
    await expect(preview).toContainText(/files changed/i);
    // No diff statistic is stored, so neither row may appear.
    await expect(preview).not.toContainText(/lines added/i);
    await expect(preview).not.toContainText(/lines removed/i);
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
});
