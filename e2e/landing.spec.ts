import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/overflow";

/**
 * The landing page (UI-34).
 *
 * ## What this exists to hold
 *
 * The page is long and every block below the hero is rendered **hidden by the
 * server** and revealed as it is scrolled to. That is a design decision with a
 * failure mode attached: if the reveal never fires, or fires only for readers
 * who allow motion, or fires only where JavaScript ran, the marketing site is
 * blank. None of that is visible in a screenshot of the top of the page, which
 * is exactly where a landing page gets looked at.
 *
 * So these assert the three states the reveal has to survive — scrolled,
 * reduced motion, and no JavaScript — against the browser rather than against
 * the source.
 *
 * The fourth guard is about the hero itself. V2's surfaces are translucent
 * films built to sit on the app's opaque ground, and the deck stands on a lit
 * grid: a `bg-surface-2` hero card reads as a ghost with grid lines running
 * across its own headline. The card's fill is asserted to be opaque, because
 * the class that makes it so is one word long and nothing else would notice
 * losing it.
 */

/** Every block the server renders hidden. The hero is deliberately not one. */
const REVEAL = "[data-reveal]";

test.describe("the landing page reveals what it hides", () => {
  test("brings every block to full opacity once it has been scrolled to", async ({ page }) => {
    await page.goto("/");

    const blocks = page.locator(REVEAL);
    const count = await blocks.count();
    expect(count).toBeGreaterThan(4);

    // The last block starts hidden — if it did not, this test would pass
    // without the reveal ever running.
    expect(await blocks.last().evaluate((el) => getComputedStyle(el).opacity)).toBe("0");

    for (let index = 0; index < count; index++) {
      await blocks.nth(index).scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(1200);

    const stillHidden = await page.evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)].filter(
          (el) => Number(getComputedStyle(el).opacity) < 0.99,
        ).length,
      REVEAL,
    );
    expect(stillHidden).toBe(0);
  });

  test.describe("with reduced motion", () => {
    test("presents every block at first paint, with nothing moved", async ({ page }) => {
      /*
        `emulateMedia` rather than `test.use({ reducedMotion })`: the fixture
        option did not reach the page under this project's config —
        `matchMedia("(prefers-reduced-motion: reduce)")` read `false` inside a
        test that had asked for it, so a guard written that way would have been
        asserting the ordinary path twice and calling one of them reduced.
      */
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");

      // No scrolling, no waiting: reduced motion is not a slower entrance, it
      // is the same information without the movement.
      const notPresent = await page.evaluate((selector) => {
        return [...document.querySelectorAll(selector)]
          .map((el) => {
            const style = getComputedStyle(el);
            return { opacity: style.opacity, transform: style.transform };
          })
          .filter((box) => box.opacity !== "1" || box.transform !== "none");
      }, REVEAL);

      expect(notPresent).toEqual([]);
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("still shows the blocks below the hero", async ({ page }) => {
      await page.goto("/");

      // The `<noscript>` style is the only thing standing between a visitor
      // with JavaScript off and a page that is one card and then nothing.
      await expect(
        page.getByRole("heading", { name: /Simple plans|Start free/i }).first(),
      ).toBeVisible();

      const hidden = await page.evaluate(
        (selector) =>
          [...document.querySelectorAll(selector)].filter(
            (el) => Number(getComputedStyle(el).opacity) < 0.99,
          ).length,
        REVEAL,
      );
      expect(hidden).toBe(0);
    });
  });
});

