import { describe, expect, it } from "vitest";
import { describeCommand, installCommand } from "@/modules/validation/commands";
import { DEPENDENCY_HOSTS, SOURCE_HOSTS } from "@/modules/validation/sandbox-port";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { PREVIEW_BUDGETS, PREVIEW_RESOURCES } from "./budgets";
import { previewHealthProbeCommand, previewServerCommand } from "./commands";
import { previewSandboxNameFor } from "./identity";
import {
  PREVIEW_ENVIRONMENT,
  provisionPreviewWorkspace,
  startPreviewServer,
  teardownPreview,
} from "./orchestrator";
import {
  FIXTURE_COMMIT_SHA,
  PREVIEW_SESSION_ID,
  clonedSandboxFiles,
  fakePreviewTarget,
} from "./test-support";

/**
 * The preview security sequence, asserted against a recorded transcript
 * (Sprint 10B-2 §30, §31, §34; Sprint 0114).
 *
 * These are checks against what the fake provider *observed*, not readings of
 * the source. That distinction is the whole reason the fake records an ordered
 * event list: "the server did not start before the credential was destroyed" is
 * a statement about a sequence, and only a recording can falsify it.
 */

/** A clock that does not advance, so a three-minute budget costs no seconds. */
function frozenClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A workspace whose HEAD is the prepared commit and whose install succeeds. */
function readyProvider(
  options: { files?: Record<string, string>; healthStatus?: number | null } = {},
) {
  return fakeSandboxProvider({
    files: options.files ?? clonedSandboxFiles(),
    ...(options.healthStatus !== undefined ? { healthStatus: options.healthStatus } : {}),
    results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
  });
}

describe("acquiring the source", () => {
  it("clones exactly the prepared commit, never a branch", async () => {
    const provider = readyProvider();

    const outcome = await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(outcome.ok).toBe(true);
    const created = provider.createdWith();
    expect(created?.source).toEqual({
      kind: "git",
      repositoryUrl: "https://github.com/acme/product.git",
      revision: FIXTURE_COMMIT_SHA,
      credential: { username: "x-access-token", password: "ghs_fixture" },
    });
  });

  it("refuses when the provider produced a different commit", async () => {
    // A preview of the wrong bytes on a public URL is worse than no preview.
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: "b".repeat(40) } },
    });

    const outcome = await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_source_unavailable" });
    // And nothing repository-controlled ran.
    expect(provider.backgroundCommands()).toEqual([]);
  });

  it("destroys the clone credential and verifies its absence", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    const commands = provider.commands();
    const scrub = commands.findIndex((command) => command.startsWith("rm -rf .git"));
    const install = commands.findIndex((command) => command.startsWith("pnpm install"));

    expect(scrub).toBeGreaterThanOrEqual(0);
    // Short expiry is not a security boundary (rule 63): the token stops
    // existing before anything from the repository runs.
    expect(scrub).toBeLessThan(install);
  });

  it("refuses to continue when the credential store survived removal", async () => {
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles({
        "product/.git/config": "[remote]\n  url = https://x@github.com",
      }),
      // `rm -f` reports success whether or not it removed anything, which is
      // exactly why the orchestrator verifies rather than assumes.
      unremovablePaths: ["product/.git/config"],
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
    });

    const outcome = await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_credential_scrub_failed" });
    expect(provider.commands().some((command) => command.startsWith("pnpm install"))).toBe(false);
  });
});

