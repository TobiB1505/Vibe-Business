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
const update = vi.fn();
const listSessions = vi.fn();
const extendTimeout = vi.fn();

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: async (...args: unknown[]) => {
      const sandbox = await create(...args);
      return Object.assign(sandbox, {
        update: (...updateArgs: unknown[]) => update(...updateArgs),
        listSessions: (...listArgs: unknown[]) => listSessions(...listArgs),
        extendTimeout: (...extendArgs: unknown[]) => extendTimeout(...extendArgs),
      });
    },
    get: async (...args: unknown[]) => {
      const sandbox = await get(...args);
      // Mirrors `create`: a reconnected sandbox exposes the same session APIs
      // the adapter uses to diagnose one that ended early.
      return sandbox && typeof sandbox === "object"
        ? Object.assign(sandbox, {
            listSessions: (...listArgs: unknown[]) => listSessions(...listArgs),
            extendTimeout: (...extendArgs: unknown[]) => extendTimeout(...extendArgs),
          })
        : sandbox;
    },
  },
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  create.mockReset();
  get.mockReset();
  update.mockReset();
  update.mockResolvedValue(undefined);
  listSessions.mockReset();
  extendTimeout.mockReset();
  extendTimeout.mockResolvedValue(undefined);
  // A session that already carries the requested lifetime: the ordinary case,
  // where nothing needs extending.
  listSessions.mockResolvedValue({ sessions: [{ status: "running", timeout: 600_000 }] });
  // Since Sprint 0053 every `snapshot()` re-reads usage first, so tests about
  // something else still need a record to read. Individual tests override it.
  get.mockResolvedValue({
    name: "vibe-validate-abc",
    status: "running",
    totalActiveCpuDurationMs: 1,
    totalIngressBytes: 1,
    totalEgressBytes: 1,
  });
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
      kind: "git",
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

  it("reasserts the timeout on the live session after creation", async () => {
    await createSandbox();

    // The fifth dogfood session stopped after Vercel's five-minute default
    // despite `timeout` being present on create. `update()` is not redundant:
    // the SDK also extends a running session whose actual timeout is shorter
    // than the requested sandbox default.
    expect(update).toHaveBeenCalledWith({ timeout: 600_000 });
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
      source: { kind: "git", repositoryUrl: "https://github.com/acme/p.git", revision: "abc", credential: null },
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
      source: { kind: "git", repositoryUrl: "https://github.com/acme/p.git", revision: "abc", credential: null },
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

describe("capturing an artifact must not cost the ledger (Sprint 10B §5)", () => {
  async function capturedFailure(providerError: unknown): Promise<Error> {
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async snapshot() {
        throw providerError;
      },
      async stop() {
        return { activeCpuDurationMs: 1, networkTransfer: { ingress: 1, egress: 1 } };
      },
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    try {
      await sandbox.snapshot({ expirationMs: 60_000 });
      throw new Error("expected snapshot to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return error as Error;
    }
  }

  /**
   * `sandbox.snapshot()` terminates the sandbox. A later `stop()` therefore
   * throws — and `stop()` is where usage used to come from. Without capturing
   * usage at the moment of termination, retaining an artifact would silently
   * cost us the accounting for the whole run.
   */
  it("captures usage at snapshot time rather than through a stop() the provider would refuse", async () => {
    let stopped = false;
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async snapshot() {
        stopped = true;
        return { snapshotId: "snap_1", sizeBytes: 10, expiresAt: new Date(1) };
      },
      async stop() {
        // Exactly what the real provider does once snapshotted.
        if (stopped) throw new Error("sandbox is no longer running");
        return { activeCpuDurationMs: 1, networkTransfer: { ingress: 1, egress: 1 } };
      },
    });
    get.mockResolvedValue({
      name: "vibe-validate-abc",
      status: "stopped",
      totalActiveCpuDurationMs: 9876,
      totalIngressBytes: 4242,
      totalEgressBytes: 24,
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    const artifact = await sandbox.snapshot({ expirationMs: 60_000 });
    expect(artifact.snapshotId).toBe("snap_1");

    // Would throw without the captured usage.
    const usage = await sandbox.stop();
    expect(usage.activeCpuDurationMs).toBe(9876);
    expect(usage.networkIngressBytes).toBe(4242);
  });

  /**
   * Sprint 0051. The bug PART A found by reading the compiled SDK rather than
   * guessing: `sandbox.snapshot()` does not refresh the local `Sandbox`
   * instance's cached totals (only `.update()` and `.stop()` do), and the
   * `Snapshot` object it returns carries no usage fields at all. Reading
   * `this.sandbox.totalActiveCpuDurationMs` right after a snapshot was
   * therefore always reading the pre-run value the sandbox was constructed
   * with — never the finished run's — which is why 15 of 19 passing validation
   * rows in Vibe's own history have `active_cpu_ms: null`.
   *
   * This is the regression test: even when the local instance still carries a
   * stale (or absent) value, the fresh `Sandbox.get()` read must win.
   */
  it("ignores a stale local usage value and reads the fresh one from Sandbox.get after a snapshot", async () => {
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      // What the real SDK actually looks like right after construction: no
      // usage yet, because nothing has run.
      totalActiveCpuDurationMs: undefined,
      totalIngressBytes: undefined,
      totalEgressBytes: undefined,
      async snapshot() {
        // The real SDK does not mutate these fields as a side effect either.
        return { snapshotId: "snap_2", sizeBytes: 10, expiresAt: null };
      },
      async stop() {
        throw new Error("sandbox is no longer running");
      },
    });
    get.mockResolvedValue({
      name: "vibe-validate-abc",
      status: "stopped",
      totalActiveCpuDurationMs: 61_366,
      totalIngressBytes: 1000,
      totalEgressBytes: 3_717_473,
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    await sandbox.snapshot({ expirationMs: 60_000 });
    const usage = await sandbox.stop();

    expect(usage.activeCpuDurationMs).toBe(61_366);
    expect(usage.networkEgressBytes).toBe(3_717_473);
    // The re-read asks by name and never resumes a stopped session — the same
    // discipline `reconnect()` already holds to.
    expect(get).toHaveBeenCalledWith(expect.objectContaining({
      name: "vibe-validate-abc",
      resume: false,
    }));
  });

  it("leaves usage unknown, never guessed, when the fresh re-read fails", async () => {
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async snapshot() {
        return { snapshotId: "snap_3", sizeBytes: 10, expiresAt: null };
      },
      async stop() {
        throw new Error("sandbox is no longer running");
      },
    });
    get.mockRejectedValue(new Error("network blip"));

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    await sandbox.snapshot({ expirationMs: 60_000 });
    const usage = await sandbox.stop();

    expect(usage.activeCpuDurationMs).toBeNull();
    expect(usage.networkEgressBytes).toBeNull();
  });

  /**
   * Sprint 0053. The Sprint 0051 fix above did not work in production.
   *
   * The deployment carrying it went live at 15:00:59 on 2026-08-20. The
   * validation sandbox row written sixteen minutes later still recorded
   * `active_cpu_ms: null` — indistinguishable from every pre-fix row. The one
   * difference between this call and `reconnect()`'s demonstrably working
   * `Sandbox.get({ name, resume: false })` was *when* it ran: after
   * `snapshot()` had already terminated the sandbox.
   *
   * So the order is now the contract, and it is asserted as an order rather
   * than as an outcome — an outcome assertion passes on either ordering
   * against a mock, which is precisely why the previous version of this file
   * could not catch the defect.
   */
  it("reads usage while the sandbox is still alive, before the snapshot terminates it", async () => {
    const calls: string[] = [];
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async snapshot() {
        calls.push("snapshot");
        return { snapshotId: "snap_4", sizeBytes: 10, expiresAt: null };
      },
      async stop() {
        throw new Error("sandbox is no longer running");
      },
    });
    get.mockImplementation(async () => {
      calls.push("get");
      return {
        name: "vibe-validate-abc",
        status: "running",
        totalActiveCpuDurationMs: 61_366,
        totalIngressBytes: 1000,
        totalEgressBytes: 3_717_473,
      };
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    await sandbox.snapshot({ expirationMs: 60_000 });

    expect(calls).toEqual(["get", "snapshot"]);
    expect((await sandbox.stop()).activeCpuDurationMs).toBe(61_366);
  });

  /**
   * The hazard the reordering creates, and the reason the captured value is
   * assigned only after the snapshot returns.
   *
   * `stop()` treats a recorded `terminalUsage` as proof the sandbox is already
   * gone and refuses to call the provider again. Recording it before the
   * snapshot would mean a *failed* snapshot left a live VM that nothing would
   * ever stop — a leak lasting the sandbox's whole timeout, traded for one
   * tidier line.
   */
  it("still stops the sandbox for real when the snapshot itself failed", async () => {
    const stop = vi.fn(async () => ({
      activeCpuDurationMs: 4242,
      networkTransfer: { ingress: 1, egress: 2 },
    }));
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async snapshot() {
        throw new Error("snapshot rejected");
      },
      stop,
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    await expect(sandbox.snapshot({ expirationMs: 60_000 })).rejects.toThrow();

    const usage = await sandbox.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(usage.activeCpuDurationMs).toBe(4242);
  });

  /**
   * The silent `catch` is what hid the defect for an entire sprint: the read
   * failed in production and nothing anywhere said so. Both halves are logged
   * now — a failed call and a call that succeeded but carried no number are
   * different bugs, and last sprint they were indistinguishable.
   */
  it("says out loud when the usage re-read fails, naming no error message", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });

    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async snapshot() {
        return { snapshotId: "snap_5", sizeBytes: 10, expiresAt: null };
      },
      async stop() {
        throw new Error("sandbox is no longer running");
      },
    });
    get.mockRejectedValue(
      Object.assign(new Error("token=never-log-this"), { name: "APIError" }),
    );

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    await sandbox.snapshot({ expirationMs: 60_000 });
    spy.mockRestore();

    const serialised = JSON.stringify(logged);
    expect(serialised).toContain("the usage re-read failed");
    expect(serialised).toContain("APIError");
    // The name, never the message: a provider error carries request context
    // and credential-bearing material.
    expect(serialised).not.toContain("never-log-this");
  });

  it("says out loud when the re-read succeeded but carried no Active CPU", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });

    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      async snapshot() {
        return { snapshotId: "snap_6", sizeBytes: 10, expiresAt: null };
      },
      async stop() {
        throw new Error("sandbox is no longer running");
      },
    });
    // Exactly the production shape: the call works, the field is absent.
    get.mockResolvedValue({ name: "vibe-validate-abc", status: "running" });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    await sandbox.snapshot({ expirationMs: 60_000 });
    spy.mockRestore();

    expect(JSON.stringify(logged)).toContain("carried no Active CPU");
    // Still null, never a guess derived from wall duration (§25).
    expect((await sandbox.stop()).activeCpuDurationMs).toBeNull();
  });

  it("passes the explicit expiry through to the provider", async () => {
    const snapshot = vi.fn(async () => ({ snapshotId: "s", sizeBytes: 1, expiresAt: null }));
    create.mockResolvedValue({
      name: "vibe-validate-abc",
      runtime: "node24",
      snapshot,
      async stop() {
        return { activeCpuDurationMs: 1, networkTransfer: { ingress: 1, egress: 1 } };
      },
    });

    const { createVercelSandboxProvider } = await import("./provider");
    const sandbox = await createVercelSandboxProvider().create({
      name: "vibe-validate-abc",
      source: { kind: "git", repositoryUrl: "https://github.com/a/b.git", revision: "abc", credential: null },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
    });

    await sandbox.snapshot({ expirationMs: 60 * 60 * 1000 });

    // Never the provider's 30-day default.
    expect(snapshot).toHaveBeenCalledWith({ expiration: 60 * 60 * 1000 });
  });

  it("preserves the allowlisted Vercel API classification for a failed snapshot", async () => {
    const providerError = Object.assign(new Error("Status code 400 is not ok"), {
      name: "APIError",
      response: { status: 400, headers: { authorization: "Bearer never-store-this" } },
      json: {
        error: {
          code: "invalid_snapshot_expiration",
          message: "Snapshot expiration must satisfy the provider limit",
        },
      },
      text: '{"full":"raw response must never cross the adapter"}',
    });

    const error = await capturedFailure(providerError);

    expect(error.message).toContain("APIError: HTTP 400");
    expect(error.message).toContain("code=invalid_snapshot_expiration");
    expect(error.message).toContain("message=Snapshot expiration must satisfy the provider limit");
  });

  it("never serializes raw provider response material and redacts a secret in the allowed message", async () => {
    const token = `ghp_${"a".repeat(36)}`;
    const providerError = Object.assign(new Error("Status code 400 is not ok"), {
      name: "APIError",
      response: { status: 400, headers: { authorization: `Bearer ${token}` } },
      json: {
        error: { code: "snapshot_rejected", message: `token=${token}` },
        internalRequest: { authorization: token },
      },
      text: `raw-body-${token}`,
    });

    const error = await capturedFailure(providerError);

    expect(error.message).toContain("code=snapshot_rejected");
    expect(error.message).toContain("message=token=[redacted]");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain("authorization");
    expect(error.message).not.toContain("raw-body");
  });

  it("bounds an allowlisted provider message before it crosses the adapter", async () => {
    const providerError = Object.assign(new Error("Status code 400 is not ok"), {
      name: "APIError",
      response: { status: 400 },
      json: { error: { code: "snapshot_rejected", message: "x".repeat(10_000) } },
    });

    const error = await capturedFailure(providerError);

    expect(error.message).toContain("…[truncated]");
    expect(error.message.length).toBeLessThan(700);
  });

  it("restores from a snapshot without re-imaging it", async () => {
    const { createVercelSandboxProvider } = await import("./provider");
    await createVercelSandboxProvider().create({
      name: "vibe-preview-abc",
      source: { kind: "snapshot", snapshotId: "snap_1" },
      networkPolicy: { mode: "deny_all" },
      timeoutMs: 1000,
      env: {},
      ports: [3000],
    });

    const options = create.mock.calls[0][0] as Record<string, unknown>;
    expect(options.source).toEqual({ type: "snapshot", snapshotId: "snap_1" });
    // A snapshot carries its own image; re-imaging would make it a different artifact.
    expect(options).not.toHaveProperty("image");
    expect(options.ports).toEqual([3000]);
    expect(options.persistent).toBe(false);
  });
});

