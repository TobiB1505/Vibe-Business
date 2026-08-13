import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionProvider } from "@/modules/authenticated-product-intelligence/provider";
import { REVIEW_POLICY, SCREENSHOT_STABILIZATION_CSS } from "../policy";
import type { CaptureRequest } from "../browser-port";

/**
 * The capture adapter's contract with the browser (Sprint 11A §11, §39).
 *
 * The domain tests prove the *policy* — same viewport, same settle, one session.
 * They cannot see what the adapter actually asks Chrome for, and three of those
 * asks are security invariants rather than details:
 *
 *  - a **fresh** context per capture, never the one Deep Scan's user signed
 *    into;
 *  - **no** storage state, in or out;
 *  - the provider session released on **every** path, including failure — an
 *    abandoned remote browser bills by the second.
 *
 * So Playwright is mocked at the module boundary and the assertions are on the
 * arguments it would receive. This is the same seam that has cost this project
 * twice before: a code path every higher test faked.
 */

const connectOverCDP = vi.fn();
const newContext = vi.fn();
const newPage = vi.fn();
const goto = vi.fn();
const screenshot = vi.fn();
const addStyleTag = vi.fn();
const waitForTimeout = vi.fn();
const closeContext = vi.fn();
const closeBrowser = vi.fn();
/** Stands in for Deep Scan's authenticated context. Must never be touched. */
const authenticatedNewPage = vi.fn();

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: (...args: unknown[]) => connectOverCDP(...args) },
}));

vi.mock("server-only", () => ({}));

const { createBrowserbaseCaptureProvider } = await import("./capture");

function sessionProvider(overrides: Partial<BrowserSessionProvider> = {}): BrowserSessionProvider {
  return {
    name: "browserbase",
    createSession: vi.fn(async () => ({
      ok: true as const,
      value: { providerSessionId: "sess_1", connectUrl: "wss://cdp.example/1", expiresAt: null },
    })),
    getConnection: vi.fn(),
    getLiveView: vi.fn(),
    terminateSession: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  } as BrowserSessionProvider;
}

function request(url: string): CaptureRequest {
  return {
    url,
    viewport: REVIEW_POLICY.viewport,
    navigationTimeoutMs: REVIEW_POLICY.navigationTimeoutMs,
    settleMs: REVIEW_POLICY.settleMs,
    captureTimeoutMs: REVIEW_POLICY.captureTimeoutMs,
    fullPage: REVIEW_POLICY.fullPage,
    stabilizationCss: SCREENSHOT_STABILIZATION_CSS,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  screenshot.mockResolvedValue(Buffer.from([1, 2, 3]));
  goto.mockResolvedValue({ status: () => 200 });
  addStyleTag.mockResolvedValue(undefined);
  waitForTimeout.mockResolvedValue(undefined);
  closeContext.mockResolvedValue(undefined);
  closeBrowser.mockResolvedValue(undefined);

  newPage.mockResolvedValue({
    on: vi.fn(),
    goto: (...args: unknown[]) => goto(...args),
    addStyleTag: (...args: unknown[]) => addStyleTag(...args),
    waitForTimeout: (...args: unknown[]) => waitForTimeout(...args),
    screenshot: (...args: unknown[]) => screenshot(...args),
  });

  newContext.mockResolvedValue({
    newPage: () => newPage(),
    close: () => closeContext(),
  });

  connectOverCDP.mockResolvedValue({
    newContext: (...args: unknown[]) => newContext(...args),
    // A pre-existing context, as a real reconnected browser would have. It
    // stands in for the one a Deep Scan user signed into: if the adapter ever
    // reaches for `contexts()[0]`, this is the authenticated session it would
    // silently photograph.
    contexts: () => [{ newPage: () => authenticatedNewPage(), close: () => closeContext() }],
    close: () => closeBrowser(),
  });
});

function provider(sessions = sessionProvider()) {
  return {
    sessions,
    capture: createBrowserbaseCaptureProvider(sessions, { sessionTimeoutSeconds: 120 }),
  };
}

