import { defineConfig, devices } from "@playwright/test";

/**
 * The browser suite (Sprint 11C.1).
 *
 * ## Why a production build rather than `next dev`
 *
 * Because the bugs this exists to catch live at the server/client boundary, and
 * that boundary behaves differently in the two modes. `next dev` re-renders
 * eagerly and hides staleness that a built server does not; the Sprint 11A
 * defects were all "the server render was behind and the panel papered over
 * it", which is precisely the class a dev server is worst at reproducing.
 *
 * The cost is a build before the first test. That is acceptable for a suite
 * this small, and it is the same code path a deployment runs.
 *
 * ## Why chromium only
 *
 * Because nothing here is about rendering engines. It is about whether the
 * screen says what the domain says. A second engine would double the runtime
 * to re-answer a question the first one already answered.
 *
 * ## Retries
 *
 * One in CI, and only so a flake produces a trace to read — never as evidence
 * that a test is healthy. A test that needs the retry is a defect in the test,
 * and the trace is how it gets fixed rather than tolerated.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  // Deliberately short. These pages perform no provider call, no GitHub call
  // and no database query, so anything approaching a timeout is a defect and
  // should be reported as one rather than waited out.
  timeout: 15_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: "http://127.0.0.1:3311",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // `VIBE_E2E_FIXTURES` is what makes the fixture route exist at all. It is
    // set here and nowhere else — not in `.env`, not in Vercel — so a deployed
    // build has no fixture surface.
    //
    // The Supabase values are deliberate placeholders for a project that does
    // not exist. They are not credentials and they are not a test account:
    // they exist so the auth proxy *runs* (without them it passes every
    // request through unconfigured, and the guard redirects can't be observed
    // at all), while every call to Supabase fails at DNS. That makes the
    // signed-out half of auth fully exercisable and completely deterministic.
    //
    // What it cannot exercise is anything requiring a real session — a
    // successful sign-in, session persistence across a restart, or the
    // neutral password-reset confirmation. Those are covered by unit tests and
    // must be dogfooded against a real project; see
    // docs/setup/supabase-auth.md.
    command:
      "VIBE_E2E_FIXTURES=1 " +
      "NEXT_PUBLIC_SUPABASE_URL=https://e2e-placeholder.supabase.co " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-placeholder-anon-key " +
      "pnpm exec next start --port 3311",
    url: "http://127.0.0.1:3311/e2e/merge_ready",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
