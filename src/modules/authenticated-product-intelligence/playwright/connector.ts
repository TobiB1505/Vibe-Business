import "server-only";

// Types only — erased at compile time, so this import contributes nothing to
// the runtime module graph. The runtime binding is loaded inside
// `connectReadOnly` instead; see the note there.
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { AnalysisBrowserPort, AnalysisPagePort } from "../analyzer";
import { pageExtractionScript, type RawPageExtraction } from "../extract";
import {
  probePathFor,
  sanitizeSignInProbe,
  signInProbeScript,
  type SignInProbe,
} from "../login-detection";
import { decideRequest } from "../read-only-policy";

/**
 * Playwright transport for authenticated analysis (Sprint 5 §16, §17, §18, §19).
 *
 * Connects over CDP to a browser that is **already running and already logged
 * in** — it never creates a browser, never creates a context, and never
 * authenticates. The user did that themselves in the live view.
 *
 * `server-only`: Playwright and the CDP endpoint must never be reachable from a
 * client bundle.
 *
 * The security-relevant work happens in `attachReadOnlyGuards`, applied to the
 * existing context *before* the analyzer navigates anywhere:
 *
 *  - Mutating requests are aborted, and each abort is counted so the snapshot
 *    can admit the analysis may be incomplete (Sprint 5 §18).
 *  - Top-level navigations off-origin are aborted (Sprint 5 §15).
 *  - Downloads are refused and never read (Sprint 5 §19).
 *  - Sensitive permissions are denied for the whole context.
 *
 * Note what is *not* here: no `storageState()`, no `cookies()`, no
 * `addCookies()`, no context creation with a `storageState` option. The
 * authenticated state stays in the remote browser and dies with it
 * (Sprint 5 §6, ADR 0012).
 */

export type ReadOnlyBrowserSession = {
  port: AnalysisBrowserPort;
  /** Closes our CDP connection. Does not terminate the provider session. */
  disconnect(): Promise<void>;
};

class PlaywrightPagePort implements AnalysisPagePort {
  constructor(private readonly page: Page) {}

  url(): string {
    return this.page.url();
  }

  async goto(url: string, options: { timeoutMs: number }): Promise<{ status: number | null }> {
    const response = await this.page.goto(url, {
      timeout: options.timeoutMs,
      // `domcontentloaded` rather than `networkidle`: a logged-in app often
      // polls, so `networkidle` may never arrive and would burn the budget.
      waitUntil: "domcontentloaded",
    });
    return { status: response?.status() ?? null };
  }

