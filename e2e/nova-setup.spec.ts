import { expect, test, type Page } from "@playwright/test";

import { NOVA_ONBOARDING_MESSAGE } from "../src/modules/nova/onboarding";
import { ONBOARDING_STATES } from "../src/modules/onboarding/state";

/**
 * Setup as Nova renders it, in a real browser (Sprint 0163).
 *
 * ## Why this suite exists
 *
 * Because everything sprint 0163 built rested on unit tests, source sweeps and
 * screenshots taken by hand. Four fixture routes mount the production
 * components and eleven defects came out of looking at them — and not one of
 * those defects had a test that would have caught it coming back.
 *
 * Rule 69 names the failure this repository keeps paying for: the domain
 * tested, the SQL tested, and the screen untested. These are the screens.
 *
 * ## Why almost everything here runs under reduced motion
 *
 * Because the opening is a choreography and a timing assertion is a flake
 * waiting to be written. Under `prefers-reduced-motion` the whole sequence is
 * skipped by construction — `useOpening` returns the last beat on the first
 * frame — so the finished room is what renders, immediately and stably. That
 * is also the state a real reader on that preference gets, so asserting it is
 * asserting the product rather than working around it.
 *
 * The one thing worth proving *with* motion is that the room the choreography
 * builds is the room that is still there afterwards, and that is a geometry
 * comparison rather than a timing one.
 *
 * ## The assertion that is deliberately not here
 *
 * "Nothing is left part-way through an entrance under reduced motion" was
 * written four times and found four things about the browser rather than one
 * about the product: the lab shell's 3.5% grain wash and the collapsed opening
 * stage are legitimate design values at less than full opacity; `globals.css`'s
 * backstop caps animation *duration* at `0.01ms` rather than removing the
 * animation, so an element sampled inside the first frame can still read its
 * `from` values; and Motion's layout projection leaves sub-pixel translations
 * that never resolve to `none`.
 *
 * A version of it that passed would have needed an allowlist of all three, and
 * a test carrying an allowlist of the things it is not allowed to notice is
 * worse than no test. What it was reaching for — every sentence and every
 * control present on the first frame — is asserted directly by the first test
 * below, and `agent-stages.spec.ts` covers the obligation where it has teeth.
 *
 * ## What this does not prove
 *
 * The wiring behind these states. The fixtures supply the operation views, the
 * understanding and the audit — the same gap `merge-ui.spec.ts` records. And
 * none of it is a signed-in project on real data, which rule 69's fourth
 * question still has open.
 */

const OPENING = "/e2e/study-opening-shipped";
const FIRST_RUN = "/e2e/study-first-run-shipped";
const STATES = "/e2e/study-onboarding";
const BLOCKS = "/e2e/study-onboarding-blocks";

/** The work column. One per room, and `NovaRail` is the only `aside` in it. */
function rail(page: Page) {
  return page.locator("aside").first();
}

/** One case on the blocks page, by the `OnboardingState` printed above it. */
function blockCase(page: Page, state: string) {
  return page.locator("section").filter({ has: page.locator(`p:text-is("${state}")`) });
}

/** The status row Nova's mark travels into. */
function header(page: Page) {
  return page.locator("header").filter({ hasText: "Nova" }).first();
}

test.describe("the room Nova assembles", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("renders the whole room on the first frame, with no sequence to wait for", async ({
    page,
  }) => {
    await page.goto(OPENING);

    /*
     * No `waitFor` anywhere in this test, deliberately. Reduced motion means
     * the finished screen is the first screen; a reader who needs it is not
     * asked to wait 3,960ms for a sentence, and if that ever stops being true
     * this is the assertion that says so.
     */
    await expect(header(page)).toBeVisible();
    await expect(rail(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.getByText("I'm Nova")).toBeVisible();
  });

  test("never says the project is connecting when nothing is", async ({ page }) => {
    await page.goto(OPENING);

    /*
     * The defect this replaces: the header pulsed the *project* from
     * "Connecting…" to "Disconnected" on a beat, while `connected` had been
     * read on the server and arrived with the first frame. Motion may not say
     * something the product has not observed, and a connection attempt that
     * never happened is the clearest case of it.
     */
    await expect(header(page)).toContainText("Disconnected");
    await expect(header(page)).not.toContainText("Connecting");
  });

  test("carries the setup steps, with exactly one being worked on", async ({ page }) => {
    await page.goto(OPENING);

    await expect(rail(page)).toContainText("Setup");
    for (const step of ["Connect", "Understand", "Audit", "First move"]) {
      /* Each row's paragraph carries the label *and* an `sr-only` state word,
         so the visible label is a prefix rather than the whole text node. */
      await expect(rail(page).getByRole("listitem").filter({ hasText: step })).toHaveCount(1);
    }

    /*
     * The state is said in words beside the mark, not only by the mark: colour
     * is never the only signal, and a shape is not one either. Exactly one row
     * is current, which is the claim `onboardingSteps` makes.
     */
    await expect(rail(page).getByText("— working on this")).toHaveCount(1);
  });

  /**
   * Wait until the room stops moving, rather than until it exists.
   *
   * `toBeVisible()` resolves the moment an element is in the tree with a box,
   * which on a page that is still settling is a different number from the one
   * a founder reads. The first draft of the geometry test below compared a
   * header measured at 1,129.85px against the same header's settled 1,152 and
   * reported a room that had come apart — a defect in the test, and the kind
   * that gets "fixed" in the product if nobody measures twice.
   */
  async function settled(page: Page) {
    await expect(header(page)).toBeVisible();
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll("header")].find((el) =>
        el.textContent?.includes("Nova"),
      );
      if (!row) return false;
      const now = row.getBoundingClientRect().width;
      const previous = (window as unknown as { __w?: number }).__w;
      (window as unknown as { __w?: number }).__w = now;
      return previous === now;
    });
  }

  test("keeps the room it built when the thread moves on", async ({ page }) => {
    await page.goto(OPENING);
    await settled(page);
    const opening = {
      header: await header(page).boundingBox(),
      rail: await rail(page).boundingBox(),
    };

    await page.goto(FIRST_RUN);
    await settled(page);
    const after = {
      header: await header(page).boundingBox(),
      rail: await rail(page).boundingBox(),
    };

    /*
     * The whole claim of the choreography is that Nova assembles the room the
     * rest of setup happens in — which is only true if the room survives the
     * next render. Before `NovaRoom` these two screens had different grid
     * tracks and a differently built rail, and nothing said so.
     */
    expect(after.rail?.width).toBe(opening.rail?.width);
    expect(after.rail?.x).toBe(opening.rail?.x);
    expect(after.header?.width).toBe(opening.header?.width);
    expect(after.header?.x).toBe(opening.header?.x);
  });
});

