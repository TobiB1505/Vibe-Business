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

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: (...args: unknown[]) => create(...args),
  },
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  create.mockReset();
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