describe("the network, at each phase", () => {
  it("opens GitHub at creation, the registry to install, then nothing", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    // The whole of rule 81 in one assertion: two windows, each as narrow as the
    // work needs, and shut before repository code can run.
    expect(provider.policies()).toEqual([
      { mode: "allow_domains", domains: SOURCE_HOSTS },
      { mode: "allow_domains", domains: DEPENDENCY_HOSTS },
      { mode: "deny_all" },
    ]);
  });

  it("closes the registry even when the install fails", async () => {
    // The failure path is exactly where "we'll close it later" turns into "we
    // didn't".
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: {
        "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA },
        [describeCommand(installCommand("pnpm"))]: {
          exitCode: 1,
          output: "ERR_PNPM_OUTDATED_LOCKFILE",
        },
      },
    });

    const outcome = await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_install_failed" });
    expect(provider.policies().at(-1)).toEqual({ mode: "deny_all" });
  });

  it("has the network shut before the server starts", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());
    await startPreviewServer(provider, fakePreviewTarget(), { clock: frozenClock() });

    expect(provider.policies().at(-1)).toEqual({ mode: "deny_all" });
    expect(provider.backgroundCommands()).toHaveLength(1);
  });
});

describe("the sandbox a preview gets", () => {
  it("exposes exactly one port, and it is Vibe's", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(provider.exposedPorts()).toEqual([PREVIEW_BUDGETS.port]);
  });

  it("bounds the sandbox's own lifetime by the preview TTL", async () => {
    // Two clocks, deliberately. This is the one that stops the VM even if
    // nothing in Vibe ever runs again.
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(provider.createdWith()?.timeoutMs).toBe(PREVIEW_BUDGETS.ttlMs);
  });

  it("provisions the preview shape rather than the validation shape", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(provider.createdWith()?.vcpus).toBe(PREVIEW_RESOURCES.vcpus);
  });

  it("carries no privileged environment into the preview runtime", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    const env = provider.createdWith()?.env ?? {};
    expect(env).toEqual({ ...PREVIEW_ENVIRONMENT });
    for (const name of Object.keys(env)) {
      expect(name).not.toMatch(/^(GITHUB|GH|ANTHROPIC|SUPABASE|VERCEL|BROWSERBASE|AWS|OPENAI)_/);
    }
  });

  it("refuses a privileged environment as a Vibe defect, before creating anything", async () => {
    const provider = readyProvider();

    const outcome = await provisionPreviewWorkspace(provider, fakePreviewTarget(), {
      ...PREVIEW_ENVIRONMENT,
      GITHUB_TOKEN: "ghp_leaked",
    });

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_privileged_environment" });
    // The name, never the value — a value here would be the secret being refused.
    if (!outcome.ok) expect(outcome.failureDetail).not.toContain("ghp_leaked");
    expect(provider.createCount()).toBe(0);
  });

  it("adopts an existing sandbox rather than creating a second one", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());
    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    // A replay must never buy a second microVM on a second public URL.
    expect(provider.createCount()).toBe(1);
  });

  it("names the sandbox after the session, never after the identity", async () => {
    const provider = readyProvider();

    await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(provider.createdWith()?.name).toBe(previewSandboxNameFor(PREVIEW_SESSION_ID));
  });

  it("classifies a provider failure rather than falling back to anything", async () => {
    const provider = fakeSandboxProvider({ failCreate: true });

    const outcome = await provisionPreviewWorkspace(provider, fakePreviewTarget());

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_provider_unavailable" });
  });
});

