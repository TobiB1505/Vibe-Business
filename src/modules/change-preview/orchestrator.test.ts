import { describe, expect, it } from "vitest";
import { describeCommand } from "@/modules/validation/commands";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { PREVIEW_BUDGETS, PREVIEW_RESOURCES } from "./budgets";
import { previewHealthProbeCommand, previewServerCommand } from "./commands";
import { previewSandboxNameFor } from "./identity";
import {
  PREVIEW_ENVIRONMENT,
  restoreValidatedArtifact,
  startPreviewServer,
  teardownPreview,
  verifyRestoredArtifact,
} from "./orchestrator";
import {
  PREVIEW_SESSION_ID,
  PREVIEW_SNAPSHOT_ID,
  RESTORED_FILES,
  fakePreviewTarget,
  restoredSandboxFiles,
  sha256,
} from "./test-support";

/**
 * The preview security sequence, asserted against a recorded transcript
 * (Sprint 10B-2 §30, §31, §34).
 *
 * These are checks against what the fake provider *observed*, not readings of
 * the source. That distinction is the whole reason the fake records an ordered
 * event list: "the server did not start before integrity was checked" is a
 * statement about a sequence, and only a recording can falsify it.
 */

/** A clock that does not advance, so a 90-second budget costs no seconds. */
function frozenClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("restoring a validated artifact", () => {
  it("creates the sandbox from exactly the stored snapshot", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    const outcome = await restoreValidatedArtifact(provider, fakePreviewTarget());

    expect(outcome.ok).toBe(true);
    const created = provider.createdWith();
    expect(created?.source).toEqual({ kind: "snapshot", snapshotId: PREVIEW_SNAPSHOT_ID });
  });

  it("never acquires source from GitHub", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    await restoreValidatedArtifact(provider, fakePreviewTarget());

    // The distinguishing property of preview: no clone, so no credential, so
    // no second source-acquisition path to secure (§9).
    expect(provider.createdWith()?.source.kind).not.toBe("git");
    expect(JSON.stringify(provider.createdWith())).not.toContain("github");
  });

  it("applies deny-all egress at creation, before the filesystem exists", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    await restoreValidatedArtifact(provider, fakePreviewTarget());

    // The first policy in the transcript is the creation policy. A sandbox that
    // existed under a weaker one, even briefly, would be a window.
    expect(provider.policies()[0]).toEqual({ mode: "deny_all" });
  });

  it("never widens egress after creation", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    const clock = frozenClock();

    await restoreValidatedArtifact(provider, target);
    await verifyRestoredArtifact(provider, target);
    await startPreviewServer(provider, target, { clock });

    // "The preview needs the internet to be reachable" is a confusion between
    // inbound and outbound. Every policy in the whole session is deny-all.
    for (const policy of provider.policies()) {
      expect(policy).toEqual({ mode: "deny_all" });
    }
  });

  it("exposes exactly one port, and it is Vibe's", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    await restoreValidatedArtifact(provider, fakePreviewTarget());

    expect(provider.exposedPorts()).toEqual([PREVIEW_BUDGETS.port]);
  });

  it("bounds the sandbox's own lifetime by the preview TTL", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    await restoreValidatedArtifact(provider, fakePreviewTarget());

    // The provider timeout is what stops the VM if nothing in Vibe ever runs
    // again. Without it, a lost workflow would leave a public server up until
    // the provider's five-minute default — or, with a longer default, far
    // beyond the TTL the product promises (§18).
    expect(provider.createdWith()?.timeoutMs).toBe(PREVIEW_BUDGETS.ttlMs);
  });

  it("provisions the preview shape rather than the validation shape", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    await restoreValidatedArtifact(provider, fakePreviewTarget());

    expect(provider.createdWith()?.vcpus).toBe(PREVIEW_RESOURCES.vcpus);
  });

  it("carries no privileged environment into the preview runtime", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    await restoreValidatedArtifact(provider, fakePreviewTarget());

    const env = provider.createdWith()?.env ?? {};
    expect(Object.keys(env).sort()).toEqual(["CI", "NEXT_TELEMETRY_DISABLED", "NODE_ENV"]);

    // Asserted by *shape* as well as by list, so a future variable in one of
    // these families fails here rather than at a security review.
    const serialized = JSON.stringify(env);
    for (const marker of ["ghs_", "sk-ant", "service_role", "SUPABASE", "ANTHROPIC", "VERCEL_"]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("adopts an existing sandbox rather than creating a second one", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();

    await restoreValidatedArtifact(provider, target);
    await restoreValidatedArtifact(provider, target);

    // Replay safety, and the thing that makes `maxRetries = 0` survivable: a
    // second creation is a second paid VM on a second public URL (§32).
    expect(provider.createCount()).toBe(1);
  });

  it("names the sandbox after the session, never after the identity", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });

    await restoreValidatedArtifact(provider, fakePreviewTarget());

    const name = provider.createdWith()?.name ?? "";
    expect(name).toBe(previewSandboxNameFor(PREVIEW_SESSION_ID));
    // Sandbox names are third-party metadata. No customer identifiers.
    expect(name).not.toContain("product");
    expect(name).not.toContain("acme");
  });

  it("classifies a provider failure rather than falling back to anything", async () => {
    const provider = fakeSandboxProvider({ failCreate: true });

    const outcome = await restoreValidatedArtifact(provider, fakePreviewTarget());

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_provider_unavailable" });
  });
});

