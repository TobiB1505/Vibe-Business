import type { SandboxCommand } from "@/modules/validation/commands";

/**
 * What a browser sandbox is made of, and the commands that make it
 * (ADR 0076).
 *
 * Separate from `provider.ts` so the shape of a browser VM — its ports, its
 * flags, its working directory — is one readable list rather than something
 * assembled at four call sites. Every value here is Vibe's own; not one of them
 * is reachable from a customer, a repository, a model or a URL.
 */

export const BROWSER_SANDBOX = {
  /**
   * The one inbound port, served by the guard.
   *
   * Chromium's own DevTools port is deliberately **not** in the sandbox's
   * `ports` list. It listens on loopback and stays there.
   */
  publicPort: 3900,
  /** Loopback only. Reachable by the guard, by nothing outside the VM. */
  devtoolsPort: 9222,
  /** Where the runtime image puts Chromium and the guard's dependencies. */
  root: "/vibe-browser",
  /**
   * The viewport, and therefore the frame size a person sees.
   *
   * It was 1280×800, and a founder on a high-density display said the picture
   * looked wrong "resolution-wise". They were right twice over. The dialog
   * lays the frame out about 1120 CSS pixels wide, which on a 2× screen is
   * 2240 device pixels — a 1280-pixel JPEG stretched most of the way to
   * double. And 1280 is a *narrow* desktop: an application with a sidebar
   * renders its cramped layout there, so the analysis was reading a product
   * shape its customers do not see.
   *
   * 1920×1200 fixes both and keeps 16:10 exactly, which matters because the
   * frame's own aspect ratio is what the dialog's box is now sized from.
   *
   * Matched to the screencast ceiling in the guard — asserted by
   * `guard-program.test.ts`, not merely stated here, because the guard holds
   * these as literals (it contains no interpolation, by design) and a comment
   * is not a constraint. A window larger than the cast would be scaled down
   * and make a person's click land somewhere other than where they aimed.
   */
  viewport: { width: 1920, height: 1200 },
  /**
   * The window the founder signs in through, by the shape of their device.
   *
   * A phone driving a 1920-pixel desktop page is the fiddliest part of this
   * whole flow: the layout a founder is tapping at is one their own phone
   * users never see, at a scale where a password field is a few pixels tall.
   * So the *login* window follows the device.
   *
   * The **analysis** does not. `connectReadOnly` puts the page back to
   * `viewport` before it reads anything, because a mobile layout hides its
   * navigation behind a menu — a phone-started scan would find fewer links and
   * fewer surfaces, and two scans of the same product would stop being
   * comparable depending on which device happened to start them.
   *
   * A closed set, not a size: nothing a client sends becomes a number on
   * Chromium's command line.
   *
   * The mobile shape is a current large phone in CSS pixels. Both must stay at
   * or under `viewport`, which is the screencast ceiling — asserted by
   * `guard-program.test.ts`, because a window larger than the cast is scaled
   * down and a scaled frame puts a person's tap somewhere they did not aim.
   */
  loginViewports: {
    desktop: { width: 1920, height: 1200 },
    mobile: { width: 430, height: 932 },
  },
  /**
   * Two vCPUs.
   *
   * Lower than validation's four, and the reason is what this sandbox spends
   * its time doing: most of a Deep Scan's wall clock is a person reading a
   * login form, with one browser tab rendering one page. Nothing races a step
   * deadline here.
   *
   * Carried into every cost estimate rather than assumed at the point of
   * arithmetic, because CPU and memory both scale with it — a profile that
   * moved to four would otherwise silently restate every historical figure.
   */
  vcpus: 2,
} as const;

/**
 * Chromium's flags, and why each one is load-bearing.
 *
 * A short list on purpose. Every flag is either what makes the browser usable
 * inside a microVM, or what stops it carrying something between sessions.
 */
export type BrowserViewportName = keyof typeof BROWSER_SANDBOX.loginViewports;

export function chromiumCommand(viewport: BrowserViewportName = "desktop"): SandboxCommand {
  // Indexed from the closed set, so the two numbers below are this file's,
  // whatever a caller passed.
  const window = BROWSER_SANDBOX.loginViewports[viewport] ?? BROWSER_SANDBOX.loginViewports.desktop;
  return {
    command: `${BROWSER_SANDBOX.root}/chromium`,
    args: [
      // Loopback. The guard is what the outside reaches, and the guard is the
      // only thing that can reach this.
      `--remote-debugging-port=${BROWSER_SANDBOX.devtoolsPort}`,
      "--remote-debugging-address=127.0.0.1",
      // Headless, but a full render: the person is looking at these pixels, so
      // "new" rather than the old headless that renders differently from what
      // their customers see.
      "--headless=new",
      `--window-size=${window.width},${window.height}`,
      // A microVM has no seccomp sandbox to nest inside, and Chromium refuses
      // to start without either. The isolation boundary here is the VM itself.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Nothing survives this session. The profile is a directory in a VM that
      // is destroyed with it, and ADR 0012's promise — the browser is thrown
      // away, nothing about the login is kept — is what this enforces.
      `--user-data-dir=${BROWSER_SANDBOX.root}/profile`,
      /*
       * `--incognito` is deliberately absent, and its absence is load-bearing.
       *
       * It would have put the person's login in an incognito browser context
       * while `connectReadOnly` reads `browser.contexts()[0]` — which, over
       * CDP, is the default context. The analysis would then have run against
       * a profile that never signed in, and reported a signed-out product with
       * complete confidence. `connector.ts` already carries a comment about
       * exactly this mistake in its other form.
       *
       * It also buys nothing here. Incognito exists so a browser does not keep
       * things between sessions; this profile is a directory in a microVM that
       * is destroyed with the session, so there is no "between".
       */
      "--disable-background-networking",
      // No telemetry, no crash upload: a crash report from a browser someone is
      // logged into is a screenshot of their product going to a third party.
      "--disable-breakpad",
      "--no-first-run",
      "--no-default-browser-check",
      // One page target, so the guard's "the first page" is "the page".
      "about:blank",
    ],
  };
}

/** Starts the guard. Its configuration arrives in the environment, never here. */
export function guardCommand(): SandboxCommand {
  return { command: "node", args: [`${BROWSER_SANDBOX.root}/guard.mjs`] };
}

/**
 * A sandbox name, derived from the session id Vibe generated.
 *
 * Carries no customer identifier — not a project id, not a user id, not a
 * hostname — for the same reason validation's does not: a provider dashboard is
 * a place customer identifiers should not appear.
 */
export function browserSandboxNameFor(sessionId: string): string {
  return `vibe-browser-${sessionId}`;
}
