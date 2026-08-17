import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

/**
 * Renders the Audit → Moves → Prepared loop UI-S2 changed, for a human to look
 * at (§48).
 *
 * Not a test. It asserts nothing — it exists so the screens get *seen*, because
 * "does one action dominate?" and "are there too many chips?" are questions a
 * passing assertion is perfectly happy to ignore.
 *
 * Point it at a server already running with `VIBE_E2E_FIXTURES=1`.
 * `CHROMIUM_PATH` is an escape hatch for environments whose installed Chromium
 * does not match the one @playwright/test pins.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3311";
const OUT = process.env.OUT_DIR ?? "screenshots";
const EXECUTABLE = process.env.CHROMIUM_PATH;

const SHOTS = [
  ["audit-priorities-1440", "/e2e/audit-synthesis", 1440, 1000, true],
  ["audit-priorities-390", "/e2e/audit-synthesis", 390, 844, true],
  ["moves-ranked-1440", "/e2e/moves_ranked", 1440, 1000, true],
  ["moves-ranked-390", "/e2e/moves_ranked", 390, 844, true],
  ["moves-from-conclusion-1440", "/e2e/moves_from_conclusion", 1440, 1000, true],
  ["moves-from-conclusion-390", "/e2e/moves_from_conclusion", 390, 844, true],
  ["moves-none-1440", "/e2e/moves_none", 1440, 600, false],
  ["moves-stale-1440", "/e2e/moves_stale", 1440, 1000, true],
  ["prepared-focus-1440", "/e2e/merge_ready", 1440, 1000, true],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext();

// Nothing leaves the machine, same rule as the browser suite.
await context.route("**/*", async (route) => {
  const { hostname } = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(hostname)) return route.continue();
  return route.abort();
});

for (const [name, path, width, height, fullPage] of SHOTS) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  // One card expanded, so the "Why now?" demotion is visible rather than assumed.
  if (name === "moves-why-now-1440") await page.getByText("Why now?").first().click();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(`${name.padEnd(32)} overflow=${overflow}px`);
  await page.close();
}

// The disclosure open, which no other shot shows.
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${BASE}/e2e/moves_ranked`, { waitUntil: "networkidle" }).catch(() => {});
await page.getByText("Why now?").first().click();
await page.screenshot({ path: `${OUT}/moves-why-now-1440.png`, fullPage: true });
console.log("moves-why-now-1440              (disclosure open)");
await page.close();

await browser.close();
