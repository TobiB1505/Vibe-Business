import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Vercel Sandbox adapter's creation options (Sprint 10A §2, §24, §43).
 *
 * ## Why this test exists
 *
 * The orchestrator tests prove the *sequence* is right against a fake. They
 * cannot see what the real adapter actually asks Vercel for — and two of the
 * SDK's defaults are actively wrong for this use case:
 *
 *  - `networkPolicy` defaults to `allow-all`
 *  - `persistent` defaults to `true`, which snapshots the filesystem on stop
 *    and restores it on the next run of the same name
 *
 * A persistent validation sandbox would write a customer's source and
 * `node_modules` into Vercel storage and hand the next run a dirty tree. Both
 * defaults are overridden in the adapter, and both overrides are exactly the
 * kind of single line a refactor drops silently.
 *
 * This is the seam that has now cost this project twice — a table name in
 * Sprint 9, a CHECK constraint in the 9 post-dogfood pass. Both were code paths
 * every test faked. So the SDK is mocked rather than faked at our own boundary:
 * the assertion is on the arguments Vercel would receive.
 */

const create = vi.fn();
const get = vi.fn();

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: (...args: unknown[]) => create(...args),
    get: (...args: unknown[]) => get(...args),
  },
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  create.mockReset();
  get.mockReset();
  create.mockResolvedValue({
    name: "vibe-validate-abc",
    runtime: "node24",
    async runCommand() {
      return { exitCode: 0, durationMs: 1, stdout: async () => "", stderr: async () => "" };
    },
    async stop() {
      return { activeCpuDurationMs: 1, networkTransfer: { ingress: 1, egress: 1 } };
    },
  });
});

async function createSandbox(overrides: Record<string, unknown> = {}) {
  const { createVercelSandboxProvider } = await import("./provider");

  await createVercelSandboxProvider().create({
    name: "vibe-validate-abc",
    source: {
      repositoryUrl: "https://github.com/acme/product.git",
      revision: "2f05958e3410deaeb97029861abc05889139b4a7",
      credential: { username: "x-access-token", password: "ghs_token" },
    },
    networkPolicy: { mode: "allow_domains", domains: ["github.com"] },
    timeoutMs: 600_000,
    env: { CI: "1" },
    ...overrides,
  });

  return create.mock.calls[0][0] as Record<string, unknown>;
}

describe("sandbox creation options", () => {
  it("never creates a persistent sandbox", async () => {
    // The SDK default is `true`. A persistent validation sandbox would keep a
    // customer's source in Vercel storage and reuse a dirty tree next time.
    expect(await createSandbox()).toMatchObject({ persistent: false });
  });

  it("always passes an explicit network policy", async () => {
    // The SDK default is `allow-all`. A sandbox must never exist, even
    // momentarily, with open egress.
    const options = await createSandbox();

    expect(options.networkPolicy).toEqual({ allow: ["github.com"] });
  });

  it("maps deny-all to the provider's most restrictive mode", async () => {
    const options = await createSandbox({ networkPolicy: { mode: "deny_all" } });

    expect(options.networkPolicy).toBe("deny-all");
  });

  it("checks out an exact revision, never a branch", async () => {
    const options = await createSandbox();

    expect(options.source).toMatchObject({
      type: "git",
      revision: "2f05958e3410deaeb97029861abc05889139b4a7",
      depth: 1,
    });
  });

  it("exposes no ports (§43)", async () => {
    // Preview belongs to 10B. A port here would be a public surface serving
    // unvalidated customer code, which is a different exposure entirely.
    expect(await createSandbox()).not.toHaveProperty("ports");
  });

  it("passes the clone credential to the source and not to the environment", async () => {
    const options = await createSandbox();

    expect(options.source).toMatchObject({ username: "x-access-token", password: "ghs_token" });
    expect(JSON.stringify(options.env)).not.toContain("ghs_token");
  });

  it("bounds the sandbox lifetime", async () => {
    expect(await createSandbox()).toMatchObject({ timeout: 600_000 });
  });

  it("pins the image, so 'validated' means a known toolchain", async () => {
    const options = await createSandbox();

    expect(typeof options.image).toBe("string");
    expect(options.image).toContain("vercel/sandbox");
  });
});

