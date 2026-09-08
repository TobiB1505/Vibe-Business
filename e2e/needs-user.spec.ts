import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

/**
 * "Vibe needs you", in a real browser (CORE-2a.4 §30, §31, §47, §48).
 *
 * ## What only a browser can prove here
 *
 * This sprint's claim is almost entirely about *how it reads*. "Vibe paused
 * because it needed me" rather than "Vibe made me fill in a form" is not a
 * property of a data structure — `selectBlockingQuestion` returning a question
 * proves the question exists, not that a founder meets the context before the
 * ask, or that "I'm not sure yet" looks like an answer rather than a way out.
 *
 * The reading-order assertion is the same class the CORE-2 audit suite exists
 * for, and for the same reason: that ordering lived in a component once and was
 * silently reversible by a route.
 *
 * ## What it does not prove
 *
 * Submission. The fixture route has no session and no database, so the action
 * cannot run — the wiring from panel to canonical store is covered by unit
 * tests and by the dogfood. The same documented gap every suite in this
 * repository carries.
 */

const FIRST_CUSTOMER = "/e2e/needs_user_first_customer";
const STAGE = "/e2e/needs_user_stage";
const NO_CONTEXT = "/e2e/needs_user_no_context";

async function topOf(locator: ReturnType<Page["getByText"]>): Promise<number> {
  const box = await locator.first().boundingBox();
  if (!box) throw new Error("element not visible");
  return box.y;
}

test.describe("it reads as a collaborator, not an error (§29)", () => {
  test("names itself as Vibe needing the founder", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);
    await expect(page.getByText("Vibe needs you")).toBeVisible();
  });

  /**
   * The failure mode: an alert role, a warning colour and error copy would tell
   * a founder something went wrong. Nothing did — the audit is mid-thought.
   *
   * Scoped to the panel rather than the page, because Next renders its own
   * route announcer with `role="alert"` on every route. Asserting against the
   * document caught the framework instead of the component — which is the kind
   * of green-by-accident this suite exists to avoid, in reverse.
   */
  test("shows no error or alert while simply waiting", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    const panel = page.getByRole("region");
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(panel.getByText(/went wrong|failed|error/i)).toHaveCount(0);
  });
});

test.describe("what Vibe understood comes before what it asks (§11, §30)", () => {
  /**
   * The whole feel of the interaction is this ordering. A founder should read
   * the context, think "it worked that out by itself", and only then be asked.
   * Reversed, it is a questionnaire with a preamble.
   */
  test("puts the context paragraph above the question", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    const heading = page.getByRole("heading", { level: 3 });
    await expect(heading).toBeVisible();

    const context = page.getByText(/worked that out from your product/i);
    await expect(context).toBeVisible();

    expect(await topOf(context)).toBeLessThan(await topOf(heading));
  });

  /**
   * §12 — a premise Vibe cannot support is worse than no premise. When nothing
   * was established, the panel shows the question alone rather than a
   * plausible-sounding filler sentence.
   */
  test("shows no context at all when nothing was established", async ({ page }) => {
    await page.goto(NO_CONTEXT);

    await expect(page.getByRole("heading", { level: 3 })).toBeVisible();
    await expect(page.getByText(/worked that out from your product/i)).toHaveCount(0);
  });

  /** The question mentions the product, not a generic category (§62). */
  test("asks about this product rather than any startup", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    const heading = page.getByRole("heading", { level: 3 });
    await expect(heading).not.toHaveText(/^who is your target audience\??$/i);
    await expect(heading).toContainText(/who do you want to win first/i);
  });
});

test.describe("answering (§16, §17)", () => {
  /**
   * A closed-vocabulary question must offer our own values. A free-text box
   * here would collect an answer the domain then rejects, which is a validation
   * error the founder did nothing to deserve.
   */
  test("offers the permitted options for a closed question", async ({ page }) => {
    await page.goto(STAGE);

    const options = page.getByRole("radio");
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(1);
  });

  /** An open question takes prose, because a first customer is not an enum. */
  test("takes free text when the answer is not a closed set", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  /**
   * §17 — "I'm not sure yet" is an answer, not a skip. It sits beside Continue
   * as a button of its own, and it stays usable when Continue is not.
   */
  test("offers not-sure as a real answer beside continue", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    const notSure = page.getByRole("button", { name: /not sure yet/i });
    await expect(notSure).toBeVisible();
    await expect(notSure).toBeEnabled();

    // Nothing typed yet, so continuing would submit an empty answer.
    await expect(page.getByRole("button", { name: /continue audit/i })).toBeDisabled();
  });

  test("enables continue once an answer exists", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    await page.getByRole("textbox").fill("Solo founders who already shipped something");
    await expect(page.getByRole("button", { name: /continue audit/i })).toBeEnabled();
  });
});