  /**
   * Waits until the page stops navigating itself.
   *
   * `goto` resolves on `domcontentloaded`, which for a single-page application
   * is the beginning of its work rather than the end: it then checks the
   * session, redirects to a canonical path, or replaces the URL once its data
   * arrives. Reading during that throws "Execution context was destroyed";
   * navigating during it aborts the next page with "interrupted by another
   * navigation". One scan inspected one page of sixteen for exactly this.
   *
   * Two signals, and both are needed. URL stability is the one that always
   * terminates — a client-side redirect changes `location`, and polling for it
   * cannot hang. `networkidle` is the one that catches a shell which fetches
   * its data without changing the URL, and it is best effort precisely because
   * a logged-in application often polls and would never reach it.
   *
   * It never throws and never reports failure. Reaching the ceiling means the
   * page is read as it stands, which is the right answer: a page that will not
   * hold still is still worth describing.
   */
  async settle(options: { quietMs: number; timeoutMs: number }): Promise<void> {
    const deadline = Date.now() + options.timeoutMs;
    const poll = Math.max(25, Math.min(100, Math.floor(options.quietMs / 4)));

    let lastUrl = this.page.url();
    let stillSince = Date.now();

    while (Date.now() < deadline) {
      if (Date.now() - stillSince >= options.quietMs) break;
      await this.page.waitForTimeout(poll).catch(() => undefined);
      const url = this.page.url();
      if (url !== lastUrl) {
        lastUrl = url;
        stillSince = Date.now();
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    // Best effort, and the `catch` is the design: an application that polls
    // never goes quiet, and waiting for something that cannot happen is how
    // the old `networkidle` note in `goto` describes burning the budget.
    await this.page
      .waitForLoadState("networkidle", { timeout: remaining })
      .catch(() => undefined);
  }

  async extract(): Promise<RawPageExtraction> {
    return this.page.evaluate(pageExtractionScript);
  }
}

/**
 * Applies read-only guards to an existing, authenticated context.
 *
 * Returns the mutable counters the analyzer reads when composing warnings.
 */
export async function attachReadOnlyGuards(
  context: BrowserContext,
  origin: string,
): Promise<AnalysisBrowserPort["blocked"]> {
  const blocked = { mutatingRequests: 0, downloads: 0, externalNavigations: 0 };

  await context.route("**/*", async (route) => {
    const request = route.request();
    const decision = decideRequest({
      method: request.method(),
      url: request.url(),
      isNavigation: request.isNavigationRequest() && request.frame().parentFrame() === null,
      origin,
    });

    if (decision.allow) {
      await route.continue();
      return;
    }

    if (decision.reason === "mutating_method") blocked.mutatingRequests += 1;
    else blocked.externalNavigations += 1;

    await route.abort("blockedbyclient");
  });

  // Downloads are cancelled, never saved and never read.
  context.on("download", (download) => {
    blocked.downloads += 1;
    void download.cancel().catch(() => undefined);
  });

  // A file chooser left open would block navigation; dismissing it is not an
  // upload — no files are ever set (Sprint 5 §19).
  context.on("page", (page) => {
    page.on("filechooser", (chooser) => {
      void chooser.setFiles([]).catch(() => undefined);
    });
    // Dialogs (alert/confirm/beforeunload) are dismissed so a page cannot stall
    // the analysis. Dismiss, never accept: accepting a confirm() could approve
    // a destructive action.
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
  });

  // Playwright has no per-permission deny — `clearPermissions()` revoking
  // everything *is* the deny, and it also covers a provider profile that
  // pre-granted something. DENIED_PERMISSIONS documents what must stay revoked
  // and is asserted by read-only-policy.test.ts.
  await context.clearPermissions();

  return blocked;
}

/**
 * Connects to the already-authenticated remote browser and prepares it for
 * read-only analysis.
 *
 * `connectUrl` is a capability URL: it is passed in per call, used, and never
 * stored, logged, or returned.
 */
/**
 * Points a freshly created session at the project's own origin.
 *
 * Without this the user is handed a blank browser and has to type their own
 * URL — which is both a poor first impression and an easy way to end up signed
 * into the wrong site, producing `authenticated_origin_not_reached` later.
 *
 * Deliberately **no read-only guards**. Signing in is a POST, and the guards
 * exist to keep the *analysis* read-only; attaching them here would block the
 * login this whole flow is built around. Analysis connects separately, through
 * `connectReadOnly`, and that is where the guards belong.
 *
 * Best effort: a site that is slow or down must not fail session creation,
 * because the user can still drive the browser by hand.
 */
/**
 * The landing, and why it now says why it failed.
 *
 * This returned a bare `navigated: boolean` and swallowed the reason, and the
 * one caller discarded even that. The first session in Vibe's own browser
 * opened on a **white canvas**, and between those two silences there was
 * nothing anywhere to say whether the browser had failed to reach the
 * customer's site or had reached it and painted nothing.
 *
 * The reason is a short string for the operator, never for the customer:
 * ADR 0011's rule is that no provider-shaped text escapes this adapter towards
 * a caller who renders it, and the caller maps this to a typed code.
 */
export type SessionLanding = { navigated: true } | { navigated: false; reason: string };

export async function openSessionAtOrigin(
  connectUrl: string,
  origin: string,
  options: { timeoutMs?: number } = {},
): Promise<SessionLanding> {
  const { chromium } = await import("playwright-core");

  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(connectUrl, { timeout: options.timeoutMs ?? 20_000 });
    const context = browser.contexts()[0];
    if (!context) return { navigated: false, reason: "the browser reported no context" };

    // A brand-new session already has one blank page; reuse it rather than
    // leaving a stray tab the analyzer would later have to ignore.
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(new URL(origin).origin, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 20_000,
    });
    return { navigated: true };
  } catch (error) {
    // Bounded, and a message rather than an object: a Playwright error carries
    // a stack and sometimes a URL, and neither belongs in a log line.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
    return { navigated: false, reason: reason.slice(0, 300) };
  } finally {
    // Closes our CDP connection only. The remote session, and the page we just
    // navigated, stay exactly where they are for the user.
    await browser?.close().catch(() => undefined);
  }
}