test.describe("the first thing Nova says", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("asks the one question setup has, and offers both answers", async ({ page }) => {
    await page.goto(FIRST_RUN);

    await expect(page.getByText("should I show you how working with me works first")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show me how you work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Let's start" })).toBeVisible();
  });

  test("shows how she works instead of the next setup step", async ({ page }) => {
    await page.goto(FIRST_RUN);
    await page.getByRole("button", { name: "Show me how you work" }).click();

    /*
     * The defect this replaces, and the reason it is the first assertion in
     * this file: pressing wrote `explained`, that revalidates the route, and
     * the derived position became `handoff` — so asking to be shown how Vibe
     * works took a founder to the connect-your-repository screen. The write
     * happens at the bottom of the walkthrough now, by the person it is about.
     */
    await expect(page.getByText("You don't need to write prompts")).toBeVisible();
    await expect(page.getByText("one clear next step at a time")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toHaveCount(0);
  });

  test("shows the example, and says it is one before it is read", async ({ page }) => {
    await page.goto(FIRST_RUN);
    await page.getByRole("button", { name: "Show me how you work" }).click();

    const example = page.locator('section[aria-label="An example"]');
    await expect(example).toBeVisible();

    /* The disclaimer comes first, so a reader hearing it read aloud meets it
       before the invented sentence. */
    await expect(page.getByText("It's only to show you how working with me feels")).toBeVisible();

    /*
     * And the Move in it is a picture rather than a control. It rendered
     * identically to the live one three inches below until somebody looked, so
     * the sentence saying it could not be pressed was arguing with the picture
     * beside it. A `span`, not a button — which is also why this asserts a
     * count of zero rather than a disabled state.
     */
    await expect(example.getByRole("button")).toHaveCount(0);
    await expect(example.getByText("Put the prices on the pricing page")).toBeVisible();
  });

  test("hands over to the real product before setup begins", async ({ page }) => {
    await page.goto(FIRST_RUN);
    await page.getByRole("button", { name: "Show me how you work" }).click();

    /* The seam: everything above it is Nova describing herself, everything
       after it is her working, and the line is between the example and the
       control rather than after both. */
    await expect(page.getByText("everything you see is about your product")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up my product" })).toBeVisible();
  });
});

test.describe("Nova's voice through setup", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("says something in every one of the ten states", async ({ page }) => {
    await page.goto(STATES);

    /*
     * A sentence per state is the guarantee `NOVA_ONBOARDING_MESSAGE` makes as
     * a total record, and this is that guarantee in a browser: the study
     * renders all ten, so a state that stopped rendering its bubble would show
     * up here as a missing one.
     */
    for (const state of ONBOARDING_STATES) {
      /*
       * Read from the table rather than retyped here. A copy of a sentence in
       * a test is a second place the wording lives, and it goes stale the first
       * time somebody improves the first one — which is what the first draft of
       * this test did.
       */
      await expect(page.getByText(NOVA_ONBOARDING_MESSAGE[state]).first()).toBeVisible();
    }
  });

  test("offers nothing to type, anywhere in setup", async ({ page }) => {
    await page.goto(STATES);

    /*
     * §M, and the claim the walkthrough makes out loud. The ten-state study
     * renders no block, so any field here would be one Nova's own chrome had
     * grown — which is exactly what this surface exists to have removed.
     */
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.locator('input[type="text"]')).toHaveCount(0);
  });
});

