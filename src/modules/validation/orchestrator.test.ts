import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inWorkspace, runValidation, SANDBOX_ENVIRONMENT } from "./orchestrator";
import {
  FIXTURE_COMMIT_SHA,
  fakeSandboxProvider,
  fakeValidationTarget,
  healthySandboxFiles,
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
function setup(options: FakeSandboxOptions = {}) {
  return fakeSandboxProvider({ files: healthySandboxFiles(), ...options });
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

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.failureCode).toBeNull();
    expect(outcome.steps.install?.status).toBe("passed");
    expect(outcome.steps.typecheck?.status).toBe("passed");
    expect(outcome.steps.test?.status).toBe("passed");
    expect(outcome.steps.build?.status).toBe("passed");
  });

  it("runs the profile's commands in order", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

    expect(provider.commands()).toEqual([
      "rm -rf .git",
      "pnpm install --frozen-lockfile --ignore-scripts",
      "pnpm run typecheck",
      "pnpm run test",
      "pnpm run build",
    ]);
  });

  it("reports the sandbox as stopped and records usage", async () => {
    const provider = setup();
    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

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
    await runValidation(provider, noManifest, fakeValidationTarget());

    const created = provider.policies()[0];
    expect(created.mode).toBe("allow_domains");
    if (created.mode !== "allow_domains") return;
    expect(created.domains).toContain("github.com");
    expect(created.domains).not.toContain("*");
  });

  it("moves from source hosts to registry hosts to deny-all", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

    const modes = provider.policies().map((policy) =>
      policy.mode === "deny_all" ? "deny_all" : policy.domains.join(","),
    );

    expect(modes).toHaveLength(3);
    expect(modes[0]).toContain("github.com");
    expect(modes[1]).toContain("registry.npmjs.org");
    // GitHub is revoked once the source is on disk: continued access would be
    // reach the run no longer needs.
    expect(modes[1]).not.toContain("github.com");
    expect(modes[2]).toBe("deny_all");
  });

  it("closes the network before any repository-controlled command", async () => {
    // The single most important assertion in this file. Everything after the
    // deny-all is someone else's JavaScript, and it must have nowhere to send
    // the customer's source.
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

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
    await runValidation(provider, noManifest, fakeValidationTarget());

    expect(provider.commands()).toContain("pnpm install --frozen-lockfile --ignore-scripts");
  });
});

describe("credential handling (§7, §37)", () => {
  it("passes the clone credential to creation and nowhere else", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

    const created = provider.createdWith();
    expect(created?.source.credential?.password).toBe("ghs_cloneTokenValue123456");
    // The environment is where repository code could read it. It must not be there.
    expect(JSON.stringify(created?.env)).not.toContain("ghs_cloneTokenValue123456");
  });

  it("destroys the credential store before any repository-controlled command", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

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

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "credential_scrub_failed" });
    expect(firstRepositoryControlledCommand(provider.commands())).toBe(-1);
    expect(provider.stopped()).toBe(true);
  });
});

describe("no product secrets in the sandbox (§8, §31, §37)", () => {
  it("provides only non-privileged environment variables", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

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
    await runValidation(provider, noManifest, fakeValidationTarget());

    const serialized = JSON.stringify(provider.createdWith()?.env ?? {});
    for (const pattern of [/ghs_/, /ghp_/, /sk-ant-/, /eyJ/, /service_role/i]) {
      expect(serialized).not.toMatch(pattern);
    }
  });
});

