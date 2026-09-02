import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBrowserSandboxEnvCache } from "@/lib/env/browser-sandbox";
import { fakeSandboxProvider, type FakeSandboxOptions } from "@/modules/validation/test-support";
import { BROWSER_GUARD_ENV } from "./guard-program";
import { createSandboxBrowserSessionProvider, type BrowserRuntimeImage } from "./provider";
import { BROWSER_SANDBOX } from "./runtime";
import { deriveBrowserSessionTokens } from "./tokens";

/**
 * The browser sandbox, against a fake that opens nothing.
 *
 * Three families, and they are the three ways this goes wrong: exposing more
 * than the guard, handing the wrong capability to the wrong holder, and leaving
 * a VM running that nobody can use but everybody pays for.
 */

const READY = `${BROWSER_SANDBOX.root}/ready`;
const SECRET = "a".repeat(48);

/** Ready by default; a test that wants the slow path omits the file. */
function sandboxes(options: FakeSandboxOptions = {}) {
  return fakeSandboxProvider({ files: { [READY]: "ready" }, ...options });
}

const workingImage: BrowserRuntimeImage = {
  resolve: async () => ({ ok: true, snapshotId: "snap_browser_1" }),
};

function provider(fake = sandboxes(), image: BrowserRuntimeImage = workingImage) {
  return createSandboxBrowserSessionProvider({
    sandboxes: fake,
    image,
    // No real waiting anywhere: readiness is polled, and a test that slept for
    // it would be measuring the poll interval rather than the behaviour.
    sleep: async () => undefined,
  });
}

beforeEach(() => {
  vi.stubEnv("VIBE_BROWSER_SESSION_SECRET", SECRET);
  // The env module memoizes the process environment, and `stubEnv` mutates it.
  // Without this the first parsed value would outlive the test that set it.
  resetBrowserSandboxEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetBrowserSandboxEnvCache();
});

describe("what the sandbox exposes", () => {
  it("opens exactly one port, and it is the guard's", async () => {
    const fake = sandboxes();

    expect((await provider(fake).createSession({ timeoutSeconds: 600 })).ok).toBe(true);

    // Chromium's DevTools port has no authentication and never will. If it
    // appeared here, the URL alone would be full control of the browser.
    expect(fake.exposedPorts()).toEqual([BROWSER_SANDBOX.publicPort]);
    expect(fake.exposedPorts()).not.toContain(BROWSER_SANDBOX.devtoolsPort);
  });

  it("keeps Chromium listening on loopback", async () => {
    const fake = sandboxes();

    await provider(fake).createSession({ timeoutSeconds: 600 });

    const chromium = fake.backgroundCommands().find((command) => command.includes("chromium"));
    expect(chromium).toContain("--remote-debugging-address=127.0.0.1");
  });

  it("starts Chromium before the guard", async () => {
    const fake = sandboxes();

    await provider(fake).createSession({ timeoutSeconds: 600 });

    // The guard refuses to report ready until DevTools answers, so this order
    // is what that wait is for rather than a coincidence of the call sequence.
    const [first, second] = fake.backgroundCommands();
    expect(first).toContain("chromium");
    expect(second).toContain("guard.mjs");
  });

  it("carries no customer source into the VM", async () => {
    const fake = sandboxes();

    await provider(fake).createSession({ timeoutSeconds: 600 });

    // The property the whole design rests on: there is nothing in this VM to
    // exfiltrate, which is what makes its unrestricted egress acceptable.
    expect(fake.createdWith()?.source).toEqual({ kind: "snapshot", snapshotId: "snap_browser_1" });
  });

  it("carries no credential of any kind into the VM", async () => {
    const fake = sandboxes();

    await provider(fake).createSession({ timeoutSeconds: 600 });

    const env = fake.createdWith()?.env ?? {};
    for (const name of Object.keys(env)) {
      expect(name).not.toMatch(/^(GITHUB|GH|ANTHROPIC|SUPABASE|VERCEL|BROWSERBASE|AWS|OPENAI|STRIPE)_/);
    }
    // The secret the tokens are derived from stays on Vibe's server. Only the
    // derived values travel, and each opens one channel of this one VM.
    expect(JSON.stringify(env)).not.toContain(SECRET);
  });

  it("passes the guard exactly the five values it reads", async () => {
    const fake = sandboxes();

    await provider(fake).createSession({ timeoutSeconds: 600 });

    expect(Object.keys(fake.createdWith()?.env ?? {}).sort()).toEqual(
      Object.values(BROWSER_GUARD_ENV).sort(),
    );
  });
});