test.describe("what setup's blocks are allowed to bring", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("gives the paused question one frame, not two", async ({ page }) => {
    await page.goto(BLOCKS);

    /*
     * It arrived in a mint-bordered panel inside Nova's amber one, with a mint
     * glow arguing with that register and a "VIBE NEEDS YOU" eyebrow under a
     * frame already saying so. The block's label is the one name it has.
     */
    const block = blockCase(page, "audit_needs_user").locator(
      'section[aria-label="Needs your answer"]',
    );
    await expect(block).toBeVisible();
    await expect(block).not.toContainText("Vibe needs you");
  });

  test("keeps the audit's own eyebrow and headline out of the block", async ({ page }) => {
    await page.goto(BLOCKS);

    const block = blockCase(page, "audit_running").locator('section[aria-label="Business audit"]');
    await expect(block).toBeVisible();

    /*
     * Both were printed under a frame already labelled "Business audit", and
     * under a bubble where Nova had just said she was going through it. The
     * eyebrow is gone from the page; the *name* stays as an `sr-only` heading,
     * because a section that loses its accessible name has been made worse — so
     * this asserts what a reader sees rather than what the tree contains.
     */
    await expect(block.getByRole("heading", { name: "Business audit · analyzing" })).toHaveClass(
      /sr-only/,
    );
    await expect(block.getByText("Vibe is reading the whole business")).toHaveCount(0);

    /* What survives is the part nothing else says. */
    await expect(block).toContainText("All nine areas are judged together");
  });

  test("keeps the Product Scan's page hero on the page", async ({ page }) => {
    await page.goto(BLOCKS);

    const block = blockCase(page, "product_scanning").locator('section[aria-label="Product scan"]');
    await expect(block).toBeVisible();

    /*
     * Thirty-six point, inside a render block, above a sentence Nova's bubble
     * had just said in her own words. The eyebrow stays — it is the block's
     * own name, which is why the frame prints none — and the title stays as an
     * accessible name rather than disappearing.
     */
    await expect(block.getByRole("heading", { name: /Understanding your product/ })).toHaveClass(
      /sr-only/,
    );
    await expect(block.getByText("Vibe is learning what you built")).toHaveCount(0);
    await expect(block).toContainText("Product scan");
  });

  test("reads every discovery label rather than truncating it", async ({ page }) => {
    await page.goto(BLOCKS);

    /*
     * The scan's inner layouts collapse at `max-lg`, a *viewport* query, so a
     * 704px block in a wide window kept a two-column layout at half its
     * measure: "Compiled from bou…", "Audience sig…", "Pro… Cor… Liv…". This
     * asserts the readable end of that rather than the CSS.
     */
    const block = blockCase(page, "product_scanning").locator('section[aria-label="Product scan"]');
    await expect(block.getByText("Core features", { exact: true }).first()).toBeVisible();
    await expect(block.getByText("Audience signals", { exact: true }).first()).toBeVisible();
    await expect(block.getByText("Brand / identity", { exact: true }).first()).toBeVisible();
  });

  test("ends the reveal on Moves, and says the product's name once", async ({ page }) => {
    await page.goto(BLOCKS);

    const block = blockCase(page, "product_reveal").locator(
      'section[aria-label="What I understood"]',
    );
    await expect(block).toBeVisible();

    /* The pipeline's generic headline was the third statement in a row after
       the block's label and Nova's sentence. */
    await expect(block).not.toContainText("I understand what you built.");

    await expect(
      block.getByRole("button", { name: /Yes, that's my product|Business Audit/ }),
    ).toBeVisible();
    await expect(block.getByRole("button", { name: "Something's off" })).toBeVisible();
  });

  test("prices setup's last control inside the control", async ({ page }) => {
    await page.goto(BLOCKS);

    /*
     * It was an `ActionBlock`, the shape the Move replaced everywhere else, so
     * a founder walked a thread of Moves and met a different kind of button at
     * the end. The consequence it carried is kept, said before the press.
     */
    const decision = page.locator('[data-testid="first-move-decision"]');
    await expect(decision.getByRole("button", { name: /Plan this move/ })).toBeVisible();
    await expect(decision).toContainText("Nothing is changed in your product by planning");
  });
});

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const [name, path] of [
    ["the opening", OPENING],
    ["the first run", FIRST_RUN],
    ["setup's blocks", BLOCKS],
  ] as const) {
    test(`${name} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("puts the conversation above the work column on a phone", async ({ page }) => {
    await page.goto(FIRST_RUN);

    /*
     * A founder who opens this on a phone came for what Nova has to say, and
     * the rail above it means scrolling past the whole plan and the whole log
     * to reach the one thing that speaks. `NovaRoom` owns that order, so this
     * is the assertion for every screen that composes it.
     */
    await expect(page.locator(".bubble").first()).toBeVisible();
    const bubble = await page.locator(".bubble").first().boundingBox();
    const column = await rail(page).boundingBox();
    expect(bubble!.y).toBeLessThan(column!.y);
  });
});