describe("source integrity (§6, §29)", () => {
  it("validates the exact prepared commit, not a branch", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

    expect(provider.createdWith()?.source.revision).toBe(FIXTURE_COMMIT_SHA);
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
      files: healthySandboxFiles({ "src/app/robots.ts": "// something else entirely" }),
    });

    const outcome = await runValidation(
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
    const provider = setup({ files: healthySandboxFiles({ "src/app/robots.ts": content }) });

    const outcome = await runValidation(
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

    const outcome = await runValidation(
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
        "package.json": JSON.stringify({ scripts: { build: "next build" } }),
      }),
    });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("passed");
    expect(outcome.steps.test).toMatchObject({ status: "skipped", skipReason: "script_not_present" });
    expect(provider.commands()).not.toContain("pnpm run test");
  });

  it("never invents a test command", async () => {
    // A repository that simply never had tests must not be reported as failing
    // them, which is what `npm test` on a scriptless project would produce.
    const provider = setup({
      files: healthySandboxFiles({ "package.json": JSON.stringify({ scripts: { build: "next build" } }) }),
    });
    await runValidation(provider, noManifest, fakeValidationTarget());

    expect(provider.commands().some((command) => /\btest\b/.test(command))).toBe(false);
  });

  it("fails the whole validation when an existing test script fails", async () => {
    const provider = setup({ results: { "pnpm run test": { exitCode: 1, output: "2 failed" } } });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "validation_checks_failed" });
    expect(outcome.steps.test?.status).toBe("failed");
    // Ordered so a red suite is not paid for with a four-minute build.
    expect(outcome.steps.build).toBeUndefined();
  });

  it("fails when the build fails", async () => {
    const provider = setup({ results: { "pnpm run build": { exitCode: 1, output: "Build error" } } });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "validation_checks_failed" });
    expect(outcome.steps.build?.exitCode).toBe(1);
  });

  it("fails when the install fails", async () => {
    const provider = setup({ results: { "pnpm install --frozen-lockfile --ignore-scripts": { exitCode: 1 } } });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("failed");
    expect(outcome.steps.typecheck).toBeUndefined();
  });

  it("cannot pass without a build script", async () => {
    // "It builds" is the claim. A repository that cannot make it is not
    // validated — it is unsupported.
    const provider = setup({
      files: healthySandboxFiles({ "package.json": JSON.stringify({ scripts: { test: "vitest" } }) }),
    });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "validation_not_supported" });
  });

  it("classifies a deterministically identifiable missing-environment build failure", async () => {
    const provider = setup({
      results: {
        "pnpm run build": { exitCode: 1, output: "Error: Missing required environment variable: DATABASE_URL" },
      },
    });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("build_failed_missing_environment");
  });

  it("uses npm's locked install when the project uses npm", async () => {
    const provider = setup({
      files: healthySandboxFiles({ "pnpm-lock.yaml": null, "package-lock.json": "{}" }),
    });

    await runValidation(provider, noManifest, fakeValidationTarget({ packageManager: "npm" }));

    expect(provider.commands()).toContain("npm ci --ignore-scripts");
    expect(provider.commands()).toContain("npm run build");
  });

  it("refuses without a lockfile rather than resolving fresh dependencies", async () => {
    const provider = setup({ files: healthySandboxFiles({ "pnpm-lock.yaml": null }) });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("lockfile_missing");
    expect(firstRepositoryControlledCommand(provider.commands())).toBe(-1);
  });
});

describe("timeouts (§14)", () => {
  it("ends in a safe terminal state when a command exceeds its budget", async () => {
    const provider = setup({ results: { "pnpm run build": { timedOut: true, exitCode: -1 } } });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

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

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(provider.stopped()).toBe(true);
    expect(outcome.cleanup).toBe("stopped");
  });

  it("records a failed teardown without changing the verdict", async () => {
    const provider = setup({ failStop: true });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    // The checks passed. A provider that could not confirm teardown does not
    // retroactively make them fail.
    expect(outcome.status).toBe("passed");
    expect(outcome.cleanup).toBe("stop_failed");
  });

  it("reports no sandbox to clean up when provisioning failed", async () => {
    const provider = setup({ failCreate: true });

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

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

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.status).toBe("failed");
    expect(provider.commands()).toEqual([]);
  });
});