test.describe("operable without a mouse (§48)", () => {
  test("reaches the answer and both buttons by keyboard alone", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox")).toBeFocused();

    await page.keyboard.type("Solo founders who already shipped");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /continue audit/i })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /not sure yet/i })).toBeFocused();
  });

  test("selects a closed-vocabulary option by keyboard", async ({ page }) => {
    await page.goto(STAGE);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");

    await expect(page.getByRole("radio").first()).toBeChecked();
    await expect(page.getByRole("button", { name: /continue audit/i })).toBeEnabled();
  });

  /** The question is announced as the group's label rather than left unnamed. */
  test("names the option group for a screen reader", async ({ page }) => {
    await page.goto(STAGE);
    await expect(page.getByRole("group")).toHaveCount(1);
  });
});

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("does not scroll sideways", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    await expectNoHorizontalOverflow(page);
  });

  test("keeps both answers reachable on a phone", async ({ page }) => {
    await page.goto(FIRST_CUSTOMER);

    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByRole("button", { name: /not sure yet/i })).toBeVisible();
  });
});

test.describe("choosing an answer, from the keyboard", () => {
  /**
   * The gap this closes.
   *
   * The choice used to be drawn two ways across the product, and the card
   * version hid its input with `sr-only` — a 1px clipped box. The browser drew
   * the focus outline there, so a keyboard user tabbing through the options
   * saw nothing move. Measured on the old markup: a 2px mint outline on a 1×1
   * element.
   *
   * Only a browser can catch that. The markup was correct, the component
   * rendered, every unit test passed, and the screen was unusable without a
   * mouse.
   */

  /**
   * What mint actually serialises to here.
   *
   * `ring-mint/30` becomes a `color-mix`, which Chromium computes to `oklab(…)`
   * rather than to an `rgb()` string — so a test that pins the hex passes today
   * and breaks on a browser update for no reason. This asks the page what the
   * token resolves to and compares against that.
   */
  async function mintAs(page: Page, expression: string): Promise<string> {
    return page.evaluate((value) => {
      const probe = document.createElement("div");
      probe.style.color = value;
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    }, expression);
  }

  test("draws the focus on the card, not on the clipped input", async ({ page }) => {
    await page.goto(STAGE);

    const options = page.getByRole("radio");
    const before = await options
      .first()
      .evaluate((input) => getComputedStyle(input.closest("label")!).boxShadow);

    await options.first().focus();

    const seen = await options.first().evaluate((input) => {
      const label = input.closest("label")!;
      return {
        inputWidth: Math.round(input.getBoundingClientRect().width),
        cardWidth: Math.round(label.getBoundingClientRect().width),
      };
    });

    // The input really is the invisible one — if it stops being `sr-only` this
    // test would pass for the wrong reason.
    expect(seen.inputWidth).toBeLessThanOrEqual(1);
    expect(seen.cardWidth).toBeGreaterThan(100);

    // Polled, and the colour components only. The ring fades in, so a single
    // sample catches whatever frame it lands on — one run read an alpha of
    // 0.2, another read the transition's first frame at zero. The claim is
    // that focus *becomes* visible on the card, not that it does so within
    // one frame, so this waits for that rather than timing it.
    const mint30 = await mintAs(page, "color-mix(in oklab, var(--color-mint) 30%, transparent)");
    await expect
      .poll(() =>
        options.first().evaluate((input) => getComputedStyle(input.closest("label")!).boxShadow),
      )
      .toContain(mint30.split(" / ")[0]);

    const after = await options
      .first()
      .evaluate((input) => getComputedStyle(input.closest("label")!).boxShadow);
    expect(after).not.toBe(before);
  });

  test("moves between the options with the arrow keys", async ({ page }) => {
    await page.goto(STAGE);

    const options = page.getByRole("radio");
    await options.first().focus();
    await page.keyboard.press("ArrowDown");

    // Real radios, so this is the browser's behaviour rather than ours. It is
    // asserted because the alternative — divs with `aria-checked` — looks
    // identical in a screenshot and loses it.
    await expect(options.nth(1)).toBeChecked();
  });

  test("marks the chosen option with something that is there or is not", async ({ page }) => {
    await page.goto(STAGE);

    const mint = await mintAs(page, "var(--color-mint)");
    const dotsIn = (index: number) =>
      page
        .getByRole("radio")
        .nth(index)
        .evaluate(
          (input, fill) =>
            [...input.closest("label")!.querySelectorAll("span")].filter((span) => {
              const style = getComputedStyle(span);
              const box = span.getBoundingClientRect();
              return style.backgroundColor === fill && box.width > 4 && box.width === box.height;
            }).length,
          mint,
        );

    const chosen = page.getByRole("radio").nth(1);
    await chosen.evaluate((input) => (input.closest("label") as HTMLElement).click());
    await expect(chosen).toBeChecked();

    // The dot, not the border. A tinted border says "selected" only next to
    // the unselected ones; the dot says it on its own — so it has to be
    // present on the chosen card and absent from the others.
    expect(await dotsIn(1)).toBeGreaterThan(0);
    expect(await dotsIn(0)).toBe(0);
  });
});
