import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBrowserSandboxEnvCache } from "@/lib/env/browser-sandbox";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { BROWSER_GUARD_PROGRAM, BROWSER_RUNTIME_VERSION } from "./guard-program";
import { createBrowserRuntimeImage } from "./image";
import { IMAGE_BUILD_HOSTS, IMAGE_LINK, imageBuildCommands } from "./image-build";
import { BROWSER_SANDBOX } from "./runtime";

/**
 * Resolving and building the image a browser session starts from.
 *
 * Two families. The first is reuse — an image that is built once and used many
 * times is the whole reason this exists, and a lookup that quietly missed would
 * turn every scan into a five-minute build nobody asked for. The second is the
 * separation of the two egress windows, which is a security property and not an
 * optimisation.
 */

let db: FakeDatabase;

const AT = new Date("2026-09-02T12:00:00.000Z").getTime();

function image(sandboxes = fakeSandboxProvider({}), now = () => AT) {
  return {
    resolver: createBrowserRuntimeImage({ supabase: fakeSupabase(db), sandboxes, now }),
    sandboxes,
  };
}

function seedRecorded(overrides: Record<string, unknown> = {}) {
  db.seed("browser_runtime_images", {
    id: "image_1",
    runtime_version: BROWSER_RUNTIME_VERSION,
    snapshot_id: "snap_recorded",
    built_at: new Date(AT - 1000).toISOString(),
    expires_at: new Date(AT + 60_000).toISOString(),
    ...overrides,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  vi.stubEnv("VIBE_BROWSER_SESSION_SECRET", "a".repeat(48));
  resetBrowserSandboxEnvCache();
});

describe("an image is built once and reused", () => {
  it("returns a recorded image without building anything", async () => {
    seedRecorded();
    const { resolver, sandboxes } = image();

    expect(await resolver.resolve()).toEqual({ ok: true, snapshotId: "snap_recorded" });
    // The whole point. A build here would spend minutes of a person's attention
    // on a download that already happened.
    expect(sandboxes.createCount()).toBe(0);
  });

  it("ignores an image whose snapshot has expired", async () => {
    seedRecorded({ expires_at: new Date(AT - 1).toISOString() });
    const { resolver, sandboxes } = image();

    // The id in an expired row names nothing. Starting from it would fail at
    // the provider with a message about a snapshot rather than about a browser.
    await resolver.resolve();
    expect(sandboxes.createCount()).toBe(1);
  });

  it("ignores an image built for a different guard", async () => {
    seedRecorded({ runtime_version: "browser-runtime-v0" });
    const { resolver, sandboxes } = image();

    // A changed guard on a filesystem assembled for the old one comes up and
    // then behaves subtly differently, which is the worst kind to diagnose.
    await resolver.resolve();
    expect(sandboxes.createCount()).toBe(1);
  });

  it("records what it built, against the version that will look for it", async () => {
    const { resolver } = image();

    const resolved = await resolver.resolve();

    expect(resolved.ok).toBe(true);
    const [row] = db.rows("browser_runtime_images");
    expect(row.runtime_version).toBe(BROWSER_RUNTIME_VERSION);
    expect(row.snapshot_id).toBeDefined();
    expect(new Date(String(row.expires_at)).getTime()).toBeGreaterThan(AT);
  });
});

describe("the build window and the session window are separate", () => {
  it("builds under a narrow allowlist, never unrestricted egress", async () => {
    const { resolver, sandboxes } = image();

    await resolver.resolve();

    const [policy] = sandboxes.policies();
    // A build knows exactly where it is going. A session does not, and that
    // difference is why the wide policy is not reused here.
    expect(policy).toEqual({ mode: "allow_domains", domains: [...IMAGE_BUILD_HOSTS] });
    expect(policy.mode).not.toBe("allow_all");
  });

  it("exposes no inbound port during a build", async () => {
    const { resolver, sandboxes } = image();

    await resolver.resolve();

    // Nothing serves anything while an image is being assembled.
    expect(sandboxes.exposedPorts()).toEqual([]);
  });

  it("brings no customer source into the image", async () => {
    const { resolver, sandboxes } = image();

    await resolver.resolve();

    expect(sandboxes.createdWith()?.source).toEqual({ kind: "image" });
  });

  it("carries no credential into the build", async () => {
    const { resolver, sandboxes } = image();

    await resolver.resolve();

    const env = sandboxes.createdWith()?.env ?? {};
    for (const name of Object.keys(env)) {
      expect(name).not.toMatch(/^(GITHUB|GH|ANTHROPIC|SUPABASE|VERCEL|BROWSERBASE|AWS|OPENAI|STRIPE)_/);
    }
  });

  it("installs dependencies without running their lifecycle scripts", async () => {
    // The window with the network open is the window a postinstall hook would
    // use — the same rule validation installs under, for the same reason.
    const install = imageBuildCommands().find((command) => command.command === "npm");
    expect(install?.args).toContain("--ignore-scripts");
  });
});

describe("what lands in the image", () => {
  it("writes the guard into the image rather than into each session", async () => {
    const { resolver, sandboxes } = image();

    await resolver.resolve();

    // A session starts by running the guard, not by receiving it — which is
    // what makes a session start in seconds.
    const transcript = sandboxes.commands().join("\n");
    expect(transcript).toContain(`${BROWSER_SANDBOX.root}/guard.mjs`);
    expect(transcript).toContain(IMAGE_LINK.programPath);
  });

  it("pins Chromium at one fixed path whatever revision was downloaded", async () => {
    // Playwright installs into a revision-numbered directory. A glob would put
    // a wildcard where a path belongs, and a hardcoded number would be silently
    // wrong on the next upgrade — a missing binary looks exactly like a browser
    // that failed to start.
    expect(IMAGE_LINK.chromiumPath).toBe(`${BROWSER_SANDBOX.root}/chromium`);
    expect(BROWSER_GUARD_PROGRAM).not.toContain("chromium-");
  });

  it("snapshots the filesystem it assembled", async () => {
    const { resolver, sandboxes } = image();

    await resolver.resolve();

    expect(sandboxes.snapshots()).toBe(1);
  });
});

describe("a failed build costs one sandbox and no retry loop", () => {
  /** The fake keys results on the whole rendered command, so build it from the real one. */
  const failingInstall = () => {
    const install = imageBuildCommands().find((command) => command.command === "npm");
    if (!install) throw new Error("the build no longer installs anything");
    return {
      results: {
        [[install.command, ...install.args].join(" ")]: { exitCode: 1, output: "boom" },
      },
    };
  };

  it("reports a failure and records nothing when a build step fails", async () => {
    const sandboxes = fakeSandboxProvider(failingInstall());
    const { resolver } = image(sandboxes);

    expect(await resolver.resolve()).toEqual({
      ok: false,
      error: "browser_provider_unavailable",
    });
    // A row here would make every later scan start from an image that was
    // never finished.
    expect(db.rows("browser_runtime_images")).toHaveLength(0);
    expect(sandboxes.stopped()).toBe(true);
  });

  it("does not retry inside one resolve", async () => {
    const sandboxes = fakeSandboxProvider(failingInstall());
    const { resolver } = image(sandboxes);

    await resolver.resolve();

    // A build that failed for a reason that persists would otherwise burn
    // minutes per attempt, on a person waiting for a browser.
    expect(sandboxes.createCount()).toBe(1);
  });
});