test.describe("the hero deck", () => {
  test("stands on the field rather than letting it through", async ({ page }) => {
    await page.goto("/");

    const fill = await page
      .locator(".landing-hero-card")
      .first()
      .evaluate(
        (el) => getComputedStyle(el).backgroundImage + "|" + getComputedStyle(el).backgroundColor,
      );

    // The card composites its film over `--color-ground`, so the *colour*
    // underneath the gradient must be opaque. A translucent `rgba(…, 0.034)`
    // here is the ghost card this class exists to stop.
    expect(fill).not.toContain("rgba(0, 0, 0, 0)|");
    expect(fill).toMatch(/linear-gradient/);
  });

  test("carries the page's only h1, and hides the two cards behind it", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("build the business");

    // Scan and Audit are shown, not said: they are painted, so `toBeHidden`
    // would be false — what makes them silent is that they are out of the
    // accessibility tree, and that is the thing to assert.
    const behind = page.locator("[aria-hidden='true']", {
      hasText: "Repository and live product read.",
    });
    await expect(behind).toHaveCount(1);
  });

  test("holds the first screen, so the next block is a scroll away", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    /*
      The measurement is a height, so it has to wait for the real face. In the
      fallback the card measured 906px against a 900px viewport and this guard
      failed on a build whose source it had already passed — the same font race
      `expectNoHorizontalOverflow` documents, arriving here as a height rather
      than a width.
    */
    await page.evaluate(() => document.fonts.ready);

    const heroBottom = await page
      .locator(".landing-hero-card")
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const nextBlockTop = await page
      .locator(REVEAL)
      .first()
      .evaluate((el) => el.getBoundingClientRect().top);

    expect(heroBottom).toBeLessThan(900);
    expect(nextBlockTop).toBeGreaterThan(760);
  });

  test("fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("the call to action", () => {
  test("is one line, at one height, on a phone and on a desktop", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      /*
        `getClientRects()` returns one box per line box, so a label that has
        wrapped returns two. Asserting the count rather than a height keeps the
        guard independent of the type scale — which is the thing most likely to
        change under it.
      */
      const lines = await page
        .getByRole("link", { name: /Start with GitHub/i })
        .first()
        .evaluate((el) => (el.firstElementChild?.lastElementChild ?? el).getClientRects().length);

      expect(lines, `the CTA wrapped at ${width}px`).toBe(1);
    }
  });

  test("keeps the assurance out of the pressable area", async ({ page }) => {
    await page.goto("/");

    // UI-29 put it inside the button and UI-34 took it out: the control is a
    // single row of type, and the promise is a line under it.
    const cta = page.getByRole("link", { name: /Start with GitHub/i }).first();
    await expect(cta).not.toContainText("No credit card");
    await expect(page.getByText("No credit card to start").first()).toBeVisible();
  });
});

test.describe("the gap", () => {
  test("asks five questions, each named by an area the audit actually holds", async ({ page }) => {
    await page.goto("/");
    await page.locator("#gap").scrollIntoViewIfNeeded();

    const section = page.locator("#gap");
    await expect(section.getByRole("listitem")).toHaveCount(5);

    // The labels come from `LENS_LABELS`, so a category invented for the
    // marketing page cannot appear here without also existing in the product.
    for (const label of ["Offer", "Audience", "Acquisition", "Conversion", "Measurement"]) {
      await expect(section.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("arrives from both sides, and is fully there once reached", async ({ page }) => {
    await page.goto("/");
    await page.locator("#gap").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400);

    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll("#gap [data-reveal]")].filter(
          (el) => Number(getComputedStyle(el).opacity) < 0.99,
        ).length,
    );
    expect(hidden).toBe(0);

    // Six reveals in one section — the heading and the five questions — which
    // is the exception the page documents: everything else is one block, one
    // arrival.
    await expect(page.locator("#gap [data-reveal]")).toHaveCount(6);
  });
});

test.describe("the scan", () => {
  test("shows a finished scan of a product it recognised", async ({ page }) => {
    await page.goto("/");
    await page.locator("#scan").scrollIntoViewIfNeeded();

    const scan = page.locator("#scan");

    // The settled state, not the empty one. The component builds its picture
    // from operation + events + presentation together, and passing the last
    // two without the first renders six facets all saying "Detecting…" — which
    // is what the first attempt at this block did.
    await expect(scan).toContainText(/product scan . complete/i);
    await expect(scan).toContainText("What Vibe worked out");
    await expect(scan).not.toContainText("Detecting");
    await expect(scan).not.toContainText("Not observed");

    // Six facets, each one a thing worked out rather than a field filled in.
    for (const value of [
      "Web application",
      "Subscription signals",
      "AI builders and founders",
      "Next.js",
    ]) {
      await expect(scan.getByText(value, { exact: true }).first()).toBeVisible();
    }
  });

  test("still says what a scan cannot reach", async ({ page }) => {
    await page.goto("/");
    await page.locator("#scan").scrollIntoViewIfNeeded();

    /*
      The block's subject is the picture coming out, so the caveat is a line
      under it rather than four cards instead of it. It is still on the page:
      the strip names all four sources and marks the two Vibe fell short on.
    */
    const strip = page.locator("#scan [data-testid='source-coverage-strip']");
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute("data-gap", "live");
    await expect(page.locator("#scan")).toContainText(/behind your sign-in stays invisible/i);
  });

  test("offers nothing to press, because there is nothing here to press it on", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#scan").scrollIntoViewIfNeeded();

    /*
      The workspace's copy of this surface carries "Scan my product again", and
      the source rows carry "Scan again" and "Deep Scan · 25 Credits". Here
      there is no project to scan and no balance to charge, so every one of
      them is a control that cannot do what it says. `variant="showcase"` plus
      `canStart={false}` plus null remedies is what keeps this at zero.
    */
    await expect(page.locator("#scan a, #scan button")).toHaveCount(0);
    await expect(page.locator("#scan")).not.toContainText("Credits");
  });

  test("is a picture beside the words, not instead of them", async ({ page }) => {
    await page.goto("/");
    await page.locator("#scan").scrollIntoViewIfNeeded();

    /*
      This is a landing page and its job is to explain the modules. A visitor
      who has never used Vibe cannot infer what a Product Scan is from a picture
      of one, so the preview is `aria-hidden` and every fact in it is said in
      words in the tile beside it — which is also what stops a screen reader
      meeting the same six facets twice, once illegibly.
    */
    const preview = page.locator(".landing-scan-preview");
    await expect(preview).toHaveAttribute("aria-hidden", "true");

    const heading = page.locator("#scan-heading");
    await expect(heading).toBeVisible();
    expect(
      await heading.evaluate((el) => Boolean(el.closest(".landing-scan-preview"))),
      "the explanation must not live inside the picture",
    ).toBe(false);

    await expect(page.locator("#scan").getByRole("listitem")).toHaveCount(3);
  });

  test("scales the preview to its tile rather than past it", async ({ page }) => {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await page.locator("#scan").scrollIntoViewIfNeeded();

      /*
        A `transform` does not shrink an element's layout box, so the scan's
        render width would size the grid cell if the crop had no definite width
        — a 350px phone column measured 906 before `min-w-0` and `width: 100%`.
        And the scale is a plain number with the render width derived from it,
        because `calc(100cqw / 880)` is a *length* rather than a ratio: it made
        the height calc invalid and the tile grew to 1,139px of preview.
      */
      const fit = await page.locator(".landing-scan-preview-crop").evaluate((crop) => {
        const child = crop.firstElementChild as HTMLElement;
        return {
          crop: crop.getBoundingClientRect().width,
          painted: child.getBoundingClientRect().width,
        };
      });

      expect(fit.painted, `preview overflows its tile at ${width}px`).toBeLessThanOrEqual(
        fit.crop + 1,
      );
      expect(fit.painted, `preview leaves its tile half empty at ${width}px`).toBeGreaterThan(
        fit.crop - 4,
      );
    }
  });

  test("clips none of its own labels on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#scan").scrollIntoViewIfNeeded();

    /*
      Measured rather than eyeballed. The facet cards truncated four of six
      labels here — "Product t…", "Core feat…", "Audience…", "Brand / i…" — and
      the panel rows clipped "Audience signals" beside "AI builders and
      founders" at any cap the value column was given. Both are the product's
      own component, so both were fixed there rather than papered over here.

      **390 only, deliberately.** Beside the graph a facet card is a fixed
      10.75rem and truncating is what it is for, so the same assertion at 1440
      is measuring an intended ellipsis — and measuring it right on the boundary
      at that: it passed alone and failed under parallel load, which is the font
      race `expectNoHorizontalOverflow` documents, arriving in a third form.
    */
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll("#scan *")]
        .filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent),
    );
    expect(clipped).toEqual([]);
  });
});