/**
 * The session's own deadline (found by dogfood, three runs deep).
 *
 * Three validations died within seconds of five minutes and were found
 * `stopped` at capture. `timeout` had been passed at creation and
 * `update({ timeout })` added afterwards, and neither helped.
 *
 * The diagnostic that followed produced an apparent contradiction —
 * `status=stopped timeout=900000` — which resolved into the actual bug:
 * `Sandbox.status` reads through to the **session**, while `Sandbox.timeout` is
 * the **sandbox-level default**. The two describe different objects, and the
 * value was landing on the one that does not govern how long the VM lives.
 */
describe("the session's lifetime, not just the sandbox's", () => {
  it("extends a session that came up short, by exactly the shortfall", async () => {
    listSessions.mockResolvedValue({ sessions: [{ status: "running", timeout: 300_000 }] });

    await createSandbox({ timeoutMs: 900_000 });

    // Exactly, not a round number. The lifetime is a leak bound, and
    // over-extending would let a runaway sandbox outlive the run's budget.
    expect(extendTimeout).toHaveBeenCalledWith(600_000);
  });

  it("leaves a session that already has the requested lifetime alone", async () => {
    listSessions.mockResolvedValue({ sessions: [{ status: "running", timeout: 900_000 }] });

    await createSandbox({ timeoutMs: 900_000 });

    expect(extendTimeout).not.toHaveBeenCalled();
  });

  it("never shortens a session that has more than was asked for", async () => {
    listSessions.mockResolvedValue({ sessions: [{ status: "running", timeout: 1_800_000 }] });

    await createSandbox({ timeoutMs: 900_000 });

    expect(extendTimeout).not.toHaveBeenCalled();
  });

  it("does not fail creation when the session cannot be read", async () => {
    listSessions.mockRejectedValue(new Error("list unavailable"));

    // The sandbox-level value is evidence the bound was accepted somewhere, and
    // failing a working run over a list call would trade a real outcome for a
    // tidy one.
    await expect(createSandbox({ timeoutMs: 900_000 })).resolves.toBeDefined();
  });

  it("fails creation when a short session cannot be extended", async () => {
    listSessions.mockResolvedValue({ sessions: [{ status: "running", timeout: 300_000 }] });
    extendTimeout.mockRejectedValue(new Error("cannot extend"));

    // A clear failure now beats a mystery death four minutes in, which is
    // exactly what the last three dogfood runs were.
    await expect(createSandbox({ timeoutMs: 900_000 })).rejects.toThrow();
  });
});

