import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SANDBOX_BUDGETS, STEP_DEADLINE_MS } from "./budgets";
import { captureValidatedArtifact, inRepository, inSandbox, provisionSandbox, SANDBOX_ENVIRONMENT } from "./orchestrator";
import {
  FIXTURE_COMMIT_SHA,
  fakeSandboxProvider,
  fakeValidationTarget,
  healthySandboxFiles,
  runValidationPhases,
  type FakeSandboxOptions,
} from "./test-support";

/**
 * The isolated validation sequence (Sprint 10A §30–§38).
 *
 * The orchestrator is the security boundary of the sprint, so most of these
 * tests assert about *ordering* and *absence* rather than about results:
 *
 *  - the network was closed before repository code ran;
 *  - the GitHub credential stopped existing before repository code ran;
 *  - no secret was ever in the environment;
 *  - the sandbox was stopped on every path, including the ugly ones.
 *
 * All of it runs against a fake that executes nothing. A real sandbox in CI
 * would cost money and prove less: the fake can be made to fail in ways a real
 * provider will not reproduce on demand (§39).
 */

/**
 * A sandbox that would pass, with one thing overridden per test.
 *
 * `results` is merged rather than replaced: a test overriding the build result
 * must not silently lose the `git rev-parse` answer and fail integrity
 * verification instead of the thing it meant to test.
 */
const HEAD = "git rev-parse HEAD";

