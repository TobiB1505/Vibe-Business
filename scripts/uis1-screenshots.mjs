import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

/**
 * Renders the surfaces UI-S1 changed, for a human to look at (§24).
 *
 * Not a test. It asserts nothing and can fail nothing — it exists so the
 * screens get *seen*, because hierarchy, wrapping, contrast and stray developer
 * language are all things a passing assertion is perfectly happy to ignore.
 *
 * Point it at a server already running with `VIBE_E2E_FIXTURES=1`.
 *
 * `CHROMIUM_PATH` is an escape hatch for environments whose installed Chromium
 * build does not match the one @playwright/test pins. Left unset, Playwright
 * resolves its own browser as usual.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3311";
const OUT = process.env.OUT_DIR ?? "screenshots";
const EXECUTABLE = process.env.CHROMIUM_PATH;

const SHOTS = [
  ["landing-1440", "/", 1440, 900, true],
  ["landing-390", "/", 390, 844, true],
  ["signup-1440", "/signup", 1440, 900, false],
  ["privacy-1440", "/privacy", 1440, 900, true],
  ["terms-390", "/terms", 390, 844, true],
  ["onboarding-parked-1440", "/e2e/onboarding_audit_parked", 1440, 900, false],
  ["onboarding-parked-390", "/e2e/onboarding_audit_parked", 390, 844, false],
  ["onboarding-awaiting-1440", "/e2e/onboarding_audit_awaiting", 1440, 900, false],
  ["onboarding-running-1440", "/e2e/onboarding_running", 1440, 900, false],
  ["onboarding-running-late-1440", "/e2e/onboarding_running_late", 1440, 900, false],
  ["onboarding-stalled-1440", "/e2e/onboarding_stalled", 1440, 900, false],
  ["onboarding-failed-1440", "/e2e/onboarding_failed", 1440, 900, false],
  ["onboarding-failed-unclear-1440", "/e2e/onboarding_failed_unclear", 1440, 900, false],
  ["logo-fallback-1440", "/e2e/onboarding_logo_broken", 1440, 400, false],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext();

// Same rule as the browser suite: nothing leaves the machine, so a customer's
// dead logo fails here exactly as it would for them.
await context.route("**/*", async (route) => {
  const { hostname } = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(hostname)) return route.continue();
  return route.abort();
});

for (const [name, path, width, height, fullPage] of SHOTS) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(`${name.padEnd(34)} overflow=${overflow}px`);
  await page.close();
}

await browser.close();