describe("which capability reaches whom", () => {
  it("gives the analysis a control URL and the live view a view URL", async () => {
    const fake = sandboxes();
    const browser = provider(fake);

    const created = await browser.createSession({ timeoutSeconds: 600 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const tokens = deriveBrowserSessionTokens(created.value.providerSessionId, {
      VIBE_BROWSER_SESSION_SECRET: SECRET,
    });
    const connection = await browser.getConnection(created.value.providerSessionId);
    const liveView = await browser.getLiveView(created.value.providerSessionId);

    expect(connection.ok && connection.value.connectUrl).toContain(`/control?token=${tokens.control}`);
    expect(liveView.ok && liveView.value.url).toContain(`/view?token=${tokens.view}`);
  });

  it("never puts the control token in the live view URL", async () => {
    const fake = sandboxes();
    const browser = provider(fake);

    const created = await browser.createSession({ timeoutSeconds: 600 });
    if (!created.ok) expect.unreachable("session should have been created");

    const tokens = deriveBrowserSessionTokens(created.value.providerSessionId, {
      VIBE_BROWSER_SESSION_SECRET: SECRET,
    });
    const liveView = await browser.getLiveView(created.value.providerSessionId);

    // The view URL is the one that travels to a browser. A control token in it
    // would be CDP in a place Vibe does not control.
    expect(liveView.ok && liveView.value.url).not.toContain(tokens.control);
  });

  it("re-derives both tokens on reconnection rather than remembering them", async () => {
    const fake = sandboxes();

    const created = await provider(fake).createSession({ timeoutSeconds: 600 });
    if (!created.ok) expect.unreachable("session should have been created");

    // A *different* provider instance, as the second request genuinely is: a
    // separate invocation with no shared memory. If anything were being held in
    // process rather than derived, this would answer differently.
    const later = await provider(fake).getConnection(created.value.providerSessionId);

    expect(later.ok && later.value.connectUrl).toBe(
      (created.ok && created.value.connectUrl) || "unset",
    );
  });

  it("uses a session id that is an identifier and not a capability", async () => {
    const fake = sandboxes();

    const created = await provider(fake).createSession({ timeoutSeconds: 600 });
    if (!created.ok) expect.unreachable("session should have been created");

    const tokens = deriveBrowserSessionTokens(created.value.providerSessionId, {
      VIBE_BROWSER_SESSION_SECRET: SECRET,
    });
    // It is persisted, so rule 52 applies: it names the VM and opens nothing.
    expect(created.value.providerSessionId).not.toContain(tokens.control);
    expect(created.value.providerSessionId).not.toContain(tokens.view);
    expect(created.value.providerSessionId).toMatch(/^vibe-browser-/);
  });

  it("secures the whole port with wss, never ws", async () => {
    const fake = sandboxes();

    const created = await provider(fake).createSession({ timeoutSeconds: 600 });

    // A token in a query string over plaintext is a token on the wire.
    expect(created.ok && created.value.connectUrl.startsWith("wss://")).toBe(true);
  });
});

describe("a VM nobody can use is stopped", () => {
  it("stops the sandbox when the guard never reports ready", async () => {
    // No ready file: the guard is up but Chromium never answered.
    const fake = fakeSandboxProvider({});
    let clock = 0;
    const browser = createSandboxBrowserSessionProvider({
      sandboxes: fake,
      image: workingImage,
      sleep: async () => undefined,
      // Advances past the ceiling rather than waiting for it.
      now: () => (clock += 10_000),
    });

    const created = await browser.createSession({ timeoutSeconds: 600 });

    expect(created).toEqual({ ok: false, error: "browser_session_create_failed" });
    // Left running it would bill for its whole timeout and show a person a
    // live view that never paints.
    expect(fake.stopped()).toBe(true);
  });

  it("stops the sandbox when the provider has no route to the port", async () => {
    const fake = sandboxes({ failPublicOrigin: true });

    const created = await provider(fake).createSession({ timeoutSeconds: 600 });

    expect(created).toEqual({ ok: false, error: "browser_provider_unavailable" });
    expect(fake.stopped()).toBe(true);
  });

  it("creates nothing when there is no runtime image", async () => {
    const fake = sandboxes();
    const missing: BrowserRuntimeImage = {
      resolve: async () => ({ ok: false, error: "browser_provider_not_configured" }),
    };

    const created = await provider(fake, missing).createSession({ timeoutSeconds: 600 });

    expect(created).toEqual({ ok: false, error: "browser_provider_not_configured" });
    expect(fake.createCount()).toBe(0);
  });
});

describe("termination is safe on every path", () => {
  it("reports success for a session that is already gone", async () => {
    const fake = sandboxes({ loseSandboxBeforeReconnect: 1 });

    // Called on completion, failure, cancellation and expiry. A terminal path
    // that failed because the thing it wanted destroyed was already destroyed
    // would turn cleanup into an error to handle.
    expect(await provider(fake).terminateSession("vibe-browser-gone")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("stops a live session", async () => {
    const fake = sandboxes();

    const created = await provider(fake).createSession({ timeoutSeconds: 600 });
    if (!created.ok) expect.unreachable("session should have been created");

    expect(await provider(fake).terminateSession(created.value.providerSessionId)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(fake.stopped()).toBe(true);
  });

  it("tells a missing session apart from an expired one", async () => {
    const gone = sandboxes({ loseSandboxBeforeReconnect: 1 });

    // A person sees a different sentence for each, so the codes may not merge.
    expect(await provider(gone).getConnection("vibe-browser-x")).toEqual({
      ok: false,
      error: "browser_session_not_found",
    });
  });
});
