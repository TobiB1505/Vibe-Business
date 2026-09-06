import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

/**
 * Renders the three Nova Home direction studies, for a human to look at (S0).
 *
 * Not a test. It asserts nothing except the one thing a screenshot cannot
 * show — that the page does not scroll sideways — because the question these
 * images exist to answer ("which of these three should Vibe become?") is not
 * one an assertion can hold an opinion about.
 *
 * Point it at a server already running with `VIBE_E2E_FIXTURES=1`.
 * `CHROMIUM_PATH` is an escape hatch for environments whose installed Chromium
 * does not match the one @playwright/test pins.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3311";
const OUT = process.env.OUT_DIR ?? "screenshots/design-studies";
const EXECUTABLE = process.env.CHROMIUM_PATH;

const STUDIES = [
  ["a-depth", "/e2e/study-a-depth"],
  ["b-precision", "/e2e/study-b-precision"],
  ["c-editorial", "/e2e/study-c-editorial"],
];

const VIEWPORTS = [
  ["1440", 1440, 1100],
  ["390", 390, 844],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({
  // The studies are a judgement about material, and material is what a
  // device-pixel-ratio of 1 destroys: glass edges, hairlines and the grain all
  // live in the half-pixels a 1x capture throws away.
  deviceScaleFactor: 2,
});

// Nothing leaves the machine, same rule as the browser suite.
await context.route("**/*", async (route) => {
  const { hostname } = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(hostname)) return route.continue();
  return route.abort();
});

for (const [study, path] of STUDIES) {
  for (const [tag, width, height] of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    // The entrance is staggered across five elements at 70ms each and runs for
    // up to 780ms in study C. Capturing mid-choreography would photograph a
    // state no founder ever sees.
    await page.waitForTimeout(1600);
    /*
      Not `fullPage`. The atmosphere is `position: fixed` — it should not
      scroll away from the content it lights — and a full-page capture paints
      fixed layers at the *original* viewport height, leaving a hard seam
      across every study where the gradient stops. Growing the viewport to the
      document instead captures one honest frame of what a tall screen shows.
    */
    const full = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width, height: Math.min(full, 4000) });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${study}-${tag}.png` });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(`${`${study}-${tag}`.padEnd(24)} overflow=${overflow}px`);
    await page.close();
  }
}

await browser.close();
