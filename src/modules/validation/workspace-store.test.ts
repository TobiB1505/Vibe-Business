import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import type { BuildIntelligence, BuildTarget } from "@/modules/repository-intelligence/schema";
import {
  chooseWorkspaceRoot,
  getChosenWorkspaceRoot,
  resolveProjectValidationTarget,
} from "./workspace-store";
import { fakeValidatableSnapshot } from "./test-support";

/**
 * Recording which application a project's owner works on.
 *
 * The property under test is that a stored answer is only ever **applied**, and
 * only when it names something Vibe itself offered. Everything else here is a
 * refusal, which is the shape this whole subsystem takes.
 */

const PROJECT = "project_1";

function target(overrides: Partial<BuildTarget>): BuildTarget {
  return {
    directory: ".",
    manifestPath: "package.json",
    buildScript: true,
    frameworks: ["nextjs"],
    lockfile: { path: "pnpm-lock.yaml", packageManager: "pnpm", inTargetDirectory: true },
    declaresWorkspaces: false,
    moduleLinker: null,
    ...overrides,
  };
}

/** Two independently installable applications, which is what raises the question. */
const TWO_APPS: BuildIntelligence = {
  targets: [
    target({
      directory: "apps/api",
      manifestPath: "apps/api/package.json",
      frameworks: ["express"],
      lockfile: {
        path: "apps/api/pnpm-lock.yaml",
        packageManager: "pnpm",
        inTargetDirectory: true,
      },
    }),
    target({
      directory: "apps/web",
      manifestPath: "apps/web/package.json",
      lockfile: {
        path: "apps/web/package-lock.json",
        packageManager: "npm",
        inTargetDirectory: true,
      },
    }),
  ],
  truncated: false,
};

const snapshot = () => fakeValidatableSnapshot({ build: TWO_APPS });

let db: FakeDatabase;

function seed(options: { workspaceRoot?: string | null; detached?: boolean } = {}) {
  db.seed("repository_connections", {
    id: "conn-1",
    project_id: PROJECT,
    workspace_root: options.workspaceRoot ?? null,
    workspace_root_chosen_at: options.workspaceRoot ? "2026-09-03T00:00:00.000Z" : null,
    detached_at: options.detached ? "2026-09-03T00:00:00.000Z" : null,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("applying a stored answer", () => {
  it("resolves the application its owner named", async () => {
    seed({ workspaceRoot: "apps/web" });

    const resolution = await resolveProjectValidationTarget(fakeSupabase(db), {
      projectId: PROJECT,
      snapshot: snapshot(),
    });

    expect(resolution).toMatchObject({
      supported: true,
      workspaceRoot: "apps/web",
      packageManager: "npm",
    });
  });

  it("keeps asking when nobody has answered", async () => {
    seed();

    expect(
      await resolveProjectValidationTarget(fakeSupabase(db), {
        projectId: PROJECT,
        snapshot: snapshot(),
      }),
    ).toMatchObject({ supported: false, reason: "workspace_choice_required" });
  });

  it("asks again when the answer no longer names an application", async () => {
    // The application was deleted or restructured. Reaching for the nearest
    // surviving candidate would run against something nobody chose (rule 55).
    seed({ workspaceRoot: "apps/gone" });

    expect(
      await resolveProjectValidationTarget(fakeSupabase(db), {
        projectId: PROJECT,
        snapshot: snapshot(),
      }),
    ).toMatchObject({ supported: false, reason: "workspace_choice_required" });
  });

  it("asks the database nothing when there is only one application", async () => {
    // A project with one app never pays for this read, and — more to the point
    // — a stored answer could not change an answer that has no alternatives.
    seed({ workspaceRoot: "apps/web" });

    const resolution = await resolveProjectValidationTarget(fakeSupabase(db), {
      projectId: PROJECT,
      snapshot: fakeValidatableSnapshot(),
    });

    expect(resolution).toMatchObject({ supported: true, workspaceRoot: "." });
  });

  it("reads no answer from a repository that was let go", async () => {
    seed({ workspaceRoot: "apps/web", detached: true });

    expect(await getChosenWorkspaceRoot(fakeSupabase(db), PROJECT)).toBeNull();
  });
});

describe("recording an answer", () => {
  it("stores the application, with when it was chosen", async () => {
    seed();

    const outcome = await chooseWorkspaceRoot(fakeSupabase(db), {
      projectId: PROJECT,
      workspaceRoot: "apps/web",
      snapshot: snapshot(),
    });

    expect(outcome).toEqual({ ok: true, workspaceRoot: "apps/web" });

    const row = db.rows("repository_connections")[0];
    expect(row.workspace_root).toBe("apps/web");
    expect(row.workspace_root_chosen_at).not.toBeNull();
  });

  /*
   * The refusal that matters, and why it is one refusal rather than two.
   *
   * `../secrets` and `apps/gone` are rejected by the same mechanism: neither is
   * in the candidate list Vibe derived from tree entries it read itself. The
   * store checks no path shape, and adding one would be a second, weaker gate
   * that could drift from the first.
   */
  it.each(["../secrets", "/etc", "apps/../..", "apps/gone", "APPS/WEB", ""])(
    "refuses %s, because it is not a candidate",
    async (workspaceRoot) => {
      seed();

      expect(
        await chooseWorkspaceRoot(fakeSupabase(db), {
          projectId: PROJECT,
          workspaceRoot,
          snapshot: snapshot(),
        }),
      ).toEqual({ ok: false, reason: "not_a_candidate" });

      expect(db.rows("repository_connections")[0].workspace_root).toBeNull();
    },
  );

  it("refuses an application in a repository with only one", async () => {
    // Nothing to choose between, so there is no choice to record. The write
    // would not be inert either: a root stored here answers the question the
    // day a second application appears, and nobody was ever asked it.
    seed();

    expect(
      await chooseWorkspaceRoot(fakeSupabase(db), {
        projectId: PROJECT,
        workspaceRoot: ".",
        snapshot: fakeValidatableSnapshot(),
      }),
    ).toEqual({ ok: false, reason: "no_choice_to_make" });

    expect(db.rows("repository_connections")[0].workspace_root).toBeNull();
  });

  it("writes nothing for a repository that was let go", async () => {
    // Changing a setting for a repository the founder disconnected would leave
    // it waiting if that repository were ever reconnected.
    seed({ detached: true });

    expect(
      await chooseWorkspaceRoot(fakeSupabase(db), {
        projectId: PROJECT,
        workspaceRoot: "apps/web",
        snapshot: snapshot(),
      }),
    ).toEqual({ ok: false, reason: "no_repository" });
  });

  it("reports no repository rather than succeeding when there is none", async () => {
    expect(
      await chooseWorkspaceRoot(fakeSupabase(db), {
        projectId: PROJECT,
        workspaceRoot: "apps/web",
        snapshot: snapshot(),
      }),
    ).toEqual({ ok: false, reason: "no_repository" });
  });
});