describe("starting the preview server", () => {
  it("starts the production server and reports the provider's origin", async () => {
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    const outcome = await startPreviewServer(provider, target, { clock: frozenClock() });

    expect(outcome).toMatchObject({ ok: true, port: PREVIEW_BUDGETS.port });
    expect(outcome.ok && outcome.origin).toBe(
      `https://sandbox-${PREVIEW_BUDGETS.port}.example.invalid`,
    );
  });

  it("starts exactly one server, and it is the one Vibe wrote", async () => {
    /*
     * The inverse of what this test asserted before Sprint 0114, and worth
     * reading as such. ADR 0016 §7 refused `next dev` because a preview claimed
     * to be the validated application; a preview now runs *before* validation
     * and claims only to be the prepared code, so the development server is the
     * right instrument and ADR 0064 says why.
     *
     * What did not change is the part that was always the security property:
     * one server, named by Vibe, never a repository-defined script.
     */
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    await startPreviewServer(provider, target, { clock: frozenClock() });

    expect(provider.backgroundCommands()).toEqual([describeCommand(previewServerCommand())]);
    for (const command of provider.backgroundCommands()) {
      expect(command).not.toContain("pnpm");
      expect(command).not.toContain("npx");
    }
  });

  it("binds all interfaces on Vibe's port", async () => {
    const command = describeCommand(previewServerCommand());

    expect(command).toContain("-H 0.0.0.0");
    expect(command).toContain(`-p ${PREVIEW_BUDGETS.port}`);
  });

  it("never runs a repository-defined script to start the server", async () => {
    const command = previewServerCommand();

    // `pnpm start` would let a repository decide what Vibe serves on a public
    // port by editing one line of JSON (§14).
    expect(command.command).not.toBe("pnpm");
    expect(command.command).not.toBe("npm");
    expect(command.command).not.toBe("npx");
    expect(command.args).not.toContain("run");
  });

  it("reports a process that exited instead of waiting out the budget", async () => {
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      backgroundExitCode: 1,
      backgroundOutput: "Error: Cannot find module './server'",
      healthStatus: null,
    });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    const outcome = await startPreviewServer(provider, target, { clock: frozenClock() });

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_process_exited" });
  });

  it("names a missing-configuration exit as such", async () => {
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      backgroundExitCode: 1,
      backgroundOutput: "Error: Missing required environment variable DATABASE_URL",
      healthStatus: null,
    });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    // A user can act on exactly one of these two, so they are different codes.
    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_missing_environment",
    });
  });

  it("fails when the server never answers within its budget", async () => {
    const provider = fakeSandboxProvider({ files: clonedSandboxFiles(), healthStatus: null });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_health_check_failed",
    });
  });

  it("stops probing after a bounded number of attempts, even on a stopped clock", async () => {
    const provider = fakeSandboxProvider({ files: clonedSandboxFiles(), healthStatus: null });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    await startPreviewServer(provider, target, { clock: frozenClock() });

    // The loop's only delay is the provider's `exitedWithin`. A provider that
    // returns instantly would otherwise busy-loop for the whole budget and
    // hammer the control-plane quota — which is how this bound was found: the
    // first workflow test ran the process out of memory.
    const probes = provider.commands().filter((command) => command.startsWith("curl"));
    expect(probes.length).toBeLessThanOrEqual(
      Math.ceil(PREVIEW_BUDGETS.healthCheckBudgetMs / PREVIEW_BUDGETS.healthPollIntervalMs) + 1,
    );
  });

  it("keeps probing while the server is still warming up", async () => {
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      healthFailingProbes: 3,
    });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    const outcome = await startPreviewServer(provider, target, { clock: frozenClock() });

    expect(outcome).toMatchObject({ ok: true });
    // A single probe would fail every cold Next.js boot.
    const probes = provider.commands().filter((command) => command.startsWith("curl"));
    expect(probes.length).toBeGreaterThan(3);
  });

  it("treats a 5xx as an application failure and a 404 as a running application", async () => {
    const erroring = readyProvider({ healthStatus: 500 });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(erroring, target);

    expect(await startPreviewServer(erroring, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_health_check_failed",
    });

    const empty = readyProvider({ healthStatus: 404 });
    await provisionPreviewWorkspace(empty, target);

    // A root 404 is a running application whose author has no index route.
    // Failing it would substitute Vibe's opinion about their site map for a
    // liveness check.
    expect(await startPreviewServer(empty, target, { clock: frozenClock() })).toMatchObject({
      ok: true,
    });
  });

  it("classifies a missing provider route separately from an application failure", async () => {
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      failPublicOrigin: true,
    });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    // The server is demonstrably answering; what is missing is the route. The
    // user must not be told their change is broken (§17).
    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_provider_unavailable",
    });
  });

  it("classifies a server that could not be started at all", async () => {
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      failBackground: true,
      healthStatus: null,
    });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_start_failed",
    });
  });

  it("does not start a second server when the port already answers", async () => {
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    await startPreviewServer(provider, target, { clock: frozenClock() });
    await startPreviewServer(provider, target, { clock: frozenClock() });

    // Re-entry safety without persisting a process handle: two servers would
    // race each other for the bind (§32).
    expect(provider.backgroundCommands()).toHaveLength(1);
  });

  it("probes over loopback and never follows a redirect", () => {
    const probe = describeCommand(previewHealthProbeCommand());

    expect(probe).toContain(`http://127.0.0.1:${PREVIEW_BUDGETS.port}/`);
    // No body: page content is untrusted data with no business in a diagnostic.
    expect(probe).toContain("-o /dev/null");
    // No `--location`: following a redirect turns a probe into a small crawler.
    expect(probe).not.toContain("--location");
    expect(probe).toContain("--max-time");
  });

  it("makes no AI call and reads no page body", async () => {
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    await startPreviewServer(provider, target, { clock: frozenClock() });

    // The whole transcript. A preview is a liveness check, not a Deep Scan.
    for (const command of provider.commands()) {
      expect(command).not.toMatch(/anthropic|claude|screenshot|playwright/i);
    }
  });
});