test.describe("the walk", () => {
  test("numbers each module once, on the rail or inline but never both", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.locator("#scan").scrollIntoViewIfNeeded();

      /*
        The rail is a column of its own above `lg` and gone below it, where the
        number moves inline above the block. Both are in the DOM; exactly one is
        painted, and a reader seeing "01" twice would be counting a walk with
        two of every step.
      */
      const painted = await page.evaluate(
        () =>
          [...document.querySelectorAll("#scan span, #scan p")].filter(
            (el) => el.textContent?.trim() === "01" && el.getClientRects().length > 0,
          ).length,
      );
      expect(painted, `at ${width}px`).toBe(1);
    }
  });

  test("draws its segment to full height, and keeps it out of the reading", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("#scan").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400);

    // The line is the drawing of a structure the headings already carry, so it
    // is `aria-hidden` — and it has to have actually drawn, not sat at zero.
    const rail = page.locator("#scan .landing-step-rail");
    await expect(rail).toHaveAttribute("aria-hidden", "true");

    const drawn = await rail
      .locator("span")
      .last()
      .evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { height: box.height, transform: getComputedStyle(el).transform };
      });
    expect(drawn.height).toBeGreaterThan(200);
    expect(drawn.transform).not.toContain("matrix(1, 0, 0, 0,");
  });
});