export async function connectReadOnly(
  connectUrl: string,
  origin: string,
  options: { timeoutMs?: number } = {},
): Promise<ReadOnlyBrowserSession> {
  // Imported here rather than at module scope, and this placement is
  // load-bearing rather than stylistic.
  //
  // Turbopack compiles a top-level `import` of an external package into a
  // top-level `await externalImport(...)` in the emitted chunk, so the package
  // is resolved the instant the chunk initialises. `playwright-core` reads its
  // own `browsers.json` on load, that file is not traced into the serverless
  // bundle, and the result was that merely *rendering the project page* threw
  // `Cannot find module .../browsers.json` — a 500 on a page that was not
  // running a scan at all.
  //
  // Keeping the import inside the function means the package is resolved only
  // when a Deep Scan actually connects to a browser.
  // Tracing hint, and the reason this line exists at all.
  //
  // `playwright-core` reads its own `browsers.json` during module init via
  // `require(path.join(packageRoot, "browsers.json"))`. That path is computed
  // at runtime, so Vercel's file tracer cannot see it and leaves the file out
  // of the deployed function — the package then throws `Cannot find module`
  // the moment it loads.
  //
  // `outputFileTracingIncludes` is not a way out: it is ignored entirely under
  // Turbopack builds (verified — an include for an unmistakable file produced
  // no trace entry). The tracer itself does run, so the fix is to give it
  // something static to follow. A patched subpath export makes this resolve,
  // and the resolved path is exactly the file the package will read.
  require.resolve("playwright-core/browsers.json");

  const { chromium } = await import("playwright-core");

  const browser: Browser = await chromium.connectOverCDP(connectUrl, {
    timeout: options.timeoutMs ?? 30_000,
  });

  // The user's authenticated context already exists. Creating a new one would
  // start from a blank profile — no cookies, not logged in — which is exactly
  // the mistake this comment exists to prevent.
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => undefined);
    throw new Error("connected browser exposed no context");
  }

  const blocked = await attachReadOnlyGuards(context, origin);

  const port: AnalysisBrowserPort = {
    pages: async () => context.pages().map((page) => new PlaywrightPagePort(page)),
    blocked,
  };

  return {
    port,
    disconnect: async () => {
      // Closes our CDP connection only. Terminating the provider session is the
      // service's job, so the two lifecycles stay explicit.
      await browser.close().catch(() => undefined);
    },
  };
}

/**
 * Reads whether the founder has finished signing in, and nothing else.
 *
 * **No read-only guards, and that is the point.** `attachReadOnlyGuards`
 * aborts every mutating request, and signing in *is* a POST — attaching them
 * here would break the very login this probe is watching for. The guards exist
 * to keep the *analysis* read-only, and the analysis connects separately.
 *
 * What keeps this safe instead is that it does nothing: it navigates nowhere,
 * clicks nothing, and its one `evaluate` returns four booleans. The window in
 * which the founder's own POST must succeed stays exactly as wide as it was.
 *
 * Returns `null` when no page is on the project's origin, and throws nothing a
 * caller has to interpret — a page that is mid-navigation, a context that just
 * went away, and a browser that never answered are all the same "not yet".
 */
export async function probeSignInState(
  connectUrl: string,
  origin: string,
  options: { timeoutMs?: number } = {},
): Promise<SignInProbe | null> {
  const { chromium } = await import("playwright-core");

  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(connectUrl, { timeout: options.timeoutMs ?? 15_000 });
    const context = browser.contexts()[0];
    if (!context) return null;

    for (const page of context.pages()) {
      const path = probePathFor(page.url(), origin);
      if (path === null) continue;
      const raw = await page.evaluate(signInProbeScript);
      return sanitizeSignInProbe(raw, path);
    }

    return null;
  } catch {
    // Never surface the transport error: it carries the capability URL (§28),
    // and a caller can do nothing with it that "not yet" does not already say.
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
