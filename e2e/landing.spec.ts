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

    /*
      Walked in viewport-sized steps rather than jumped element to element.

      `scrollIntoViewIfNeeded` per block is an instant jump, and once the page
      grew past a certain length one jump cleared a whole block: the observer
      is evaluated at the position it lands on, so a block that was below the
      viewport before the jump and above it afterwards was never once inside
      one. That is an artefact of jumping — a reader scrolling produces a
      position every frame — and it was hiding the question this test asks,
      which is whether a *scroll* brings every block up.
    */
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.6);
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    });
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

test.describe("the move", () => {
  test("shows what it set aside to get to one", async ({ page }) => {
    await page.goto("/");
    await page.locator("#move").scrollIntoViewIfNeeded();

    /*
      A single card would be a claim with nothing behind it. The three above it
      are the findings Vibe did *not* pick, each carrying the reason it ranks
      lower — which is the only thing that makes "one prioritized move" read as
      a judgement rather than as a product that found exactly one problem.
    */
    await expect(page.locator("#move ol > li")).toHaveCount(3);
    for (const why of [
      "Worth fixing, but it changes nothing on its own",
      "Matters after people arrive and pay",
      "Cheaper to fix once the offer is decided",
    ]) {
      await expect(page.locator("#move").getByText(why)).toBeVisible();
    }

    // And exactly one winner, drawn by the product's own card — which renders
    // as an `article`, so the locator asks for the element rather than for a
    // test hook the component does not carry.
    await expect(page.locator("#move article")).toHaveCount(1);
    await expect(page.locator("#move article")).toContainText("Decide how customers pay");
  });

  test("keeps every set-aside finding readable, not decorative", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#move").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);

    /*
      The receding stack fades, and the block's own argument is that these are
      sentences rather than decoration — so they have to stay legible. Measured
      off the rendered page, the first version's third row came out at 4.10:1
      against its ground, under AA for body text. The floor is asserted as the
      effective opacity, which is what the pixels followed.
    */
    const opacities = await page
      .locator("#move ol > li > [data-reveal] > div")
      .evaluateAll((els) => els.map((el) => Number(getComputedStyle(el).opacity)));

    expect(opacities).toHaveLength(3);
    for (const [index, value] of opacities.entries()) {
      expect(value, `set-aside finding ${index + 1} is too faint to read`).toBeGreaterThanOrEqual(
        0.58,
      );
    }
    // Still a recession: they must not all be at full strength either.
    expect(opacities[0]).toBeGreaterThan(opacities[2]);
  });

  test("says a Move is a proposal, not a thing already running", async ({ page }) => {
    await page.goto("/");
    await page.locator("#move").scrollIntoViewIfNeeded();

    // Rule 54: model output is an opinion, never authority. The page says the
    // thing the architecture already enforces.
    await expect(page.locator("#move")).toContainText(/A Move is a proposal/i);
    await expect(page.locator("#move")).toContainText(/until you say so/i);
  });
});

/*
 * Step four: the Agent, drawn as a passage with gates across it.
 *
 * The block's whole claim is the shape — three barriers that part as they are
 * reached, and a fourth that does not part at all — so the guards measure the
 * drawing as well as reading the words. A page that said "the last gate is
 * you" while animating it open would be contradicting the architecture in the
 * one place a founder is looking for reassurance.
 */