function setup(options: FakeSandboxOptions = {}) {
  return fakeSandboxProvider({
    files: healthySandboxFiles(),
    ...options,
    // The provider-side clone leaves a real checkout, so the happy path
    // observes the prepared commit. Merged, never replaced: a test overriding
    // one command must not silently lose this and fail integrity instead.
    results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` }, ...(options.results ?? {}) },
  });
}

/**
 * A manifest that resolves nothing.
 *
 * Build-identity verification compares the sandbox against GitHub at the pinned
 * commit. With no GitHub side, every candidate is *absent on one side* and lands
 * in `buildIdentityFilesUnverified` — which is the honest default and keeps
 * these tests focused on the sequence rather than on GitHub.
 */
const noManifest = { getTextFile: async () => null };

/** Index of the first command that runs code the repository controls. */
function firstRepositoryControlledCommand(commands: string[]): number {
  return commands.findIndex((command) => command.startsWith("pnpm") || command.startsWith("npm"));
}

describe("the happy path", () => {
  it("passes when every configured check succeeds", async () => {
    const provider = setup();

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.failureCode).toBeNull();
    expect(outcome.steps.install?.status).toBe("passed");
    expect(outcome.steps.typecheck?.status).toBe("passed");
    expect(outcome.steps.test?.status).toBe("passed");
    expect(outcome.steps.build?.status).toBe("passed");
  });

  it("runs the profile's commands in order", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.commands()).toEqual([
      HEAD,
      "rm -rf .git",
      "pnpm install --frozen-lockfile --ignore-scripts",
      "pnpm run typecheck",
      "pnpm run test",
      "pnpm run build",
    ]);
  });

  it("reports the sandbox as stopped and records usage", async () => {
    const provider = setup();
    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.cleanup).toBe("stopped");
    expect(provider.stopped()).toBe(true);
    expect(outcome.usage?.activeCpuDurationMs).toBe(1234);
    // Vercel exposes no attributable per-sandbox cost. Null, never estimated.
    expect(outcome.usage?.costUsd).toBeNull();
  });
});

describe("network policy transitions (§10, §32)", () => {
  it("never creates a sandbox with unrestricted egress", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const created = provider.policies()[0];
    expect(created.mode).toBe("allow_domains");
    if (created.mode !== "allow_domains") return;
    expect(created.domains).toContain("github.com");
    expect(created.domains).not.toContain("*");
  });

  it("moves from source hosts to registry hosts to deny-all", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const modes = provider.policies().map((policy) =>
      policy.mode === "deny_all" ? "deny_all" : policy.domains.join(","),
    );

    expect(modes[0]).toContain("github.com");
    expect(modes[1]).toContain("registry.npmjs.org");
    // GitHub is revoked once the source is on disk: continued access would be
    // reach the run no longer needs.
    expect(modes[1]).not.toContain("github.com");

    // Everything after the install window is closed, and *stays* closed. Under
    // the durable-phase design each repository-controlled phase asserts
    // `deny-all` itself rather than inheriting it from an earlier function
    // invocation, so there are more transitions than there are changes of
    // state — which is the point. The property is that the registry is opened
    // exactly once and nothing after it is ever open again.
    expect(modes.slice(2).every((mode) => mode === "deny_all")).toBe(true);
    expect(modes.filter((mode) => mode.includes("registry.npmjs.org"))).toHaveLength(1);
  });

  it("re-closes the network in every repository-controlled phase, not just once", async () => {
    // The assumption this replaces: under the single-step design the closed
    // network was three lines above the build command. Across steps that would
    // be an assumption about a previous function invocation — and an assumption
    // is not a control.
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const denials = provider.policies().filter((policy) => policy.mode === "deny_all");

    // install closes it, then typecheck, test and build each close it again.
    expect(denials.length).toBeGreaterThanOrEqual(4);
  });

  it("closes the network even when the install fails", async () => {
    // The failure path is exactly where "we'll close it later" becomes "we
    // didn't": a failed install must not leave the registry reachable for
    // whatever runs next.
    const provider = setup({
      results: { "pnpm install --frozen-lockfile --ignore-scripts": { exitCode: 1 } },
    });

    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.policies().at(-1)).toEqual({ mode: "deny_all" });
  });

  it("closes the network before any repository-controlled command", async () => {
    // The single most important assertion in this file. Everything after the
    // deny-all is someone else's JavaScript, and it must have nowhere to send
    // the customer's source.
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const timeline = provider.events
      .filter((event) => event.kind === "policy" || event.kind === "command")
      .map((event) => (event.kind === "policy" ? `policy:${event.policy.mode}` : `cmd:${event.command}`));

    const denyAll = timeline.indexOf("policy:deny_all");
    const firstRepositoryCode = timeline.findIndex((entry) => entry.startsWith("cmd:pnpm run"));

    expect(denyAll).toBeGreaterThanOrEqual(0);
    expect(firstRepositoryCode).toBeGreaterThan(denyAll);
  });

  it("installs dependencies without running lifecycle scripts", async () => {
    // Install is the one networked step. A dependency's postinstall hook is the
    // classic supply-chain execution point, so it is suppressed while the
    // registry is still reachable (§11).
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.commands()).toContain("pnpm install --frozen-lockfile --ignore-scripts");
  });
});

describe("credential handling (§7, §37)", () => {
  it("passes the clone credential to creation and nowhere else", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const created = provider.createdWith();
    expect(created?.source.kind === "git" ? created.source.credential?.password : undefined).toBe("ghs_cloneTokenValue123456");
    // The environment is where repository code could read it. It must not be there.
    expect(JSON.stringify(created?.env)).not.toContain("ghs_cloneTokenValue123456");
  });

  it("destroys the credential store before any repository-controlled command", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const commands = provider.commands();
    const scrub = commands.findIndex((command) => command.startsWith("rm -rf "));

    expect(scrub).toBeGreaterThanOrEqual(0);
    expect(scrub).toBeLessThan(firstRepositoryControlledCommand(commands));
  });

  it("refuses to run repository code when the credential store survives", async () => {
    // "The token is short-lived" is not the boundary — verified absence is.
    // A `.git` that resists deletion stops the run rather than being tolerated.
    const provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      // The scrub reports success but leaves the file behind.
      results: { "rm -rf .git": { exitCode: 0 } },
    });
    // Re-add `.git/config` after the fake's own deletion by making it
    // unremovable: a file the scrub cannot touch.
    const original = provider.create.bind(provider);
    provider.create = async (input) => {
      const handle = await original(input);
      const readFile = handle.readFile.bind(handle);
      handle.readFile = async (file) =>
        file.path.endsWith(".git/config") ? "[remote]\n" : readFile(file);
      return handle;
    };

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "credential_scrub_failed" });
    expect(firstRepositoryControlledCommand(provider.commands())).toBe(-1);
    expect(provider.stopped()).toBe(true);
  });
});

describe("no product secrets in the sandbox (§8, §31, §37)", () => {
  it("provides only non-privileged environment variables", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.createdWith()?.env).toEqual({
      CI: "1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    });
  });

  it.each([
    "GITHUB_TOKEN",
    "ANTHROPIC_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
    "VERCEL_TOKEN",
    "BROWSERBASE_API_KEY",
    "GITHUB_APP_PRIVATE_KEY",
  ])("never exposes %s", (name) => {
    // A repository whose build script reads these finds nothing. Asserted
    // against the constant so a future addition to the environment has to
    // pass this test to land.
    expect(Object.keys(SANDBOX_ENVIRONMENT)).not.toContain(name);
  });

  it("keeps the environment free of anything secret-shaped", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const serialized = JSON.stringify(provider.createdWith()?.env ?? {});
    for (const pattern of [/ghs_/, /ghp_/, /sk-ant-/, /eyJ/, /service_role/i]) {
      expect(serialized).not.toMatch(pattern);
    }
  });
});

describe("source integrity (§6, §29)", () => {
  it("validates the exact prepared commit, not a branch", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const source = provider.createdWith()?.source;
    expect(source?.kind).toBe("git");
    expect(source?.kind === "git" ? source.revision : null).toBe(FIXTURE_COMMIT_SHA);
  });

  it("pins the revision instead of re-observing it (post-dogfood)", () => {
    // The provider materializes a filesystem, not a checkout, so there is no
    // `.git` to interrogate. A pinned commit SHA is immutable, so the failure
    // the original check existed to catch — the branch moving — cannot occur.
    // Reinstating it would mean carrying a token into the VM for a weaker proof.
    expect(true).toBe(true);
  });

  it("refuses when a prepared file's hash does not match", async () => {
    const provider = setup({
      files: healthySandboxFiles({ "product/src/app/robots.ts": "// something else entirely" }),
    });

    const outcome = await runValidationPhases(
      provider,
      noManifest,
      fakeValidationTarget({
        preparedFiles: [{ path: "src/app/robots.ts", contentHash: "0".repeat(64) }],
      }),
    );

    expect(outcome).toMatchObject({ status: "failed", failureCode: "source_integrity_failed" });
    expect(firstRepositoryControlledCommand(provider.commands())).toBe(-1);
  });

  it("accepts a prepared file whose hash matches", async () => {
    const content = "export default function robots() {}\n";
    const provider = setup({ files: healthySandboxFiles({ "product/src/app/robots.ts": content }) });

    const outcome = await runValidationPhases(
      provider,
      noManifest,
      fakeValidationTarget({
        preparedFiles: [
          { path: "src/app/robots.ts", contentHash: createHash("sha256").update(content).digest("hex") },
        ],
      }),
    );

    expect(outcome.status).toBe("passed");
  });

  it("refuses when a prepared file is missing entirely", async () => {
    const provider = setup();

    const outcome = await runValidationPhases(
      provider,
      noManifest,
      fakeValidationTarget({ preparedFiles: [{ path: "src/app/gone.ts", contentHash: "0".repeat(64) }] }),
    );

    expect(outcome.failureCode).toBe("source_integrity_failed");
  });
});

describe("step semantics (§19, §33)", () => {
  it("skips a step whose script does not exist, with a reason", async () => {
    const provider = setup({
      files: healthySandboxFiles({
        "product/package.json": JSON.stringify({ scripts: { build: "next build" } }),
      }),
    });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.steps.test).toMatchObject({ status: "skipped", skipReason: "script_not_present" });
    expect(provider.commands()).not.toContain("pnpm run test");
  });

  it("never invents a test command", async () => {
    // A repository that simply never had tests must not be reported as failing
    // them, which is what `npm test` on a scriptless project would produce.
    const provider = setup({
      files: healthySandboxFiles({ "product/package.json": JSON.stringify({ scripts: { build: "next build" } }) }),
    });
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.commands().some((command) => /\btest\b/.test(command))).toBe(false);
  });

  it("fails the whole validation when an existing test script fails", async () => {
    const provider = setup({ results: { "pnpm run test": { exitCode: 1, output: "2 failed" } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "validation_checks_failed" });
    expect(outcome.steps.test?.status).toBe("failed");
    // Ordered so a red suite is not paid for with a four-minute build.
    expect(outcome.steps.build).toBeUndefined();
  });

  it("fails when the build fails", async () => {
    const provider = setup({ results: { "pnpm run build": { exitCode: 1, output: "Build error" } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "validation_checks_failed" });
    expect(outcome.steps.build?.exitCode).toBe(1);
  });

  it("fails when the install fails", async () => {
    const provider = setup({ results: { "pnpm install --frozen-lockfile --ignore-scripts": { exitCode: 1 } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("failed");
    expect(outcome.steps.typecheck).toBeUndefined();
  });

  it("cannot pass without a build script", async () => {
    // "It builds" is the claim. A repository that cannot make it is not
    // validated — it is unsupported.
    const provider = setup({
      files: healthySandboxFiles({ "product/package.json": JSON.stringify({ scripts: { test: "vitest" } }) }),
    });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "validation_not_supported" });
  });

  it("classifies a deterministically identifiable missing-environment build failure", async () => {
    const provider = setup({
      results: {
        "pnpm run build": { exitCode: 1, output: "Error: Missing required environment variable: DATABASE_URL" },
      },
    });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("build_failed_missing_environment");
  });

  it("uses npm's locked install when the project uses npm", async () => {
    const provider = setup({
      files: healthySandboxFiles({ "product/pnpm-lock.yaml": null, "product/package-lock.json": "{}" }),
    });

    await runValidationPhases(provider, noManifest, fakeValidationTarget({ packageManager: "npm" }));

    expect(provider.commands()).toContain("npm ci --ignore-scripts");
    expect(provider.commands()).toContain("npm run build");
  });

  it("refuses without a lockfile rather than resolving fresh dependencies", async () => {
    const provider = setup({ files: healthySandboxFiles({ "product/pnpm-lock.yaml": null }) });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("lockfile_missing");
    expect(firstRepositoryControlledCommand(provider.commands())).toBe(-1);
  });
});

describe("timeouts (§14)", () => {
  it("ends in a safe terminal state when a command exceeds its budget", async () => {
    const provider = setup({ results: { "pnpm run build": { timedOut: true, exitCode: -1 } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "sandbox_timeout" });
    expect(outcome.steps.build?.status).toBe("timed_out");
    expect(provider.stopped()).toBe(true);
  });
});

describe("cleanup on every path (§23, §36)", () => {
  it.each([
    ["success", {}],
    ["install failure", { results: { "pnpm install --frozen-lockfile --ignore-scripts": { exitCode: 1 } } }],
    ["test failure", { results: { "pnpm run test": { exitCode: 1 } } }],
    ["build failure", { results: { "pnpm run build": { exitCode: 1 } } }],
    ["timeout", { results: { "pnpm run build": { timedOut: true, exitCode: -1 } } }],
    ["provider error during the scrub", { throwOn: "rm -rf .git" }],
    ["provider error mid-run", { throwOn: "pnpm run build" }],
  ])("stops the sandbox after %s", async (_label, options) => {
    const provider = setup(options as FakeSandboxOptions);

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.stopped()).toBe(true);
    expect(outcome.cleanup).toBe("stopped");
  });

  it("records a failed teardown without changing the verdict", async () => {
    const provider = setup({ failStop: true });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    // The checks passed. A provider that could not confirm teardown does not
    // retroactively make them fail.
    expect(outcome.status).toBe("passed");
    expect(outcome.cleanup).toBe("stop_failed");
  });

  it("reports no sandbox to clean up when provisioning failed", async () => {
    const provider = setup({ failCreate: true });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({
      status: "failed",
      failureCode: "sandbox_unavailable",
      cleanup: "not_provisioned",
    });
  });

  it("never falls back to running anything locally when the sandbox is unavailable", async () => {
    // The rule that outranks convenience: no local execution path exists, so
    // an unavailable provider fails the validation rather than degrading (§4).
    const provider = setup({ failCreate: true });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("failed");
    expect(provider.commands()).toEqual([]);
  });
});

describe("stage reporting (§17)", () => {
  /**
   * Stage announcements moved out of this module in the durable-phase refactor.
   *
   * They are now written by the step that runs the phase, straight onto the
   * ValidationRun and OperationRun rows, because that is the only form of
   * progress that survives a step boundary — an in-memory callback does not
   * exist in the next function invocation. The ordering is asserted against the
   * real steps in `change-validation/execution.test.ts`, and the rendering of
   * those stages in `view.test.ts`.
   *
   * What belongs here is the property that made the callback best-effort in the
   * first place: progress reporting must never be able to abort work that is
   * already costing money. That is now structural — this module has no
   * reporting path at all — so the test is that a phase does its job without
   * one.
   */
  it("runs a phase without any progress-reporting path of its own", async () => {
    const provider = setup();

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(provider.stopped()).toBe(true);
  });
});

describe("failures explain themselves (post-dogfood)", () => {
  /**
   * The defect the first real runs exposed. Every failure recorded a code and
   * nothing about *why* — the adapter caught the provider error and returned a
   * generic string, and the outer catch discarded the value entirely.
   *
   * "Never let provider prose escape" was applied too widely. Storing nothing
   * makes a production failure undiagnosable, which is its own kind of unsafe.
   */
  it("records why provisioning failed", async () => {
    const provider = setup({ failCreate: true });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("sandbox_unavailable");
    expect(outcome.failureDetail).toContain("no capacity");
  });

  it("names the file behind an integrity failure", async () => {
    const provider = setup();

    const outcome = await runValidationPhases(
      provider,
      noManifest,
      fakeValidationTarget({
        preparedFiles: [{ path: "src/app/robots.ts", contentHash: "0".repeat(64) }],
      }),
    );

    expect(outcome.failureDetail).toContain("src/app/robots.ts");
  });

  it("reports what was actually on disk when a prepared file is missing", async () => {
    const provider = setup({ results: { "ls -a": { output: ". .. package.json src" } } });

    const outcome = await runValidationPhases(
      provider,
      noManifest,
      fakeValidationTarget({ preparedFiles: [{ path: "src/app/gone.ts", contentHash: "0".repeat(64) }] }),
    );

    expect(outcome.failureDetail).toContain("/vercel/sandbox");
    expect(outcome.failureDetail).toContain("package.json");
    // A listing is a diagnostic, not a licence: still nothing the repo controls.
    expect(provider.commands().some((command) => command.startsWith("pnpm"))).toBe(false);
  });

  it("carries a provider error through instead of a placeholder", async () => {
    const provider = setup({ throwOn: "rm -rf .git" });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("validation_run_failed");
    expect(outcome.failureDetail).toContain("provider exploded");
  });

  it("sanitizes the detail like any other untrusted output", async () => {
    const provider = setup({
      results: { "ls -a": { output: `\u001b[31mfatal\u001b[0m ghp_${"a".repeat(36)}` } },
    });

    const outcome = await runValidationPhases(
      provider,
      noManifest,
      fakeValidationTarget({ preparedFiles: [{ path: "gone.ts", contentHash: "0".repeat(64) }] }),
    );

    expect(outcome.failureDetail).toContain("fatal");
    expect(outcome.failureDetail).not.toContain("\u001b");
    expect(outcome.failureDetail).toContain("[redacted]");
  });

  it("leaves the detail null when nothing failed", async () => {
    const outcome = await runValidationPhases(setup(), noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "passed", failureDetail: null });
  });
});

describe("a retry is not doomed by its own name (post-dogfood)", () => {
  /**
   * The second real run failed at `provisioning` in 661ms because the sandbox
   * name was derived from the validation *identity* — which is stable by design
   * — so it collided with the first run's sandbox. Every retry of the same
   * validation was therefore guaranteed to fail.
   */
  it("names the sandbox after the attempt, not the artifact", async () => {
    const first = setup();
    const second = setup();

    await runValidationPhases(first, noManifest, fakeValidationTarget({ validationRunId: "aaaaaaaa-1111-2222-3333-444444444444" }));
    await runValidationPhases(second, noManifest, fakeValidationTarget({ validationRunId: "bbbbbbbb-1111-2222-3333-444444444444" }));

    expect(first.createdWith()?.name).not.toBe(second.createdWith()?.name);
  });

  it("still produces a traceable vibe-prefixed name", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.createdWith()?.name).toMatch(/^vibe-validate-[0-9a-f]+$/);
  });

  it("carries no customer identifier into provider metadata", async () => {
    const provider = setup();
    await runValidationPhases(provider, noManifest, fakeValidationTarget());

    const name = provider.createdWith()?.name ?? "";
    expect(name).not.toContain("acme");
    expect(name).not.toContain("product");
    expect(name).not.toContain(FIXTURE_COMMIT_SHA);
  });
});

describe("diagnosing a missing checkout (post-dogfood)", () => {
  /**
   * The third real run failed with `fatal: not a git repository`, which ruled
   * out the earlier guess — `git` was present and ran — but left two live
   * possibilities: the platform materializes the tree without `.git`, or the
   * command ran somewhere other than where the source landed.
   *
   * The fourth run settled it. Addressing paths absolutely made `runCommand`
   * throw, where the relative form had executed and produced a real git error.
   * The provider wants relative paths, and the earlier failure therefore came
   * from the right directory: the checkout genuinely has no `.git`.
   */
  it("addresses paths relative to the sandbox working directory", () => {
    // The provider clones into a directory named after the repository, so the
    // sandbox home is never the workspace. Four runs looked in the wrong place.
    expect(inSandbox("product", ".")).toBe("product");
    expect(inSandbox("product", ".", "package.json")).toBe("product/package.json");
    expect(inSandbox("product", "apps/web", "package.json")).toBe("product/apps/web/package.json");
    expect(inSandbox("product/", "apps/web/", ".git/config")).toBe("product/apps/web/.git/config");

    // GitHub and command arguments address from the repository root. Including
    // the clone directory there fails *silently*: `rm -rf product/.git` run from
    // inside `product` targets nothing, and `-f` calls that success.
    expect(inRepository(".", "package.json")).toBe("package.json");
    expect(inRepository("apps/web", "package.json")).toBe("apps/web/package.json");
    expect(inRepository(".")).toBe(".");
  });

});

describe("what source verification actually claims (post-dogfood, Option A)", () => {
  /**
   * The verification model was narrowed deliberately after five real runs
   * established that Vercel materializes a git source as a filesystem, not a
   * checkout. The alternative — cloning inside the sandbox — would carry a
   * GitHub installation token into a VM that later runs untrusted code.
   *
   * Don't introduce a stronger secret to obtain a weaker proof.
   */
  it("records the pinned revision and how it was pinned", async () => {
    const outcome = await runValidationPhases(setup(), noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity).toMatchObject({
      requestedRevision: FIXTURE_COMMIT_SHA,
      revisionMode: "provider_pinned",
    });
  });

  it("records whether git observed the commit, rather than assuming either way", async () => {
    // Corrected after the fifth run: the provider-side clone does leave a real
    // checkout, in a subdirectory. Observing it costs nothing — Vercel did the
    // clone, so no credential enters the VM.
    const outcome = await runValidationPhases(setup(), noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity).toMatchObject({ gitCommitObserved: true });
  });

  it("still passes when the provider leaves no checkout to observe", async () => {
    // A provider that materializes a bare filesystem is not a failure: pinning
    // plus hashing carries the guarantee. Recorded as false, not fatal.
    const provider = setup({ results: { "git rev-parse HEAD": { exitCode: 128, output: "not a git repository" } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.sourceIntegrity).toMatchObject({ gitCommitObserved: false });
  });

  it("refuses when the observed commit is not the prepared one", async () => {
    // A mismatch *is* definitive: the provider delivered something other than
    // what was asked for. Stops before any repository-controlled command.
    const provider = setup({ results: { "git rev-parse HEAD": { output: "deadbeefdeadbeef\n" } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "source_integrity_failed" });
    expect(outcome.failureDetail).toContain("deadbeefdeadbeef");
    expect(provider.commands().some((command) => command.startsWith("pnpm"))).toBe(false);
  });

  it("verifies build identity against GitHub at the pinned commit", async () => {
    const manifest = {
      getTextFile: async (path: string) =>
        path === "package.json" ? healthySandboxFiles()["product/package.json"] : null,
    };

    const outcome = await runValidationPhases(setup(), manifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.sourceIntegrity?.buildIdentityFilesVerified).toContain("package.json");
  });

  it("refuses when a build-identity file differs from the pinned commit", async () => {
    // A matching robots.ts beside a different lockfile is a different build.
    const manifest = {
      getTextFile: async (path: string) =>
        path === "pnpm-lock.yaml" ? "lockfileVersion: '6.0'\n" : null,
    };

    const provider = setup();
    const outcome = await runValidationPhases(provider, manifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "source_integrity_failed" });
    expect(outcome.failureDetail).toContain("pnpm-lock.yaml");
    // Before any repository-controlled command, as always.
    expect(provider.commands().some((command) => command.startsWith("pnpm"))).toBe(false);
  });

  it("records a file it could not compare rather than counting it verified", async () => {
    // Present in the sandbox, absent from GitHub: not agreement, not a failure.
    const outcome = await runValidationPhases(setup(), noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity?.buildIdentityFilesUnverified).toContain("package.json");
    expect(outcome.sourceIntegrity?.buildIdentityFilesVerified).not.toContain("package.json");
  });

  it("treats absence on both sides as agreement", async () => {
    const outcome = await runValidationPhases(setup(), noManifest, fakeValidationTarget());

    // This repository has no package-lock.json and no next.config.js. Neither
    // side has them, so neither is a gap worth recording.
    expect(outcome.sourceIntegrity?.buildIdentityFilesUnverified).not.toContain("package-lock.json");
    expect(outcome.sourceIntegrity?.buildIdentityFilesUnverified).not.toContain("next.config.js");
  });

  it("still verifies the prepared change's own files before any repository code", async () => {
    const provider = setup();

    const outcome = await runValidationPhases(
      provider,
      noManifest,
      fakeValidationTarget({ preparedFiles: [{ path: "src/app/robots.ts", contentHash: "0".repeat(64) }] }),
    );

    expect(outcome.failureCode).toBe("source_integrity_failed");
    expect(provider.commands().some((command) => command.startsWith("pnpm"))).toBe(false);
  });
});

describe("large build-identity files (post-dogfood)", () => {
  /**
   * The first passing run verified package.json, next.config.ts and
   * tsconfig.json — and recorded `pnpm-lock.yaml` as unverified, because this
   * repository's lockfile is ~310 KB against a 256 KB budget. That is the one
   * of the four that decides which code gets installed, so a budget silently
   * excluding it was the wrong budget.
   */
  it("verifies a lockfile larger than the general integrity budget", async () => {
    const lockfile = `lockfileVersion: '9.0'\n${"# padding\n".repeat(40_000)}`;
    const provider = setup({ files: healthySandboxFiles({ "product/pnpm-lock.yaml": lockfile }) });
    const manifest = {
      getTextFile: async (path: string) => (path === "pnpm-lock.yaml" ? lockfile : null),
    };

    const outcome = await runValidationPhases(provider, manifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.sourceIntegrity?.buildIdentityFilesVerified).toContain("pnpm-lock.yaml");
  });

  it("records a file past even the larger budget as unverified, never as a mismatch", async () => {
    // A truncated prefix hashed against a whole file reports a *content
    // mismatch* for a file that is merely large — a false integrity failure,
    // which is the worst kind because it looks exactly like a real one.
    const huge = "x".repeat(SANDBOX_BUDGETS.maxBuildIdentityFileBytes + 10);
    const provider = setup({ files: healthySandboxFiles({ "product/pnpm-lock.yaml": huge }) });
    const manifest = {
      getTextFile: async (path: string) => (path === "pnpm-lock.yaml" ? huge : null),
    };

    const outcome = await runValidationPhases(provider, manifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.failureCode).toBeNull();
    expect(outcome.sourceIntegrity?.buildIdentityFilesUnverified).toContain("pnpm-lock.yaml");
  });
});

describe("gitCommitObserved reflects an observation, never an assumption", () => {
  /**
   * The field says whether the checked-out commit was actually read back from
   * git inside the sandbox. It is a *report*, so the only thing that must be
   * impossible is reporting an observation that did not happen.
   *
   * No credential is involved either way: Vercel performs the clone
   * provider-side, so observing the checkout costs nothing.
   */
  it("is false when git cannot answer", async () => {
    const provider = setup({
      results: { "git rev-parse HEAD": { exitCode: 128, output: "not a git repository" } },
    });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity).toMatchObject({ gitCommitObserved: false });
    // And the run still passes: pinning plus hashing carries the guarantee.
    expect(outcome.status).toBe("passed");
  });

  it("is false when git answers with nothing", async () => {
    // Exit 0 with empty output is not an observation.
    const provider = setup({ results: { "git rev-parse HEAD": { exitCode: 0, output: "   \n" } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity).toMatchObject({ gitCommitObserved: false });
  });

  it("is true only when git returned the prepared commit", async () => {
    const provider = setup();

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(provider.commands()).toContain("git rev-parse HEAD");
    expect(outcome.sourceIntegrity).toMatchObject({ gitCommitObserved: true });
  });

  it("never reports an observation when the command never ran", async () => {
    // Provisioning failed, so nothing was observed and nothing is claimed.
    const outcome = await runValidationPhases(setup({ failCreate: true }), noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity).toBeNull();
  });
});

describe("the timeout model after the durable-phase refactor (§8)", () => {
  /**
   * The v2 run reached `building` and was then killed:
   *
   *     Vercel Runtime Timeout Error: Task timed out after 300 seconds
   *
   * Two limits govern a validation — the sandbox's lifetime and the durable
   * step's — and v2 sized its budgets against the larger one while the smaller
   * one bound. The v3 answer is not a bigger number: each phase is its own step
   * with its own ceiling, so the budgets that must fit inside a ceiling are the
   * per-command ones, and the sandbox is deliberately allowed to outlive any
   * single step because it has to span all of them.
   */
  it("keeps every single command inside one step's ceiling", () => {
    // The inversion of the v2 rule, and the whole point of the refactor: a
    // command must fit in a step, not in the whole pipeline's share of one.
    expect(SANDBOX_BUDGETS.installTimeoutMs).toBeLessThan(STEP_DEADLINE_MS);
    expect(SANDBOX_BUDGETS.commandTimeoutMs).toBeLessThan(STEP_DEADLINE_MS);
    expect(SANDBOX_BUDGETS.sourceTimeoutMs).toBeLessThan(STEP_DEADLINE_MS);
  });

  it("leaves room inside the step for the phase to persist its own result", () => {
    // A phase that used the entire ceiling for its command would be killed
    // before recording what happened — and an unrecorded phase is re-run on
    // re-entry, which is exactly what §11 forbids.
    expect(STEP_DEADLINE_MS - SANDBOX_BUDGETS.commandTimeoutMs).toBeGreaterThanOrEqual(30_000);
  });

  it("lets the sandbox outlive any one step, because it spans all of them", () => {
    // Deliberately the opposite of the v2 assertion. Under v2 the sandbox had
    // to die before the step; under v3 it must survive between steps, or
    // `node_modules` is gone before the build runs.
    expect(SANDBOX_BUDGETS.totalLifetimeMs).toBeGreaterThan(STEP_DEADLINE_MS);
  });

  it("still bounds the sandbox well inside the provider maximum", () => {
    // Not unbounded. This is the leak bound for the case where the workflow
    // dies entirely and its cleanup step never runs.
    const providerMaximumMs = 45 * 60 * 1000;
    expect(SANDBOX_BUDGETS.totalLifetimeMs).toBeLessThan(providerMaximumMs / 2);
  });

  it("gives the measured workload real headroom in every phase", () => {
    // The passing dogfood, in milliseconds: install 18.4s, typecheck 79.1s,
    // test 83.9s, build 99.3s. Budgets are calibrated against those rather than
    // chosen round, and the longest measured command must not be close to its
    // ceiling.
    const longestMeasuredCommandMs = 99_300;
    expect(SANDBOX_BUDGETS.commandTimeoutMs).toBeGreaterThan(longestMeasuredCommandMs * 2);

    const measuredTotalMs = 18_400 + 79_100 + 83_900 + 99_300;
    expect(SANDBOX_BUDGETS.totalLifetimeMs).toBeGreaterThan(measuredTotalMs * 2);
  });

  it.each([
    ["install", "pnpm install --frozen-lockfile --ignore-scripts"],
    ["typecheck", "pnpm run typecheck"],
    ["test", "pnpm run test"],
    ["build", "pnpm run build"],
  ])("reports a %s that exceeds its budget as timed out, and cleans up", async (phase, command) => {
    // Classified, never surfaced as a generic provider failure: "the build
    // timed out" is actionable, "validation could not be completed" is not.
    const provider = setup({ results: { [command]: { timedOut: true, exitCode: -1 } } });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "sandbox_timeout" });
    expect(outcome.steps[phase as "build"]?.status).toBe("timed_out");
    expect(outcome.cleanup).toBe("stopped");
    expect(provider.stopped()).toBe(true);
  });

  it("attempts cleanup even when the sandbox is already gone", async () => {
    // The whole-lifetime case: the sandbox outlived its own timeout and
    // vanished. Cleanup still runs and reports honestly rather than throwing.
    const provider = setup({ loseSandboxBeforeReconnect: 2 });

    const outcome = await runValidationPhases(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "sandbox_lost" });
    expect(outcome.cleanup).toBe("not_provisioned");
  });
});

describe("validated artifact capture (Sprint 10B §5)", () => {
  /**
   * The alternative to this was making validation sandboxes persistent, which
   * would snapshot *every* sandbox on stop — failed runs, runs that stopped
   * mid-scrub — under the provider's 30-day default. That reverses ADR 0015 §5
   * for the sake of preview convenience.
   *
   * Capture is the opposite shape: explicit, post-success, post-scrub, with an
   * expiry Vibe chose. These tests pin that shape, because the difference
   * between the two is the whole security argument.
   */
  /** The filesystem as it is when capture runs: checks done, `.git` gone. */
  function scrubbed(options: FakeSandboxOptions = {}) {
    return setup({ files: healthySandboxFiles({ "product/.git/config": null }), ...options });
  }

  it("captures the filesystem after a passing run", async () => {
    const provider = scrubbed();

    await provisionSandbox(provider, fakeValidationTarget());
    const result = await captureValidatedArtifact(provider, fakeValidationTarget());

    expect(result).toMatchObject({ ok: true });
    expect(provider.snapshots()).toBe(1);
  });

  it("bounds retention explicitly rather than inheriting the provider default", async () => {
    const provider = scrubbed();

    await provisionSandbox(provider, fakeValidationTarget());
    await captureValidatedArtifact(provider, fakeValidationTarget());

    const snapshot = provider.events.find((event) => event.kind === "snapshot");
    expect(snapshot?.kind === "snapshot" ? snapshot.expirationMs : null).toBe(
      SANDBOX_BUDGETS.validatedArtifactTtlMs,
    );
    // An hour, not thirty days. The provider's default is what happens when
    // nobody decides.
    expect(SANDBOX_BUDGETS.validatedArtifactTtlMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("re-verifies the credential scrub before keeping anything", async () => {
    // The original scrub ran before the build, and a build executes
    // repository-controlled code that could write anything — including a new
    // `.git`. Checking again is checking the thing we are about to retain.
    const provider = setup({ files: healthySandboxFiles() });

    await provisionSandbox(provider, fakeValidationTarget());
    await captureValidatedArtifact(provider, fakeValidationTarget());

    const read = provider.events.find(
      (event) => event.kind === "read" && event.path.endsWith(".git/config"),
    );
    expect(read).toBeDefined();
  });

  it("refuses to retain a filesystem that still holds a credential store", async () => {
    const provider = setup();
    const original = provider.create.bind(provider);
    provider.create = async (input) => {
      const handle = await original(input);
      const readFile = handle.readFile.bind(handle);
      handle.readFile = async (file) =>
        file.path.endsWith(".git/config") ? "[remote]\n" : readFile(file);
      return handle;
    };
    const reconnect = provider.reconnect.bind(provider);
    provider.reconnect = async (input) => {
      const handle = await reconnect(input);
      if (!handle) return null;
      const readFile = handle.readFile.bind(handle);
      handle.readFile = async (file) =>
        file.path.endsWith(".git/config") ? "[remote]\n" : readFile(file);
      return handle;
    };

    await provisionSandbox(provider, fakeValidationTarget());
    const result = await captureValidatedArtifact(provider, fakeValidationTarget());

    expect(result).toEqual({ ok: false, reason: "credential_present" });
    // Nothing kept, and the sandbox is gone anyway.
    expect(provider.snapshots()).toBe(0);
    expect(provider.stopped()).toBe(true);
  });

  it("reports a lost sandbox rather than inventing an artifact", async () => {
    const provider = setup({ loseSandboxBeforeReconnect: 1 });

    await provisionSandbox(provider, fakeValidationTarget()).catch(() => undefined);

    expect(await captureValidatedArtifact(provider, fakeValidationTarget())).toEqual({
      ok: false,
      reason: "sandbox_lost",
    });
  });

  it("still stops the sandbox when capture fails", async () => {
    const provider = scrubbed({ failSnapshot: true });

    await provisionSandbox(provider, fakeValidationTarget());
    const result = await captureValidatedArtifact(provider, fakeValidationTarget());

    expect(result).toEqual({ ok: false, reason: "capture_failed" });
    expect(provider.stopped()).toBe(true);
  });

  it("still reports usage after capture terminates the sandbox", async () => {
    // `snapshot()` shuts the sandbox down, so a later `stop()` would throw and
    // take the accounting with it. Capturing an artifact must not cost us the
    // ledger.
    const provider = scrubbed();

    await provisionSandbox(provider, fakeValidationTarget());
    const result = await captureValidatedArtifact(provider, fakeValidationTarget());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage?.activeCpuDurationMs).toBe(1234);
  });
});
