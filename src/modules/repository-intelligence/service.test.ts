import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const getHead = vi.fn();
const getTree = vi.fn();
const getTextFile = vi.fn();
const createGithubRepositoryReader = vi.fn(() => ({ getHead, getTree, getTextFile }));

vi.mock("@/modules/github/repository-reader", () => ({ createGithubRepositoryReader }));

const recordAuditEvent = vi.fn(async () => undefined);
vi.mock("@/modules/audit-log/events", () => ({ recordAuditEvent }));

const { inspectRepository } = await import("./service");
const { ANALYZER_VERSION } = await import("./schema");
const { GithubDomainError } = await import("@/modules/github/errors");

const COMMIT = "b".repeat(40);

type TableRows = {
  project?: unknown;
  connection?: unknown;
  installation?: unknown;
  reusable?: unknown;
};

/**
 * Minimal Supabase stand-in. Mirrors only the chained calls the service
 * actually makes, so a change in query shape surfaces as a test failure
 * rather than passing silently.
 */
function fakeSupabase(rows: TableRows, overrides: { insertError?: { code?: string; message: string } } = {}) {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];

  const client = {
    from(table: string) {
      if (table === "projects") {
        return chain(rows.project);
      }
      if (table === "repository_connections") {
        return chain(rows.connection);
      }
      if (table === "github_installations") {
        return chain(rows.installation);
      }
      if (table === "repository_intelligence_snapshots") {
        return {
          select: () => selectChain(rows.reusable),
          insert: (values: unknown) => {
            inserted.push(values);
            return {
              select: () => ({
                single: async () =>
                  overrides.insertError
                    ? { data: null, error: overrides.insertError }
                    : { data: { id: "snapshot-1" }, error: null },
              }),
            };
          },
          update: (values: unknown) => {
            updated.push(values);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, inserted, updated };
}

function chain(data: unknown) {
  const result = {
    select: () => result,
    eq: () => result,
    // The connection boundary filters detached rows out (VB-001 M5).
    is: () => result,
    maybeSingle: async () => ({ data: data ?? null, error: null }),
  };
  return result;
}

function selectChain(data: unknown) {
  const result = {
    eq: () => result,
    order: () => result,
    limit: () => result,
    maybeSingle: async () => ({ data: data ?? null, error: null }),
  };
  return result;
}

const OWNED = {
  project: { id: "project-1" },
  connection: {
    id: "connection-1",
    project_id: "project-1",
    owner: "octocat",
    name: "demo",
    full_name: "octocat/demo",
    private: false,
    github_installation_id: "installation-row-1",
  },
  installation: { installation_id: 42 },
};

describe("inspectRepository — ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHead.mockResolvedValue({ defaultBranch: "main", commitSha: COMMIT });
    getTree.mockResolvedValue({ entries: [], truncated: false });
    getTextFile.mockResolvedValue(null);
  });

  it("rejects a project the user does not own, without touching GitHub", async () => {
    const { client } = fakeSupabase({ project: null });

    const result = await inspectRepository(client, { projectId: "project-1", userId: "attacker" });

    expect(result).toEqual({ ok: false, error: "repository_not_connected" });
    expect(createGithubRepositoryReader).not.toHaveBeenCalled();
  });

  it("rejects when the project has no repository connection", async () => {
    const { client } = fakeSupabase({ project: { id: "project-1" }, connection: null });

    const result = await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    expect(result).toEqual({ ok: false, error: "repository_not_connected" });
    expect(createGithubRepositoryReader).not.toHaveBeenCalled();
  });

  it("rejects when the installation does not belong to the user", async () => {
    const { client } = fakeSupabase({ ...OWNED, installation: null });

    const result = await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    expect(result).toEqual({ ok: false, error: "repository_not_connected" });
    expect(createGithubRepositoryReader).not.toHaveBeenCalled();
  });

  it("derives the repository identity from persisted data, never from caller input", async () => {
    const { client } = fakeSupabase(OWNED);

    await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    expect(createGithubRepositoryReader).toHaveBeenCalledWith(42, "octocat", "demo");
  });
});