test.describe("the agent, and its gates", () => {
  /** Where each gate leaf sits once the block has been walked past. */
  async function gateLeaves(page: import("@playwright/test").Page) {
    return page.locator("#agent [data-gate-leaf]").evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    );
  }

  test("names four stages, and what stops the run at each gate", async ({ page }) => {
    await page.goto("/");
    const agent = page.locator("#agent");
    await agent.scrollIntoViewIfNeeded();

    for (const stage of ["Understand", "Build", "Validate", "Preview"]) {
      await expect(agent.getByText(stage, { exact: true })).toBeVisible();
    }

    /*
      Every gate carries its failure. A gate that only ever passes is
      decoration, and each of these is a rule this repository enforces: a moved
      branch blocks rather than triggering merge reasoning (56), a workspace
      reading Vibe cannot complete fails the run instead of becoming a partial
      change (77), and a validation that passes authorizes nothing (66).
    */
    await expect(agent).toContainText(/A branch that moved stops the run/i);
    await expect(agent).toContainText(/never takes the agent's account of its own work/i);
    await expect(agent).toContainText(/never that the change is safe, correct or ready/i);
  });

  test("opens three gates and leaves the fourth shut", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#agent").scrollIntoViewIfNeeded();
    // Walk the whole block, so every gate has been reached by the viewport.
    await page.evaluate(async () => {
      const el = document.querySelector("#agent") as HTMLElement;
      const top = el.getBoundingClientRect().top + window.scrollY;
      for (let y = top - 400; y < top + el.scrollHeight + 400; y += 300) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    });
    await page.waitForTimeout(1000);

    const leaves = await gateLeaves(page);
    expect(leaves).toHaveLength(8);

    // Three gaps a run passes through…
    for (let gate = 0; gate < 3; gate += 1) {
      const gap = leaves[gate * 2 + 1].left - leaves[gate * 2].right;
      expect(gap, `gate ${gate + 1} did not open`).toBeGreaterThan(200);
    }

    // …and one that is still closed, because nothing inside this product opens
    // it. Rules 58, 67 and 70: the default branch moves for a human approval
    // bound to one exact commit, or it does not move.
    const shut = leaves[7].left - leaves[6].right;
    expect(Math.abs(shut), "the last gate is not drawn shut").toBeLessThanOrEqual(2);
  });

  test("draws the same open gates for a reader who asked for no motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);

    /*
      Deliberately without scrolling to the block. A gate that only opens once
      it is reached is a gate this reader never sees open, and the whole
      picture would then say four shut gates beside a heading that says three
      of them are not.
    */
    const leaves = await gateLeaves(page);
    const gap = leaves[1].left - leaves[0].right;
    expect(gap, "reduced motion left the first gate closed").toBeGreaterThan(200);
    expect(Math.abs(leaves[7].left - leaves[6].right)).toBeLessThanOrEqual(2);
  });

  test("names the path it was not allowed to touch", async ({ page }) => {
    await page.goto("/");
    const agent = page.locator("#agent");
    await agent.scrollIntoViewIfNeeded();

    // The one fact about a run that no diff can carry: a path the agent offered
    // and policy refused. It is a state, not a warning.
    await expect(agent.getByTestId("agent-run-files")).toBeVisible();
    await expect(agent).toContainText(".env.local");
    await expect(agent).toContainText("Sensitive path policy");
  });

  test("never lets a merge read as a deployment", async ({ page }) => {
    await page.goto("/");
    const agent = page.locator("#agent");
    await agent.scrollIntoViewIfNeeded();

    // Rule 71, then rule 74 — both halves, because either alone is misleading.
    await expect(agent).toContainText(/fast-forwards your default branch/i);
    await expect(agent).toContainText(/It never merges, rebases, forces or deletes/i);
    await expect(agent).toContainText(/does not mean deployed/i);
    await expect(agent).toContainText(/can still start your own pipeline/i);

    // And no control that would imply Vibe ships anything. None of these exist
    // anywhere in the product, so none of them may exist on the page selling it.
    for (const word of ["Deploy", "Ship it", "Publish", "Go live"]) {
      await expect(agent.getByRole("button", { name: word })).toHaveCount(0);
      await expect(agent.getByRole("link", { name: word })).toHaveCount(0);
    }
  });
});

/*
 * Step five: Nova, met as a thread.
 *
 * The block's argument is that a co-founder who only reports good news is one
 * you cannot use to make a decision — so the guards check the two things that
 * would quietly undo it: that the sentences are the product's own rather than
 * a marketing rewrite, and that the register beside each is the product's
 * reading of the moment rather than a colour chosen to look calm.
 */