describe("attributing a session that ended early", () => {
  async function inspect() {
    const { createVercelSandboxProvider } = await import("./provider");
    return createVercelSandboxProvider().inspect({ name: "vibe-validate-abc" });
  }

  it("names what asked the session to stop", async () => {
    get.mockResolvedValue({ name: "vibe-validate-abc", status: "stopped", timeout: 900_000 });
    listSessions.mockResolvedValue({
      sessions: [
        { status: "stopped", timeout: 900_000, startedAt: 1000, stoppedAt: 283_318, requestedStopAt: 283_000 },
      ],
    });

    const detail = await inspect();

    // A session with 900000 ms of deadline that stopped after 282318 ms did not
    // time out. The remaining question is who ended it, and a stop *request* is
    // a different bug from a provider-side termination.
    expect(detail).toContain("sessionTimeout=900000");
    expect(detail).toContain("livedMs=282318");
    expect(detail).toContain("requestedStop=283000");
  });

  it("says so explicitly when nothing accounts for the ending", async () => {
    get.mockResolvedValue({ name: "vibe-validate-abc", status: "stopped", timeout: 900_000 });
    listSessions.mockResolvedValue({
      sessions: [{ status: "stopped", timeout: 900_000, startedAt: 1000, stoppedAt: 283_318 }],
    });

    // The absence of an attribution is itself the finding, so it is stated
    // rather than left as a gap in the line.
    expect(await inspect()).toContain("endedBy=unattributed");
  });
});