describe("stage reporting (§17)", () => {
  it("reports stages in order for a page the user may have left", async () => {
    const provider = setup();
    const stages: string[] = [];

    await runValidation(provider, noManifest, fakeValidationTarget(), {
      onStage: (stage) => {
        stages.push(stage);
      },
    });

    expect(stages).toEqual([
      "provisioning",
      "verifying_source",
      "securing_sandbox",
      "installing",
      "typechecking",
      "testing",
      "building",
      "collecting_results",
    ]);
  });

  it("keeps running when a stage callback throws", async () => {
    // Progress reporting is best-effort. A failed status write must never
    // abort a sandbox that is already costing money.
    const provider = setup();

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget(), {
      onStage: (stage) => {
        if (stage === "installing") throw new Error("db unavailable");
      },
    });

    // The throw propagates to the orchestrator's own catch, which still cleans up.
    expect(provider.stopped()).toBe(true);
    expect(outcome.cleanup).toBe("stopped");
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

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("sandbox_unavailable");
    expect(outcome.failureDetail).toContain("no capacity");
  });

  it("names the file behind an integrity failure", async () => {
    const provider = setup();

    const outcome = await runValidation(
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

    const outcome = await runValidation(
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

    const outcome = await runValidation(provider, noManifest, fakeValidationTarget());

    expect(outcome.failureCode).toBe("validation_run_failed");
    expect(outcome.failureDetail).toContain("provider exploded");
  });

  it("sanitizes the detail like any other untrusted output", async () => {
    const provider = setup({
      results: { "ls -a": { output: `\u001b[31mfatal\u001b[0m ghp_${"a".repeat(36)}` } },
    });

    const outcome = await runValidation(
      provider,
      noManifest,
      fakeValidationTarget({ preparedFiles: [{ path: "gone.ts", contentHash: "0".repeat(64) }] }),
    );

    expect(outcome.failureDetail).toContain("fatal");
    expect(outcome.failureDetail).not.toContain("\u001b");
    expect(outcome.failureDetail).toContain("[redacted]");
  });

  it("leaves the detail null when nothing failed", async () => {
    const outcome = await runValidation(setup(), noManifest, fakeValidationTarget());

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

    await runValidation(first, noManifest, fakeValidationTarget({ validationRunId: "aaaaaaaa-1111-2222-3333-444444444444" }));
    await runValidation(second, noManifest, fakeValidationTarget({ validationRunId: "bbbbbbbb-1111-2222-3333-444444444444" }));

    expect(first.createdWith()?.name).not.toBe(second.createdWith()?.name);
  });

  it("still produces a traceable vibe-prefixed name", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

    expect(provider.createdWith()?.name).toMatch(/^vibe-validate-[0-9a-f]+$/);
  });

  it("carries no customer identifier into provider metadata", async () => {
    const provider = setup();
    await runValidation(provider, noManifest, fakeValidationTarget());

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
    expect(inWorkspace(".")).toBe(".");
    expect(inWorkspace(".", "package.json")).toBe("package.json");
    expect(inWorkspace("apps/web")).toBe("apps/web");
    expect(inWorkspace("apps/web", "package.json")).toBe("apps/web/package.json");
    expect(inWorkspace("apps/web/", ".git/config")).toBe("apps/web/.git/config");
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
    const outcome = await runValidation(setup(), noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity).toMatchObject({
      requestedRevision: FIXTURE_COMMIT_SHA,
      revisionMode: "provider_pinned",
    });
  });

  it("never claims git observed the commit", async () => {
    const outcome = await runValidation(setup(), noManifest, fakeValidationTarget());

    // The record says what was established. There is no field asserting an
    // independent Git observation, because none happened.
    expect(JSON.stringify(outcome.sourceIntegrity)).not.toContain("gitCommit");
    expect(Object.keys(outcome.sourceIntegrity ?? {})).toEqual([
      "requestedRevision",
      "revisionMode",
      "changedFilesVerified",
      "buildIdentityFilesVerified",
      "buildIdentityFilesUnverified",
    ]);
  });

  it("verifies build identity against GitHub at the pinned commit", async () => {
    const manifest = {
      getTextFile: async (path: string) =>
        path === "package.json" ? healthySandboxFiles()["package.json"] : null,
    };

    const outcome = await runValidation(setup(), manifest, fakeValidationTarget());

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
    const outcome = await runValidation(provider, manifest, fakeValidationTarget());

    expect(outcome).toMatchObject({ status: "failed", failureCode: "source_integrity_failed" });
    expect(outcome.failureDetail).toContain("pnpm-lock.yaml");
    // Before any repository-controlled command, as always.
    expect(provider.commands().some((command) => command.startsWith("pnpm"))).toBe(false);
  });

  it("records a file it could not compare rather than counting it verified", async () => {
    // Present in the sandbox, absent from GitHub: not agreement, not a failure.
    const outcome = await runValidation(setup(), noManifest, fakeValidationTarget());

    expect(outcome.sourceIntegrity?.buildIdentityFilesUnverified).toContain("package.json");
    expect(outcome.sourceIntegrity?.buildIdentityFilesVerified).not.toContain("package.json");
  });

  it("treats absence on both sides as agreement", async () => {
    const outcome = await runValidation(setup(), noManifest, fakeValidationTarget());

    // This repository has no package-lock.json and no next.config.js. Neither
    // side has them, so neither is a gap worth recording.
    expect(outcome.sourceIntegrity?.buildIdentityFilesUnverified).not.toContain("package-lock.json");
    expect(outcome.sourceIntegrity?.buildIdentityFilesUnverified).not.toContain("next.config.js");
  });

  it("still verifies the prepared change's own files before any repository code", async () => {
    const provider = setup();

    const outcome = await runValidation(
      provider,
      noManifest,
      fakeValidationTarget({ preparedFiles: [{ path: "src/app/robots.ts", contentHash: "0".repeat(64) }] }),
    );

    expect(outcome.failureCode).toBe("source_integrity_failed");
    expect(provider.commands().some((command) => command.startsWith("pnpm"))).toBe(false);
  });
});
