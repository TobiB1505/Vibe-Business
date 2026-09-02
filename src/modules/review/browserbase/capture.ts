import { describeThrown } from "@/lib/errors/describe";
import "server-only";

import type { Browser, BrowserContext, Page } from "playwright-core";
import type { BrowserSessionProvider } from "@/modules/authenticated-product-intelligence/provider";
import type { BrowserCaptureProvider, CaptureOutcome, CaptureRequest } from "../browser-port";

/**
 * Browserbase screenshot adapter (Sprint 11A §9, §10, §11).
 *
 * ## Why this reuses the Deep Scan session provider
 *
 * Browserbase is already integrated, configured and stable, and §10 is explicit
 * that Sprint 11A must not depend on a provider migration. So the *session*
 * lifecycle — create, connect, release — comes from the existing
 * `BrowserSessionProvider`, and everything specific to photographing a page
 * lives here behind `BrowserCaptureProvider`.
 *
 * The domain above never learns either name. A Cloudflare Browser Run adapter
 * would replace this file and nothing else.
 *
 * ## What is deliberately different from Deep Scan
 *
 * Deep Scan attaches to the context the **user** signed into, and must not
 * disturb it. Capture is the opposite: it creates its own **fresh** context per
 * capture and throws it away.
 *
 * ```
 * Deep Scan   browser.contexts()[0]   the human's authenticated context
 * Capture     browser.newContext()    empty, no cookies, no storage state
 * ```
 *
 * That difference is the entire authentication story of this sprint. Nothing
 * here reads `storageState()`, `cookies()`, or `addCookies()`; there is no code
 * path that could carry production auth into a preview or the reverse (§3,
 * §11). A page that needs a login renders as logged-out, which is honest — and
 * the domain reports it as unsupported rather than comparing two logged-out
 * screenshots as though they meant something.
 *
 * ## Session hygiene
 *
 * One session serves both captures, so the two sides share a browser build and
 * a viewport — the thing that makes them comparable. It is released in a
 * `finally`, on success, failure, timeout and throw alike: an abandoned remote
 * browser bills by the second, and the provider-side `timeout` is the backstop
 * for the case where even that fails.
 */



/** Bounded, so a page's own error text cannot become an unbounded log line. */
function bounded(text: string, max = 300): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

async function captureOne(browser: Browser, request: CaptureRequest): Promise<CaptureOutcome> {
  let context: BrowserContext | undefined;

  try {
    // Fresh and empty, every time. Not `browser.contexts()[0]` — that is Deep
    // Scan's authenticated context, and reusing it here is precisely the bug
    // this comment exists to prevent.
    context = await browser.newContext({
      viewport: { width: request.viewport.width, height: request.viewport.height },
      deviceScaleFactor: request.viewport.deviceScaleFactor,
      // No `storageState`: there is nothing to restore and nothing may be.
    });

    const page: Page = await context.newPage();

    // Dialogs would block navigation and a screenshot of a modal is not a
    // screenshot of the page. Dismissed, never accepted.
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });

    let httpStatus: number | null = null;
    try {
      const response = await page.goto(request.url, {
        // `domcontentloaded`, never `networkidle`: a live product may hold a
        // connection open indefinitely, and waiting for idle turns a
        // screenshot into an unbounded, billed browser job (§13).
        waitUntil: "domcontentloaded",
        timeout: request.navigationTimeoutMs,
      });
      httpStatus = response?.status() ?? null;
    } catch (error) {
      // The page, not the provider: navigation is where a slow or unreachable
      // *target* fails, and it is a different problem from Browserbase being
      // down.
      return { ok: false, layer: "target", detail: bounded(describeThrown(error)) };
    }

    if (request.stabilizationCss) {
      // Rendering state only. No application source is touched, and the style
      // exists for the lifetime of this throwaway context (§14).
      await page.addStyleTag({ content: request.stabilizationCss }).catch(() => undefined);
    }

    // A short fixed settle rather than a cleverer condition. See policy.ts:
    // this costs a known amount, and `networkidle` may never arrive.
    await page.waitForTimeout(request.settleMs);

    const bytes = await page.screenshot({
      type: "png",
      fullPage: request.fullPage,
      // Animations are already frozen by the injected stylesheet; asking
      // Playwright to disable them too is belt and braces on the same property.
      animations: "disabled",
      caret: "hide",
    });

    return {
      ok: true,
      value: {
        bytes: new Uint8Array(bytes),
        // The requested viewport, because `fullPage: false` means the image is
        // exactly the frame we asked for. Recording the request rather than
        // re-measuring keeps both sides describable by one number.
        width: request.viewport.width,
        height: request.viewport.height,
        httpStatus,
      },
    };
  } catch (error) {
    return { ok: false, layer: "adapter", detail: bounded(describeThrown(error)) };
  } finally {
    // The context dies with its cookies, its storage and whatever the page put
    // in them.
    await context?.close().catch(() => undefined);
  }
}

export function createBrowserbaseCaptureProvider(
  sessions: BrowserSessionProvider,
  options: { sessionTimeoutSeconds: number },
): BrowserCaptureProvider {
  return {
    id: "browserbase",

    async captureAll(requests) {
      const startedAt = Date.now();
      const failAll = (layer: "provider" | "adapter", detail: string | null) => ({
        outcomes: requests.map((): CaptureOutcome => ({ ok: false, layer, detail })),
        usage: { durationMs: Date.now() - startedAt, captures: 0 },
      });

      const created = await sessions.createSession({
        timeoutSeconds: options.sessionTimeoutSeconds,
      });
      if (!created.ok) {
        // The provider refused before anything was photographed, so there is
        // nothing to release and no page to blame.
        return failAll("provider", created.error);
      }

      const providerSessionId = created.value.providerSessionId;
      let browser: Browser | undefined;

      try {
        // Same tracing hint as the Deep Scan connector: `playwright-core` reads
        // its own `browsers.json` at load through a runtime-computed path, so
        // the file is not traced into the serverless bundle without this. It
        // cost a 500 on a page that was not even scanning.
        require.resolve("playwright-core/browsers.json");
        const { chromium } = await import("playwright-core");

        browser = await chromium.connectOverCDP(created.value.connectUrl, { timeout: 30_000 });

        const outcomes: CaptureOutcome[] = [];
        for (const request of requests) {
          // Sequential, not parallel. Two pages rendering at once in one remote
          // browser compete for CPU, and the side that loses gets a screenshot
          // of a half-painted page — a difference the change did not make.
          outcomes.push(
            await withTimeout(captureOne(browser, request), request.captureTimeoutMs, {
              ok: false,
              layer: "target",
              detail: "capture exceeded its time budget",
            }),
          );
        }

        return {
          outcomes,
          usage: {
            durationMs: Date.now() - startedAt,
            captures: outcomes.filter((outcome) => outcome.ok).length,
          },
        };
      } catch (error) {
        return failAll("adapter", bounded(describeThrown(error)));
      } finally {
        // Both of these run on every path. Closing the CDP connection is ours;
        // releasing the session is the provider's, and skipping it would leave
        // a remote browser billing until its own timeout.
        await browser?.close().catch(() => undefined);
        await sessions.terminateSession(providerSessionId).catch(() => undefined);
      }
    },
  };
}

/** Races a capture against its own ceiling, so one hung page cannot stall the run. */
async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