test.describe("meeting Nova on the walk", () => {
  test("says the product's own sentences, not sentences written for a marketing page", async ({
    page,
  }) => {
    await page.goto("/");
    const nova = page.locator("#nova");
    await nova.scrollIntoViewIfNeeded();

    /*
      These five are `MESSAGE_FOR_CANDIDATE`'s, reached through
      `novaCandidateMessage` — the accessor that hands out one sentence per
      candidate and cannot be iterated. Asserted as text so that rewording
      Nova's voice fails here, which is the point: her words may change, and
      when they do this page must change with them rather than keeping a
      flattering copy of the old ones.
    */
    for (const sentence of [
      "There is a change waiting for you to look at.",
      "I stopped part-way and need something from you.",
      "A check on one of your changes did not pass.",
      "What I know about your code is older than your code.",
      "Nothing needs you right now.",
    ]) {
      await expect(nova.locator(".bubble").getByText(sentence, { exact: true })).toBeVisible();
    }

    // A bubble is speech and only speech, on this page as in the product.
    await expect(nova.locator(".bubble").getByRole("button")).toHaveCount(0);
    await expect(nova.locator(".bubble").getByRole("link")).toHaveCount(0);
  });

  test("gives each moment the register the product gives it", async ({ page }) => {
    await page.goto("/");
    const nova = page.locator("#nova");
    await nova.scrollIntoViewIfNeeded();

    const bubbles = await nova.locator(".bubble").evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent ?? "",
        classes: el.className,
      })),
    );
    expect(bubbles).toHaveLength(5);

    const of = (fragment: string) => bubbles.find((bubble) => bubble.text.includes(fragment));

    /*
      A check that ran and returned non-zero is `problem` and closed — the
      checks have an answer. A run suspended on a person is `waiting` and
      **open**, drawn as a dashed contour, because the loop is still hanging.
      Rendering the second as the first would be the "less bad" reading the
      product's own status vocabulary was rewritten to stop.
    */
    expect(of("did not pass")?.classes).toContain("bubble-problem");
    expect(of("did not pass")?.classes).not.toContain("bubble-open");
    expect(of("need something from you")?.classes).toContain("bubble-waiting");
    expect(of("need something from you")?.classes).toContain("bubble-open");
    // Nothing to do is a plain fact and carries no alarm at all.
    expect(of("Nothing needs you right now")?.classes).toContain("bubble-neutral");
  });

  test("holds her introduction until somebody is there to see it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    /*
      `NovaPresence introduce` assembles on mount, and on an endless scroll
      every block mounts at load — so without this the one entrance the
      component exists for played six thousand pixels above the reader.
    */
    const mark = page.locator("[data-nova-entrance]");
    await expect(mark).toHaveAttribute("data-nova-entrance", "held");

    await page.locator("#nova").scrollIntoViewIfNeeded();
    await expect(mark).toHaveAttribute("data-nova-entrance", "arrived");
  });

  test("never assembles the mark for a reader who asked for no motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    /*
      Asserted *after* the block has been reached, not at first paint. At first
      paint the attribute reads `drawn` because the server drew it, so a test
      that looked then would pass whatever the client went on to do — measured:
      removing the reduced-motion branch entirely left this green.

      The property is that there is no assembly coming and none arrives: the
      mark stays the server's, drawn and still, however far this reader
      scrolls. Holding it back until it was scrolled to would be movement of a
      different kind — an element appearing on a page that asked for none.
    */
    const mark = page.locator("[data-nova-entrance]");
    await page.locator("#nova").scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);

    await expect(mark).toHaveAttribute("data-nova-entrance", "drawn");
    await expect(mark.locator("[data-nova-presence]")).toBeVisible();
  });
});

/*
 * Step six: the outcome, as a ladder of three claims.
 *
 * This is the block a marketing page is most tempted to soften, because the
 * honest version ends on "not measured". The guards hold the three things that
 * would quietly undo it: the word Vibe never renders, the check that did not
 * pass staying on the list, and the third rung staying empty.
 */