describe("integrity of the restored artifact", () => {
  it("passes when the restored filesystem matches the manifest", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();

    await restoreValidatedArtifact(provider, target);

    expect(await verifyRestoredArtifact(provider, target)).toMatchObject({ ok: true });
  });

  it("refuses when a prepared file's content changed in storage", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles({ "product/app/robots.ts": "export default 'tampered';\n" }),
    });
    const target = fakePreviewTarget();

    await restoreValidatedArtifact(provider, target);
    const outcome = await verifyRestoredArtifact(provider, target);

    expect(outcome).toMatchObject({
      ok: false,
      failureCode: "preview_artifact_integrity_failed",
    });
  });

  it("refuses when a prepared file did not come back at all", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles({ "product/app/robots.ts": null }),
    });
    const target = fakePreviewTarget();

    await restoreValidatedArtifact(provider, target);

    expect(await verifyRestoredArtifact(provider, target)).toMatchObject({
      ok: false,
      failureCode: "preview_artifact_integrity_failed",
    });
  });

  it("refuses when a build-identity file differs from what was validated", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles({ "product/pnpm-lock.yaml": "lockfileVersion: '6.0'\n" }),
    });
    const target = fakePreviewTarget();

    await restoreValidatedArtifact(provider, target);

    // A matching `robots.ts` beside a different lockfile is a different build.
    expect(await verifyRestoredArtifact(provider, target)).toMatchObject({
      ok: false,
      failureCode: "preview_artifact_integrity_failed",
    });
  });

  it("refuses when a credential-bearing .git came back with the snapshot", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles({
        "product/.git/config":
          '[remote "origin"]\n\turl = https://x-access-token:ghs_secret@github.com/acme/product.git\n',
      }),
    });
    const target = fakePreviewTarget();

    await restoreValidatedArtifact(provider, target);
    const outcome = await verifyRestoredArtifact(provider, target);

    expect(outcome).toMatchObject({
      ok: false,
      failureCode: "preview_artifact_integrity_failed",
    });
    // The refusal must not quote the credential it refused.
    expect(JSON.stringify(outcome)).not.toContain("ghs_secret");
  });

  it("refuses a privileged environment as a Vibe defect, not an artifact defect", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    const outcome = await verifyRestoredArtifact(provider, target, {
      ...PREVIEW_ENVIRONMENT,
      SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOi.secret",
    });

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_privileged_environment" });
    // Names, never values: the detail must not carry the secret being refused.
    expect(JSON.stringify(outcome)).not.toContain("eyJhbGciOi.secret");
  });

  it("does not re-run install, typecheck, test or build", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();

    await restoreValidatedArtifact(provider, target);
    await verifyRestoredArtifact(provider, target);

    // Preview restores a validated artifact. Re-validating it would mean the
    // capture was pointless, and would answer a settled question with a second
    // bill (§11).
    for (const command of provider.commands()) {
      expect(command).not.toMatch(/install|tsc|vitest|next build|run build/);
    }
  });

  it("treats an absent build-identity manifest as nothing to compare", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget({ buildIdentityFiles: [] });

    await restoreValidatedArtifact(provider, target);

    // A run validated before digests were recorded carries none. The prepared
    // file hashes still run, and they are the load-bearing check.
    expect(await verifyRestoredArtifact(provider, target)).toMatchObject({ ok: true });
  });
});