describe("teardown", () => {
  it("stops the sandbox and deletes a v1 session's artifact snapshot", async () => {
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    const teardown = await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: "snap_v1_legacy" },
      { deleteArtifact: true },
    );

    expect(teardown).toMatchObject({ cleanup: "stopped", artifactDeleted: true });
    expect(provider.stopped()).toBe(true);
    expect(provider.deletedArtifacts()).toEqual(["snap_v1_legacy"]);
  });

  it("is idempotent when called twice", async () => {
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);
    const args = { previewSessionId: target.previewSessionId, snapshotId: "snap_v1_legacy" };

    const first = await teardownPreview(provider, args, { deleteArtifact: true });
    const second = await teardownPreview(provider, args, { deleteArtifact: true });

    // "Already gone" is a success on both halves. Stopping twice must not
    // become an error the user sees (§24, §32).
    expect(first.artifactDeleted).toBe(true);
    expect(second.artifactDeleted).toBe(true);
  });

  it("records a snapshot deletion failure without hiding it", async () => {
    const provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      failDeleteArtifact: true,
    });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    const teardown = await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: "snap_v1_legacy" },
      { deleteArtifact: true },
    );

    // The customer's filesystem is still in provider storage. Something has to
    // be able to know that and try again (§19, §33).
    expect(teardown).toMatchObject({ cleanup: "artifact_delete_failed", artifactDeleted: false });
  });

  it("reports a stop failure without pretending the sandbox is gone", async () => {
    const provider = fakeSandboxProvider({ files: clonedSandboxFiles(), failStop: true });
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    const teardown = await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: "snap_v1_legacy" },
      { deleteArtifact: true },
    );

    // A VM costs money by the minute, so its status outranks the snapshot's
    // when both went wrong.
    expect(teardown.cleanup).toBe("stop_failed");
  });

  it("leaves the snapshot alone when asked not to delete it", async () => {
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: "snap_v1_legacy" },
      { deleteArtifact: false },
    );

    expect(provider.deletedArtifacts()).toEqual([]);
  });
});

describe("fixtures", () => {
  it("has no snapshot to delete for a session that cloned", async () => {
    // The normal case from Sprint 0114 onward. Asked for and answered "nothing
    // to do", rather than the caller having to know not to ask.
    const provider = readyProvider();
    const target = fakePreviewTarget();
    await provisionPreviewWorkspace(provider, target);

    const teardown = await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: null },
      { deleteArtifact: true },
    );

    expect(teardown).toMatchObject({ cleanup: "stopped", artifactDeleted: false });
    expect(provider.deletedArtifacts()).toEqual([]);
  });
});