test.describe("the hero's ground", () => {
  test("puts its light beside the card, not underneath it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const image = await page
      .locator(".landing-hero-field")
      .evaluate((el) => getComputedStyle(el).backgroundImage);

    /*
      This shipped faint twice, and the reason was geometry rather than opacity:
      a 46%×42% mint pool at `50% 52%` is 626px wide behind a 768px card that is
      opaque by design, so the atmosphere was painted entirely underneath the
      thing covering it. Sampled off the rendered page, the light beside the
      card read `6,12,13` against a `7,10,12` ground — the background was
      measurably there and invisible, and on a phone it read as missing.

      So the guard is about *where* the light is: pools off the centre line, and
      a grid mark that clears the threshold below which this ground swallows it.

      It reads the computed value rather than sampling pixels, and that is a
      real limit worth stating: it would not catch a light that is off-centre
      and still too weak to see. Decoding a screenshot needs an image library
      the browser suite does not have, so the pixel sampling stays a thing done
      by hand when this is changed — which is how both defects were found.
    */
    expect(image).toContain("rgba(0, 229, 160");

    const centres = [...image.matchAll(/at (\d+)% \d+%/g)].map((match) => Number(match[1]));
    expect(centres.length, "the field should carry more than one pool").toBeGreaterThan(1);
    expect(
      centres.some((centre) => centre <= 25 || centre >= 75),
      `every mint pool sits mid-page, where the card covers it: ${centres.join(", ")}`,
    ).toBe(true);

    const mark = await page
      .locator(".landing-hero-field")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--hero-field-mark"));
    /*
      Chromium serialises `rgb(255 255 255 / 0.13)` as `#ffffff21`, so the
      slash form is not what comes back — read both rather than the one that
      was written.
    */
    const hex = mark.trim().match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i);
    const alpha = hex
      ? parseInt(hex[1], 16) / 255
      : Number(mark.match(/\/\s*([\d.]+)\s*\)/)?.[1] ?? 0);
    expect(alpha, `grid mark ${mark} is below what this ground shows`).toBeGreaterThanOrEqual(0.12);
  });
});

test.describe("the ground under the walk", () => {
  test("carries atmosphere between the lit places, not only in them", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    /*
      Profiled down the left edge before this existed: 15–19 in the green
      channel through the hero, **12–13 for five hundred pixels** after it, then
      21–28 at the first module. A page that goes dark between its lit places is
      three pictures with gaps rather than one atmosphere.

      The fix is a `fixed` layer the size of the window, so every scroll position
      has ground under it and nothing has to be re-tuned when the page grows —
      an absolute one would have to place its light at percentages of a height
      that changes with every block added.

      Same limit as the hero's guard, and worth restating: this reads computed
      values, so it would not catch a layer that exists and is too weak. The
      profiling stays a thing done by hand.
    */
    const room = page.locator(".landing-room");
    await expect(room).toHaveCount(1);

    const image = await room.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(image).toContain("rgba(0, 229, 160");
    expect(await room.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  });

  test("lights consecutive modules from opposite sides", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("#scan").scrollIntoViewIfNeeded();

    // One pool per step, alternating, so a page of modules does not read as the
    // same patch stamped once each.
    const side = await page
      .locator("#scan .landing-step-field")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--step-side").trim());
    expect(["16%", "84%"]).toContain(side);
  });
});

test.describe("the business map, as a staircase", () => {
  test("walks all nine areas, named by the audit's own labels", async ({ page }) => {
    await page.goto("/");
    await page.locator("#brain").scrollIntoViewIfNeeded();

    const treads = page.locator("#brain li");
    await expect(treads).toHaveCount(9);

    // The labels come from `LENS_LABELS`, so an area invented for the landing
    // page cannot appear here without also existing in the product.
    for (const label of [
      "Offer",
      "Audience",
      "Revenue & Economics",
      "Acquisition",
      "Conversion",
      "Retention",
      "Measurement",
      "Business Readiness",
      "Scalability",
    ]) {
      await expect(page.locator("#brain").getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("scores nothing, because there is nothing connected to score", async ({ page }) => {
    await page.goto("/");
    await page.locator("#brain").scrollIntoViewIfNeeded();

    /*
      Nine orbs reading "Not assessed" is a strange thing to put on a landing
      page and the correct one: an area Vibe cannot see stays unscored rather
      than scoring zero, and that claim is the reason this block exists. A
      number on any orb here would be one nobody measured.
    */
    await expect(page.locator("#brain .business-brain-planet")).toHaveCount(9);
    const withNumbers = await page.evaluate(
      () =>
        [...document.querySelectorAll("#brain .business-brain-planet")].filter((el) =>
          /\d/.test(el.textContent ?? ""),
        ).length,
    );
    expect(withNumbers).toBe(0);
    await expect(page.locator("#brain").getByText("Not assessed")).toHaveCount(9);
  });

  test("alternates sides, and threads one orb to the next but not off the end", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#brain").scrollIntoViewIfNeeded();

    /*
      The alternation is the staircase. Measured as page-relative centres
      rather than read off a class, because the class could be right while the
      grid ordering puts both on the same side.
    */
    const centres = await page
      .locator("#brain .business-brain-planet")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
    const mid = Math.max(...centres) / 2 + Math.min(...centres) / 2;
    const sides = centres.map((left) => (left < mid ? "L" : "R"));
    expect(sides.join("")).toBe("LRLRLRLRL");

    // Eight threads for nine orbs: a curve off the last one leads nowhere.
    await expect(page.locator("#brain li > svg")).toHaveCount(8);
  });
});