describe("starting the preview server", () => {
  it("starts the production server and reports the provider's origin", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    const outcome = await startPreviewServer(provider, target, { clock: frozenClock() });

    expect(outcome).toMatchObject({ ok: true, port: PREVIEW_BUDGETS.port });
    expect(outcome.ok && outcome.origin).toBe(
      `https://sandbox-${PREVIEW_BUDGETS.port}.example.invalid`,
    );
  });

  it("never starts a development server", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    await startPreviewServer(provider, target, { clock: frozenClock() });

    // A dev server rebuilds on demand and serves unminified code with error
    // overlays: a different application from the one that was validated (§14).
    for (const command of provider.backgroundCommands()) {
      expect(command).not.toContain("dev");
    }
    expect(provider.backgroundCommands()).toEqual([
      describeCommand(previewServerCommand()),
    ]);
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
      files: restoredSandboxFiles(),
      backgroundExitCode: 1,
      backgroundOutput: "Error: Cannot find module './server'",
      healthStatus: null,
    });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    const outcome = await startPreviewServer(provider, target, { clock: frozenClock() });

    expect(outcome).toMatchObject({ ok: false, failureCode: "preview_process_exited" });
  });

  it("names a missing-configuration exit as such", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles(),
      backgroundExitCode: 1,
      backgroundOutput: "Error: Missing required environment variable DATABASE_URL",
      healthStatus: null,
    });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    // A user can act on exactly one of these two, so they are different codes.
    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_missing_environment",
    });
  });

  it("fails when the server never answers within its budget", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles(), healthStatus: null });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_health_check_failed",
    });
  });

  it("stops probing after a bounded number of attempts, even on a stopped clock", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles(), healthStatus: null });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

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
      files: restoredSandboxFiles(),
      healthFailingProbes: 3,
    });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    const outcome = await startPreviewServer(provider, target, { clock: frozenClock() });

    expect(outcome).toMatchObject({ ok: true });
    // A single probe would fail every cold Next.js boot.
    const probes = provider.commands().filter((command) => command.startsWith("curl"));
    expect(probes.length).toBeGreaterThan(3);
  });

  it("treats a 5xx as an application failure and a 404 as a running application", async () => {
    const erroring = fakeSandboxProvider({ files: restoredSandboxFiles(), healthStatus: 500 });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(erroring, target);

    expect(await startPreviewServer(erroring, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_health_check_failed",
    });

    const empty = fakeSandboxProvider({ files: restoredSandboxFiles(), healthStatus: 404 });
    await restoreValidatedArtifact(empty, target);

    // A root 404 is a running application whose author has no index route.
    // Failing it would substitute Vibe's opinion about their site map for a
    // liveness check.
    expect(await startPreviewServer(empty, target, { clock: frozenClock() })).toMatchObject({
      ok: true,
    });
  });

  it("classifies a missing provider route separately from an application failure", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles(),
      failPublicOrigin: true,
    });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    // The server is demonstrably answering; what is missing is the route. The
    // user must not be told their change is broken (§17).
    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_provider_unavailable",
    });
  });

  it("classifies a server that could not be started at all", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles(),
      failBackground: true,
      healthStatus: null,
    });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    expect(await startPreviewServer(provider, target, { clock: frozenClock() })).toMatchObject({
      ok: false,
      failureCode: "preview_start_failed",
    });
  });

  it("does not start a second server when the port already answers", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

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
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    await startPreviewServer(provider, target, { clock: frozenClock() });

    // The whole transcript. A preview is a liveness check, not a Deep Scan.
    for (const command of provider.commands()) {
      expect(command).not.toMatch(/anthropic|claude|screenshot|playwright/i);
    }
  });
});

describe("teardown", () => {
  it("stops the sandbox and deletes the artifact snapshot", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    const teardown = await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: target.snapshotId },
      { deleteArtifact: true },
    );

    expect(teardown).toMatchObject({ cleanup: "stopped", artifactDeleted: true });
    expect(provider.stopped()).toBe(true);
    expect(provider.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);
  });

  it("is idempotent when called twice", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);
    const args = { previewSessionId: target.previewSessionId, snapshotId: target.snapshotId };

    const first = await teardownPreview(provider, args, { deleteArtifact: true });
    const second = await teardownPreview(provider, args, { deleteArtifact: true });

    // "Already gone" is a success on both halves. Stopping twice must not
    // become an error the user sees (§24, §32).
    expect(first.artifactDeleted).toBe(true);
    expect(second.artifactDeleted).toBe(true);
  });

  it("records a snapshot deletion failure without hiding it", async () => {
    const provider = fakeSandboxProvider({
      files: restoredSandboxFiles(),
      failDeleteArtifact: true,
    });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    const teardown = await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: target.snapshotId },
      { deleteArtifact: true },
    );

    // The customer's filesystem is still in provider storage. Something has to
    // be able to know that and try again (§19, §33).
    expect(teardown).toMatchObject({ cleanup: "artifact_delete_failed", artifactDeleted: false });
  });

  it("reports a stop failure without pretending the sandbox is gone", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles(), failStop: true });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    const teardown = await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: target.snapshotId },
      { deleteArtifact: true },
    );

    // A VM costs money by the minute, so its status outranks the snapshot's
    // when both went wrong.
    expect(teardown.cleanup).toBe("stop_failed");
  });

  it("leaves the snapshot alone when asked not to delete it", async () => {
    const provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
    const target = fakePreviewTarget();
    await restoreValidatedArtifact(provider, target);

    await teardownPreview(
      provider,
      { previewSessionId: target.previewSessionId, snapshotId: target.snapshotId },
      { deleteArtifact: false },
    );

    expect(provider.deletedArtifacts()).toEqual([]);
  });
});

describe("fixtures", () => {
  it("hashes the filesystem it claims to describe", () => {
    // Guards the guard: a fixture whose hashes never matched would let an
    // integrity check that does nothing pass every test above.
    const target = fakePreviewTarget();
    expect(target.preparedFiles[0].contentHash).toBe(
      sha256(RESTORED_FILES["product/app/robots.ts"]),
    );
  });
});