describe("inspectRepository — reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHead.mockResolvedValue({ defaultBranch: "main", commitSha: COMMIT });
    getTree.mockResolvedValue({ entries: [], truncated: false });
    getTextFile.mockResolvedValue(null);
  });

  it("reuses an existing snapshot for an unchanged commit and analyzer version", async () => {
    const { client, inserted } = fakeSupabase({
      ...OWNED,
      reusable: {
        id: "snapshot-old",
        project_id: "project-1",
        status: "completed",
        source_commit_sha: COMMIT,
        source_branch: "main",
        analyzer_version: ANALYZER_VERSION,
        completeness: "complete",
        completeness_reasons: [],
        failure_code: null,
        result: { schemaVersion: "repository_intelligence.v1" },
        created_at: "2026-08-09T00:00:00Z",
        completed_at: "2026-08-09T00:00:00Z",
      },
    });

    const result = await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.reused).toBe(true);
    // No new run row, and the tree was never read.
    expect(inserted).toHaveLength(0);
    expect(getTree).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "repository.intelligence.reused" }),
    );
  });

  it("runs a fresh analysis when no reusable snapshot exists", async () => {
    const { client, inserted } = fakeSupabase({ ...OWNED, reusable: null });

    const result = await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.reused).toBe(false);
    expect(inserted).toHaveLength(1);
    expect(getTree).toHaveBeenCalled();
  });

  it("ignores a reusable snapshot when force is requested", async () => {
    const { client } = fakeSupabase({
      ...OWNED,
      reusable: {
        id: "snapshot-old",
        project_id: "project-1",
        status: "completed",
        source_commit_sha: COMMIT,
        source_branch: "main",
        analyzer_version: ANALYZER_VERSION,
        completeness: "complete",
        completeness_reasons: [],
        failure_code: null,
        result: {},
        created_at: "2026-08-09T00:00:00Z",
        completed_at: "2026-08-09T00:00:00Z",
      },
    });

    const result = await inspectRepository(client, { projectId: "project-1", userId: "user-1" }, { force: true });

    expect(result.ok && result.reused).toBe(false);
    expect(getTree).toHaveBeenCalled();
  });
});

describe("inspectRepository — failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTree.mockResolvedValue({ entries: [], truncated: false });
    getTextFile.mockResolvedValue(null);
  });

  it("surfaces a missing Contents permission as a typed error", async () => {
    getHead.mockRejectedValue(new GithubDomainError("github_contents_permission_required", 403));
    const { client } = fakeSupabase(OWNED);

    const result = await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    expect(result).toEqual({ ok: false, error: "github_contents_permission_required" });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "repository.intelligence.failed" }),
    );
  });

  it("surfaces an empty repository as a typed error", async () => {
    getHead.mockRejectedValue(new GithubDomainError("repository_empty", 409));
    const { client } = fakeSupabase(OWNED);

    expect(await inspectRepository(client, { projectId: "project-1", userId: "user-1" })).toEqual({
      ok: false,
      error: "repository_empty",
    });
  });

  it("reports already_running when the in-flight guard rejects a duplicate run", async () => {
    getHead.mockResolvedValue({ defaultBranch: "main", commitSha: COMMIT });
    const { client } = fakeSupabase({ ...OWNED, reusable: null }, {
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    expect(await inspectRepository(client, { projectId: "project-1", userId: "user-1" })).toEqual({
      ok: false,
      error: "already_running",
    });
  });

  it("marks the run failed and never records a completed snapshot when analysis throws", async () => {
    getHead.mockResolvedValue({ defaultBranch: "main", commitSha: COMMIT });
    getTree.mockRejectedValue(new GithubDomainError("github_rate_limited", 403));
    const { client, updated } = fakeSupabase({ ...OWNED, reusable: null });

    const result = await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    expect(result).toEqual({ ok: false, error: "github_rate_limited" });
    expect(updated).toEqual([expect.objectContaining({ status: "failed", failure_code: "github_rate_limited" })]);
  });

  it("never places a token or secret into audit metadata", async () => {
    getHead.mockResolvedValue({ defaultBranch: "main", commitSha: COMMIT });
    const { client } = fakeSupabase({ ...OWNED, reusable: null });

    await inspectRepository(client, { projectId: "project-1", userId: "user-1" });

    const metadataText = JSON.stringify(recordAuditEvent.mock.calls);
    expect(metadataText).not.toMatch(/token|secret|authorization/i);
  });
});