describe("browser isolation", () => {
  it("creates a fresh context per capture, with no storage state", async () => {
    const { capture } = provider();

    await capture.captureAll([request("https://a.example/"), request("https://b.example/")]);

    // Two captures, two contexts. Never `contexts()[0]` — that is Deep Scan's
    // authenticated context, and reusing it is the one mistake that would
    // carry a customer's login into a screenshot.
    expect(newContext).toHaveBeenCalledTimes(2);
    expect(authenticatedNewPage).not.toHaveBeenCalled();
    for (const call of newContext.mock.calls) {
      const options = call[0] as Record<string, unknown>;
      expect(options.storageState).toBeUndefined();
      expect(options.viewport).toEqual({
        width: REVIEW_POLICY.viewport.width,
        height: REVIEW_POLICY.viewport.height,
      });
    }
  });

  it("never reads or writes cookies or storage state", async () => {
    const { capture } = provider();

    await capture.captureAll([request("https://a.example/")]);

    // The context object the adapter is handed exposes only what it uses. If a
    // future change reached for `storageState()` or `addCookies()` this mock
    // would throw rather than silently succeed.
    const context = await newContext.mock.results[0]?.value;
    expect(context.storageState).toBeUndefined();
    expect(context.addCookies).toBeUndefined();
  });
});

describe("session lifecycle", () => {
  it("releases the provider session after a successful capture", async () => {
    const sessions = sessionProvider();
    const { capture } = provider(sessions);

    await capture.captureAll([request("https://a.example/")]);

    expect(sessions.terminateSession).toHaveBeenCalledWith("sess_1");
    expect(closeBrowser).toHaveBeenCalled();
  });

  it("releases the provider session when navigation fails", async () => {
    goto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
    const sessions = sessionProvider();
    const { capture } = provider(sessions);

    const { outcomes } = await capture.captureAll([request("https://a.example/")]);

    expect(outcomes[0]).toMatchObject({ ok: false, layer: "target" });
    // The failure path is exactly where "we'll release it later" becomes "we
    // didn't", and a remote browser bills until its own timeout.
    expect(sessions.terminateSession).toHaveBeenCalledWith("sess_1");
  });

  it("releases the provider session when the browser connection throws", async () => {
    connectOverCDP.mockRejectedValue(new Error("cdp refused"));
    const sessions = sessionProvider();
    const { capture } = provider(sessions);

    const { outcomes } = await capture.captureAll([request("https://a.example/")]);

    expect(outcomes[0]).toMatchObject({ ok: false, layer: "adapter" });
    expect(sessions.terminateSession).toHaveBeenCalledWith("sess_1");
  });

  it("opens no browser when the provider refuses a session", async () => {
    const sessions = sessionProvider({
      createSession: vi.fn(async () => ({
        ok: false as const,
        error: "browser_provider_unavailable" as const,
      })),
    });
    const { capture } = provider(sessions);

    const { outcomes, usage } = await capture.captureAll([request("https://a.example/")]);

    expect(connectOverCDP).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ ok: false, layer: "provider" });
    expect(usage.captures).toBe(0);
  });

  it("closes each context even when its capture fails", async () => {
    goto.mockRejectedValue(new Error("timeout"));
    const { capture } = provider();

    await capture.captureAll([request("https://a.example/")]);

    // The context dies with its cookies, its storage and whatever the page put
    // in them.
    expect(closeContext).toHaveBeenCalled();
  });
});

describe("what the page is asked for", () => {
  it("navigates on domcontentloaded, never networkidle", async () => {
    const { capture } = provider();

    await capture.captureAll([request("https://a.example/")]);

    // A live product can hold a connection open indefinitely, so `networkidle`
    // may never arrive — and waiting for it turns a screenshot into an
    // unbounded, billed browser job (§13).
    expect(goto).toHaveBeenCalledWith(
      "https://a.example/",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
  });

  it("freezes animation before the screenshot", async () => {
    const { capture } = provider();

    await capture.captureAll([request("https://a.example/")]);

    // Rendering state only — no application source is touched (§14).
    expect(addStyleTag).toHaveBeenCalledWith({ content: SCREENSHOT_STABILIZATION_CSS });
    expect(screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ animations: "disabled", caret: "hide", fullPage: false }),
    );
  });

  it("reports the requested viewport as the image's dimensions", async () => {
    const { capture } = provider();

    const { outcomes } = await capture.captureAll([request("https://a.example/")]);

    expect(outcomes[0]).toMatchObject({
      ok: true,
      value: { width: REVIEW_POLICY.viewport.width, height: REVIEW_POLICY.viewport.height },
    });
  });

  it("never returns a capability URL to its caller", async () => {
    const { capture } = provider();

    const result = await capture.captureAll([request("https://a.example/")]);

    // The CDP endpoint grants full control of the browser. It is used once and
    // never crosses this boundary.
    expect(JSON.stringify(result)).not.toContain("wss://");
    expect(JSON.stringify(result)).not.toContain("cdp.example");
  });
});