describe("command failures explain themselves (post-dogfood)", () => {
  /**
   * The fourth real run reported `[command could not be executed]` — this
   * adapter's placeholder. The orchestrator had been taught to explain itself
   * while this layer still replaced the one useful fact with a constant, so a
   * production failure was undiagnosable one level down from where it was
   * fixed.
   *
   * Name and message only: the thrown object can carry request context and
   * occasionally credentials, so it is never surfaced whole.
   */
  it("carries the provider's error message into the command output", async () => {
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async runCommand() {
        throw new Error("cwd must be relative to the sandbox root");
      },
      async stop() {
        return { activeCpuDurationMs: 1, networkTransfer: { ingress: 1, egress: 1 } };
      },
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { repositoryUrl: "https://github.com/acme/p.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    const result = await sandbox.run({
      command: { command: "git", args: ["rev-parse", "HEAD"] },
      cwd: ".",
      timeoutMs: 1000,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("cwd must be relative to the sandbox root");
    expect(result.output).not.toBe("[command could not be executed]");
  });

  it("describes a non-error thrown value without inspecting it", async () => {
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async runCommand() {
        throw { secret: "ghs_shouldNeverBeSurfaced" };
      },
      async stop() {
        return { activeCpuDurationMs: 1, networkTransfer: { ingress: 1, egress: 1 } };
      },
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { repositoryUrl: "https://github.com/acme/p.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    const result = await sandbox.run({
      command: { command: "git", args: ["status"] },
      cwd: ".",
      timeoutMs: 1000,
    });

    // Described, never serialized: an arbitrary thrown object may carry anything.
    expect(result.output).toContain("non-error value");
    expect(result.output).not.toContain("ghs_");
  });
});

describe("reconnecting across durable steps (§3, §12)", () => {
  /**
   * The seam the durable-phase refactor introduced, tested at the same depth as
   * creation and for the same reason: an adapter mistake here is invisible to
   * every test that fakes our own boundary, and this is the third time that
   * class of bug would reach production.
   */
  function liveSandbox(overrides: Record<string, unknown> = {}) {
    return {
      name: "vibe-validate-abc",
      runtime: "node24",
      status: "running",
      async runCommand() {
        return { exitCode: 0, durationMs: 1, stdout: async () => "", stderr: async () => "" };
      },
      async stop() {
        return { activeCpuDurationMs: 1, networkTransfer: { ingress: 1, egress: 1 } };
      },
      ...overrides,
    };
  }

  async function reconnect() {
    const { createVercelSandboxProvider } = await import("./provider");
    return createVercelSandboxProvider().reconnect({ name: "vibe-validate-abc" });
  }

  it("asks for the sandbox by name, and nothing else", async () => {
    get.mockResolvedValue(liveSandbox());

    await reconnect();

    // The whole reconnect key. No handle, no capability URL, no token — the
    // name is recomputed from the validation run id, so there is nothing
    // persisted to leak (§3).
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ name: "vibe-validate-abc" }));
    const [params] = get.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(params).sort()).toEqual(["name", "resume"]);
  });

  it("never resumes a stopped session", async () => {
    // The third SDK default that is wrong here. `resume` defaults to true and
    // would restore a stopped session — potentially from a snapshot — handing
    // the next phase a filesystem the previous phase did not build.
    get.mockResolvedValue(liveSandbox());

    await reconnect();

    expect(get).toHaveBeenCalledWith(expect.objectContaining({ resume: false }));
  });

  it("returns a usable handle for a running sandbox", async () => {
    get.mockResolvedValue(liveSandbox());

    const handle = await reconnect();

    expect(handle).not.toBeNull();
    expect(handle?.liveness).toBe("running");
    expect(handle?.id).toBe("vibe-validate-abc");
  });

  it.each(["stopped", "failed", "aborted", "pending", "stopping", "snapshotting"])(
    "reports a %s sandbox as gone rather than usable",
    async (status) => {
      // Only `running` is usable. `pending` and `stopping` are the interesting
      // ones: a sandbox that is merely *becoming* available is not the sandbox
      // that installed node_modules.
      get.mockResolvedValue(liveSandbox({ status }));

      expect(await reconnect()).toBeNull();
    },
  );

  it("reports a missing sandbox as gone rather than throwing", async () => {
    // An expired sandbox is an ordinary outcome, not an exception the caller
    // should have to classify.
    get.mockRejectedValue(new Error("not_found"));

    expect(await reconnect()).toBeNull();
  });

  it("never reports an unconfirmed reconnect as success", async () => {
    // Any provider fault resolves the same way on purpose: the next thing the
    // caller does is run a command that assumes a filesystem.
    get.mockRejectedValue({ weird: "shape" });

    expect(await reconnect()).toBeNull();
  });

  it("creates nothing when a reconnect fails", async () => {
    get.mockRejectedValue(new Error("not_found"));

    await reconnect();

    // `Sandbox.getOrCreate` exists and is exactly the wrong function here: it
    // would silently hand back a fresh, empty VM (§12).
    expect(create).not.toHaveBeenCalled();
  });
});