test.describe("the outcome ladder", () => {
  test("says what it read back, and refuses the word deployed", async ({ page }) => {
    await page.goto("/");
    const outcome = page.locator("#outcome");
    await outcome.scrollIntoViewIfNeeded();

    await expect(outcome).toContainText(/points at the commit you approved/i);

    /*
      Vibe calls no deployment provider and has no provenance for which build
      is serving. Observing the expected behaviour is consistent with the new
      build being live and is not evidence of it — so the block says so on the
      rung where a reader would otherwise assume it, and the word never appears
      as a claim anywhere in the section.
    */
    await expect(outcome).toContainText(/does not say deployed/i);
    const claims = await outcome.innerText();
    expect(claims).not.toMatch(/\b(is live|deployment succeeded|successfully deployed)\b/i);
  });

  test("leaves the check that was not observed on the list", async ({ page }) => {
    await page.goto("/");
    const outcome = page.locator("#outcome");
    await outcome.scrollIntoViewIfNeeded();

    /*
      A card showing only its passing lines turns a partial outcome into a
      verified one by omission, and three ticks is exactly what a landing page
      wants to show. The labels are the product's own — "/pricing answers",
      never "/pricing works", because that check cannot tell anybody that.

      Asserted against the **list**, not against the section. The first version
      of this test asked whether the words "not observed" appeared anywhere in
      the block, and the paragraph below the list says them — so deleting the
      unobserved row left it green. Three of its four assertions were reading
      prose about the thing rather than the thing.
    */
    const lines = outcome.locator("ul li");
    await expect(lines).toHaveCount(3);
    await expect(lines.filter({ hasText: "not observed" })).toHaveCount(1);
    await expect(lines.first()).toContainText("/pricing answers");

    await expect(outcome).toContainText(/never left off the list/i);
    await expect(outcome).toContainText(/Not observed is not a failed deployment/i);
  });

  test("draws the third rung empty, and never fills it with a result", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const outcome = page.locator("#outcome");
    await outcome.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    const rungs = outcome.locator("ol > li");
    await expect(rungs).toHaveCount(3);

    /*
      Drawn open rather than described as open: a dashed contour is this
      product's mark for a loop that has not closed, and the third rung carries
      no fill because there is nothing in it. Measured off the rendered page so
      a redesign that quietly gives it a surface fails here.
    */
    const styles = await rungs.evaluateAll((items) =>
      items.map((item) => {
        const card = item.querySelector("[data-reveal] > div") as HTMLElement;
        const computed = getComputedStyle(card);
        return { border: computed.borderTopStyle, background: computed.backgroundColor };
      }),
    );
    expect(styles[0].border).toBe("solid");
    expect(styles[1].border).toBe("solid");
    expect(styles[2].border).toBe("dashed");
    expect(styles[2].background).toBe("rgba(0, 0, 0, 0)");

    // And it says the thing that makes an unmeasured change unmeasured rather
    // than a null result.
    await expect(outcome).toContainText("Not measured — no source");
    await expect(outcome).toContainText(/never becomes "no impact"/i);
  });
});

/*
 * The nav, out of the way on the way down.
 *
 * The founder, on the endless scroll: it gets in the way. The bar leaves when a
 * reader is going down and comes back when they turn around — and the two
 * things that would make that a bad trade are held here: it never hides a
 * control the keyboard is inside, and a reader who asked for no movement keeps
 * it where it was.
 */
test.describe("the marketing header", () => {
  const bar = (page: import("@playwright/test").Page) => page.locator("[data-marketing-header]");

  /** Scroll in steps, the way a reader does — a jump gives one event and no direction. */
  async function drift(page: import("@playwright/test").Page, distance: number) {
    await page.evaluate(async (total) => {
      const step = total > 0 ? 120 : -120;
      for (let moved = 0; Math.abs(moved) < Math.abs(total); moved += step) {
        window.scrollBy(0, step);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      }
    }, distance);
    await page.waitForTimeout(250);
  }

  test("leaves on the way down and comes back on the way up", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    // At the top it is where somebody looking for it expects it.
    await expect(bar(page)).toHaveAttribute("data-marketing-header", "shown");
    const seated = await bar(page).boundingBox();
    expect(seated?.y).toBe(0);

    await drift(page, 1400);
    await expect(bar(page)).toHaveAttribute("data-marketing-header", "hidden");
    // Not merely labelled hidden: measured off the page, above its own top edge.
    const gone = await bar(page).boundingBox();
    expect(gone?.y ?? 0).toBeLessThan(0);

    await drift(page, -400);
    await expect(bar(page)).toHaveAttribute("data-marketing-header", "shown");
    const back = await bar(page).boundingBox();
    expect(back?.y).toBe(0);
  });

  test("never leaves the keyboard inside a bar nobody can see", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await drift(page, 1400);
    await expect(bar(page)).toHaveAttribute("data-marketing-header", "hidden");

    /*
      `preventScroll`, and it is the whole test. A plain `.focus()` on an
      element the browser considers off screen scrolls the window to it — which
      scrolls *up*, which reveals the bar through the ordinary direction rule.
      Measured: the first version of this test passed with the focus handler
      deleted, because the browser had done the revealing.
    */
    const before = await page.evaluate(() => window.scrollY);
    await bar(page)
      .getByRole("link", { name: "Get started" })
      .evaluate((link: HTMLElement) => link.focus({ preventScroll: true }));

    await expect(bar(page)).toHaveAttribute("data-marketing-header", "shown");
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });

  test("stays put for a reader who asked for no movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    /*
      Reduced motion is not a degraded experience: it is the same information
      without the movement. A bar that slid away would take Sign in and Get
      started off the screen of the one reader who asked for nothing to move.
    */
    await drift(page, 1400);
    await expect(bar(page)).toHaveAttribute("data-marketing-header", "shown");
    expect((await bar(page).boundingBox())?.y).toBe(0);
  });
});

