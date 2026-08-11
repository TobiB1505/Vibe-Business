import "server-only";

// Types only — erased at compile time, so this import contributes nothing to
// the runtime module graph. The runtime binding is loaded inside
// `connectReadOnly` instead; see the note there.
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { AnalysisBrowserPort, AnalysisPagePort } from "../analyzer";
import { pageExtractionScript, type RawPageExtraction } from "../extract";
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