/*
 * Step seven: the boundary.
 *
 * The block's picture is a line with some things crossing it and others
 * stopping at it, and which side a path falls on is decided by the product's
 * own `isSensitivePath` at render time rather than by a list typed into a
 * marketing file. So the guards check the routing and the line, not the prose
 * about them.
 */
test.describe("the boundary", () => {
  test("lets the policy decide which paths are refused", async ({ page }) => {
    await page.goto("/");
    const boundary = page.locator("#boundary");
    await boundary.scrollIntoViewIfNeeded();

    const rows = boundary.locator("ul > li");
    await expect(rows).toHaveCount(5);

    /*
      Two refused and three crossing, and the two are the ones the policy calls
      sensitive. A page that promised "we never read .env" would be a sentence;
      this asks the function, so widening the policy moves a row on its own.
    */
    const refused = rows.filter({ hasText: "Never opened" });
    await expect(refused).toHaveCount(2);
    await expect(refused.first()).toContainText(".env.local");
    await expect(refused.nth(1)).toContainText("certs/private.key");

    // And the three that cross arrive as sentences about the product.
    await expect(rows.filter({ hasText: "A Next.js application" })).toHaveCount(1);
    await expect(boundary).toContainText("The path, never the text.");

    /*
      The treatment is read off the policy, not off the copy. Asserting only the
      words "Never opened" tests the row's own text — measured: a mutation that
      decoupled the strike-through from `isSensitivePath` left that green, and
      the two refused paths went on reading as ordinary ones. The struck rows
      must be exactly the sensitive ones.
    */
    const struck = await rows.evaluateAll((items) =>
      items.map((item) => {
        const path = item.querySelector("p") as HTMLElement;
        return {
          path: path.textContent ?? "",
          struck: getComputedStyle(path).textDecorationLine.includes("line-through"),
        };
      }),
    );
    expect(struck.filter((row) => row.struck).map((row) => row.path)).toEqual([
      ".env.local",
      "certs/private.key",
    ]);
  });

  test("draws one line for all five rows to meet", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#boundary").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    /*
      The shape is the argument here as everywhere on this page, so the rule is
      measured rather than assumed: five segments, all at one x, and each tall
      enough to reach its neighbours — which is what makes five rows read as one
      boundary instead of five ticks.
    */
    const marks = await page
      .locator("#boundary li span[aria-hidden] > span:first-child")
      .evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          return {
            x: Math.round(box.left),
            top: Math.round(box.top),
            bottom: Math.round(box.bottom),
          };
        }),
      );

    expect(marks).toHaveLength(5);
    const xs = new Set(marks.map((mark) => mark.x));
    expect(xs.size, "the boundary is not one line").toBe(1);

    // Each segment reaches the next. A fixed minimum height would be a number
    // nobody chose; touching is the property that makes five segments one line.
    for (let index = 1; index < marks.length; index += 1) {
      const gap = marks[index].top - marks[index - 1].bottom;
      expect(gap, `the boundary breaks before row ${index + 1}`).toBeLessThanOrEqual(1);
    }
  });

  test("says what is kept, and what is never kept", async ({ page }) => {
    await page.goto("/");
    const boundary = page.locator("#boundary");
    await boundary.scrollIntoViewIfNeeded();

    // Rule 26 on one side, rule 37 on the other — the second half is the one a
    // marketing page would leave out, and the query-string clause is the part
    // nobody would think to ask about.
    await expect(boundary).toContainText(/evidence paths that justify it/i);
    await expect(boundary).toContainText(/no cookies, and no query strings/i);
    await expect(boundary).toContainText(/no clone, no checkout and no working tree/i);
  });
});
