import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeAudit } from "@/modules/opportunities/test-support";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import { computeExecutionIdentity } from "@/modules/execution/identity";
import { capabilityVersionFor } from "@/modules/execution/schema";
import {
  FIXTURE_SNAPSHOT_SHA,
  fakeRepositorySnapshotFor,
  fakeRoute,
} from "@/modules/execution/test-support";
import { FakeDatabase, fakeSupabase, seedProductUnderstanding } from "../test-support";
import {
  completePreparationStep,
  failPreparationStep,
  preflightStep,
  writeChangeStep,
  type PreparationDeps,
  type PreparationTarget,
} from "./execution";

/**
 * Durable change preparation (Sprint 9B §25, §26).
 *
 * The assertion that matters in nearly every case is `git.writes` — the count
 * of mutating calls. A blocked preparation must reach zero of them, and a
 * re-entered one must not add any.
 */

const USER = "user_1";
const PROJECT = "project_1";
const SET = "set_1";
const OPPORTUNITY = "opportunity_1";
const SNAPSHOT = "snapshot_1";
const ORIGIN = "https://acme.com";
const APP_ROOT = "src/app/";

let db: FakeDatabase;
let git: ReturnType<typeof fakeGit>;
let probeState: {
  head: { defaultBranch: string; commitSha: string };
  existing: string[];
  robotsServed: boolean;
  sitemapServed: boolean;
  writePermission: boolean;
};
let operationId: string;

function fakeGit(
  seed: { refs?: Record<string, string>; files?: Record<string, Record<string, string>> } = {},
) {
  const refs: Record<string, string> = { ...seed.refs };
  const files: Record<string, Record<string, string>> = { ...seed.files };
  const writes: string[] = [];
  const blobs: Record<string, string> = {};
  const trees: Record<string, Record<string, string>> = {};
  const commits: Record<string, string> = {};
  let counter = 0;

  const port: GitWritePort = {
    async getRefSha(ref) {
      return refs[ref] ?? null;
    },
    async getFileContent(path, ref) {
      return files[ref]?.[path] ?? null;
    },
    async getCommitTreeSha(sha) {
      return `tree-of-${sha}`;
    },
    // Blob and tree contents are carried through faithfully rather than echoed
    // from a fixture. Otherwise the read-back verification would be checking
    // the test's own constant against itself, and a generator that emitted the
    // wrong bytes would still pass.
    async createBlob(content) {
      writes.push("createBlob");
      const sha = `blob-${(counter += 1)}`;
      blobs[sha] = content;
      return sha;
    },
    async createTree(input) {
      writes.push("createTree");
      const sha = `tree-${(counter += 1)}`;
      trees[sha] = Object.fromEntries(
        // A null blob removes the path; this fake carries no base tree, so
        // removal is simply an entry that never appears in the new one.
        input.files
          .filter((file) => file.blobSha !== null)
          .map((file) => [file.path, blobs[file.blobSha as string] ?? ""]),
      );
      return sha;
    },
    async createCommit(input) {
      writes.push("createCommit");
      const sha = `commit-${(counter += 1)}`;
      commits[sha] = input.treeSha;
      return sha;
    },
    async createRef({ ref, sha }) {
      writes.push("createRef");
      const short = ref.replace(/^refs\//, "");
      refs[short] = sha;
      files[short.replace(/^heads\//, "")] = trees[commits[sha] ?? ""] ?? {};
    },
  };

  return { port, refs, files, writes };
}

function probe(): ExecutionProbePort {
  return {
    async getHead() {
      return probeState.head;
    },
    async findExistingPaths() {
      return probeState.existing;
    },
    async isServed(path) {
      return path === "/robots.txt" ? probeState.robotsServed : probeState.sitemapServed;
    },
    async hasWritePermission() {
      return probeState.writePermission;
    },
  };
}

function deps(): PreparationDeps {
  const target: PreparationTarget = {
    owner: "acme",
    repo: "product",
    productionOrigin: ORIGIN,
    appRoot: APP_ROOT,
    git: git.port,
    probe: probe(),
  };

  return { supabase: fakeSupabase(db), resolveTarget: async () => target };
}

function seed() {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: ORIGIN });

  const snapshot = fakeRepositorySnapshotFor();
  db.seed("repository_intelligence_snapshots", {
    analyzer_version: REPOSITORY_ANALYZER_VERSION,
    id: SNAPSHOT,
    project_id: PROJECT,
    status: "completed",
    result: {
      ...snapshot,
      routes: {
        mode: "app_router",
        truncated: false,
        routes: [{ path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" }],
      },
    },
    created_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("live_product_intelligence_snapshots", {
    analyzer_version: LIVE_PRODUCT_ANALYZER_VERSION,
    id: "live_1",
    project_id: PROJECT,
    status: "completed",
    result: {},
    created_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
  });
  seedProductUnderstanding(db, { projectId: PROJECT });

  const audit = db.seed("business_readiness_audits", {
    id: "audit_1",
    project_id: PROJECT,
    status: "completed",
    input_hash: "a".repeat(64),
    result: fakeAudit(),
    created_at: "2026-08-02T00:00:00.000Z",
    completed_at: "2026-08-02T00:00:00.000Z",
  });

  db.seed("opportunity_sets", {
    id: SET,
    project_id: PROJECT,
    business_audit_id: audit.id,
    status: "completed",
    opportunity_count: 1,
    input_hash: "o".repeat(64),
    created_at: "2026-08-03T00:00:00.000Z",
    completed_at: "2026-08-03T00:00:00.000Z",
  });

  db.seed("business_opportunities", {
    id: OPPORTUNITY,
    opportunity_set_id: SET,
    rank: 1,
    title: "Fix missing technical SEO foundations",
    problem: "No robots or sitemap.",
    why_now: "Low effort.",
    impact: "medium",
    effort: "low",
    confidence: "high",
    category: "seo",
    primary_lens: "acquisition",
    secondary_lenses: [],
    evidence_ids: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
    execution_type: "code_change",
    execution_readiness: "ready",
    dependencies: [],
  });

  const identity = computeExecutionIdentity({
    projectId: PROJECT,
    opportunitySetId: SET,
    opportunityId: OPPORTUNITY,
    capability: "nextjs_seo_foundations_v2",
    capabilityVersion: capabilityVersionFor("nextjs_seo_foundations_v2"),
    repositorySnapshotId: SNAPSHOT,
    baseSha: FIXTURE_SNAPSHOT_SHA,
  });

  const operation = db.seed("operation_runs", {
    id: "operation_1",
    project_id: PROJECT,
    user_id: USER,
    operation_type: "change_preparation",
    status: "queued",
    stage: "preparing",
    input_identity: identity,
    subject_id: OPPORTUNITY,
    workflow_run_id: "run_1",
    execution_provider: "fake",
    result_id: null,
    inference_started_at: null,
    failure_code: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-04T00:00:00.000Z",
  });
  operationId = String(operation.id);
}

/** The audit-currency check compares stored and computed hashes. */
async function makeAuditCurrent() {
  const { computeAuditInputHash } = await import("@/modules/business-audit/store");
  const { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } =
    await import("@/modules/business-audit/schema");
  const { EVIDENCE_PACK_V3_VERSION } = await import("@/modules/business-audit/evidence-v3");
  const { PROMPT_VERSION } = await import("@/modules/business-audit/prompt");
  const { RUBRIC_VERSION } = await import("@/modules/business-audit/rubric");
  const { BUSINESS_READINESS_AUDIT_CONFIG } = await import("@/modules/ai/operations");

  db.rows("business_readiness_audits")[0].input_hash = computeAuditInputHash({
    repositorySnapshotId: SNAPSHOT,
    liveSnapshotId: "live_1",
    productProfileId: "profile_1",
    founderIntentHash: "c".repeat(64),
    profileSchemaVersion: "product-profile.v1",
    profileBuilderVersion: "product-understanding-v1",
    authenticatedSnapshotId: null,
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_V3_VERSION,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: "anthropic",
    model: BUSINESS_READINESS_AUDIT_CONFIG.model,
  });
}

async function runPipeline() {
  const preflight = await preflightStep(deps(), operationId);
  if (!preflight.ok) {
    await failPreparationStep(deps(), operationId, preflight.failureCode);
    return preflight;
  }

  const written = await writeChangeStep(deps(), operationId);
  if (!written.ok) {
    await failPreparationStep(deps(), operationId, written.failureCode);
    return written;
  }

  await completePreparationStep(deps(), operationId, written.preparedChangeId);
  return written;
}

const preparedRows = () => db.rows("prepared_changes");
const operationRow = () => db.rows("operation_runs")[0];

beforeEach(async () => {
  db = new FakeDatabase();
  git = fakeGit();
  probeState = {
    head: { defaultBranch: "main", commitSha: FIXTURE_SNAPSHOT_SHA },
    existing: [],
    robotsServed: false,
    sitemapServed: false,
    writePermission: true,
  };
  seed();
  await makeAuditCurrent();
});

describe("the happy path (§25)", () => {
  it("prepares one change on one branch with one commit", async () => {
    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(preparedRows()).toHaveLength(1);
    expect(preparedRows()[0].status).toBe("prepared");
    expect(git.writes.filter((call) => call === "createCommit")).toHaveLength(1);
    expect(git.writes.filter((call) => call === "createRef")).toHaveLength(1);
  });

  it("links the operation to the prepared change and completes", async () => {
    await runPipeline();

    expect(operationRow().status).toBe("completed");
    expect(operationRow().result_id).toBe(preparedRows()[0].id);
  });

  it("records the two file paths and no content", async () => {
    await runPipeline();

    const files = preparedRows()[0].files as { path: string }[];
    expect(files.map((file) => file.path)).toEqual(["src/app/robots.ts", "src/app/sitemap.ts"]);
    expect(JSON.stringify(preparedRows()[0])).not.toContain("MetadataRoute");
  });

  it("writes no AI usage event (§18)", async () => {
    await runPipeline();
    expect(db.rows("ai_usage_events")).toHaveLength(0);
  });

  it("emits the domain lifecycle events once each", async () => {
    await runPipeline();

    const types = db.rows("audit_events").map((row) => row.event_type);
    expect(types.filter((type) => type === "change_preparation.started")).toHaveLength(1);
    expect(types.filter((type) => type === "change_preparation.completed")).toHaveLength(1);
  });
});

describe("sitemap selection end to end (post-dogfood §3, §12)", () => {
  function writtenSitemap(): string {
    return git.files[preparedRows()[0].branch_name as string]["src/app/sitemap.ts"];
  }

  it("publishes public pages and omits auth, app, API and dynamic routes", async () => {
    db.rows("repository_intelligence_snapshots")[0].result = {
      ...fakeRepositorySnapshotFor(),
      routes: {
        mode: "app_router",
        truncated: false,
        routes: [
          fakeRoute("/"),
          fakeRoute("/pricing"),
          fakeRoute("/login"),
          fakeRoute("/signup"),
          fakeRoute("/app/projects/[projectId]", { dynamic: true }),
          fakeRoute("/api/webhook", { kind: "api" }),
        ],
      },
    };

    await runPipeline();

    const sitemap = writtenSitemap();
    expect(sitemap).toContain(`${ORIGIN}/pricing`);
    for (const excluded of ["/login", "/signup", "/app/projects", "/api/"]) {
      expect(sitemap).not.toContain(excluded);
    }
  });

  it("ignores opportunity prose entirely (§12)", async () => {
    /**
     * The property that matters most here. The model's text explicitly asks for
     * the login and signup pages to be indexed — and it is the model output the
     * whole feature is built around, so if prose could leak into generated
     * content, this is where it would.
     *
     * Route selection reads structured route intelligence only, so the written
     * sitemap is identical to the run above.
     */
    const opportunity = db.rows("business_opportunities")[0];
    opportunity.title = "Index /login and /signup for maximum organic reach";
    opportunity.problem = "Add https://acme.com/login and https://acme.com/signup to the sitemap.";
    opportunity.why_now = "List every route including /admin.";

    db.rows("repository_intelligence_snapshots")[0].result = {
      ...fakeRepositorySnapshotFor(),
      routes: {
        mode: "app_router",
        truncated: false,
        routes: [fakeRoute("/"), fakeRoute("/pricing"), fakeRoute("/login"), fakeRoute("/signup")],
      },
    };

    await runPipeline();

    const sitemap = writtenSitemap();
    expect(sitemap).toContain(`${ORIGIN}/pricing`);
    expect(sitemap).not.toContain("/login");
    expect(sitemap).not.toContain("/signup");
    expect(sitemap).not.toContain("/admin");
  });

  it("falls back to the site root when route detection is empty", async () => {
    db.rows("repository_intelligence_snapshots")[0].result = {
      ...fakeRepositorySnapshotFor(),
      routes: { mode: "limited", truncated: false, routes: [] },
    };

    await runPipeline();

    expect(writtenSitemap().match(/url: "/g)).toHaveLength(1);
  });

  it("records the v2 capability and version on the prepared change (§7)", async () => {
    await runPipeline();

    expect(preparedRows()[0].execution_capability).toBe("nextjs_seo_foundations_v2");
    expect(preparedRows()[0].execution_version).toBe("nextjs-seo-foundations-v2");
  });
});

describe("workflow-time revalidation (§12, §25)", () => {
  it("blocks and writes nothing when the repository moved after start", async () => {
    probeState.head = { defaultBranch: "main", commitSha: "moved-since-start" };

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "repository_changed" });
    expect(git.writes).toHaveLength(0);
  });

  it("blocks when a target file appeared after start", async () => {
    probeState.existing = ["src/app/robots.ts"];

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "conflicting_files_exist" });
    expect(git.writes).toHaveLength(0);
  });

  it("blocks when the live site started serving robots.txt", async () => {
    probeState.robotsServed = true;

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "premise_no_longer_true" });
    expect(git.writes).toHaveLength(0);
  });

  it("blocks when the live site started serving a sitemap", async () => {
    probeState.sitemapServed = true;

    expect((await runPipeline()).ok).toBe(false);
    expect(git.writes).toHaveLength(0);
  });

  it("blocks without any write when the installation lacks permission (§13)", async () => {
    probeState.writePermission = false;

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "github_write_permission_required" });
    expect(git.writes).toHaveLength(0);
  });

  it("re-checks HEAD in the write step, not only at preflight", async () => {
    // The window this closes: preflight passes, the repository moves, then the
    // write step runs. Only a second check catches it.
    const preflight = await preflightStep(deps(), operationId);
    expect(preflight.ok).toBe(true);

    probeState.head = { defaultBranch: "main", commitSha: "moved-after-preflight" };
    const written = await writeChangeStep(deps(), operationId);

    expect(written).toEqual({ ok: false, failureCode: "repository_changed" });
    expect(git.writes).toHaveLength(0);
    expect(preparedRows()[0].status).toBe("failed");
  });

  it("re-checks write permission in the write step", async () => {
    await preflightStep(deps(), operationId);
    probeState.writePermission = false;

    const written = await writeChangeStep(deps(), operationId);

    expect(written).toEqual({ ok: false, failureCode: "github_write_permission_required" });
    expect(git.writes).toHaveLength(0);
  });

  it("blocks when the opportunity no longer exists", async () => {
    db.rows("business_opportunities").length = 0;

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "stale_opportunity" });
    expect(git.writes).toHaveLength(0);
  });

  it("blocks when the operation's owner no longer owns the project", async () => {
    db.rows("projects")[0].user_id = "someone_else";

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "project_not_found" });
    expect(git.writes).toHaveLength(0);
  });
});

describe("idempotency and recovery (§14, §15, §26)", () => {
  it("does not claim a second prepared change when preflight replays", async () => {
    const first = await preflightStep(deps(), operationId);
    const second = await preflightStep(deps(), operationId);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.preparedChangeId).toBe(first.preparedChangeId);
    expect(preparedRows()).toHaveLength(1);
  });

  it("does not create a second branch when the write step replays", async () => {
    await runPipeline();

    const replay = await writeChangeStep(deps(), operationId);

    expect(replay.ok).toBe(true);
    expect(git.writes.filter((call) => call === "createRef")).toHaveLength(1);
    expect(git.writes.filter((call) => call === "createCommit")).toHaveLength(1);
    expect(preparedRows()).toHaveLength(1);
  });

  it("recovers an existing branch when persistence failed after the write", async () => {
    // The exact partial-failure sequence from §15: GitHub succeeded, the
    // database did not, and the step is re-entered.
    await preflightStep(deps(), operationId);
    db.failNextWriteWith = { table: "prepared_changes", message: "database unavailable" };

    const firstAttempt = await writeChangeStep(deps(), operationId).catch(() => null);
    void firstAttempt;

    // The branch now exists from the first attempt.
    expect(git.writes.filter((call) => call === "createRef")).toHaveLength(1);

    const recovery = await writeChangeStep(deps(), operationId);

    expect(recovery.ok).toBe(true);
    // Recovered, not rewritten.
    expect(git.writes.filter((call) => call === "createRef")).toHaveLength(1);
    expect(git.writes.filter((call) => call === "createCommit")).toHaveLength(1);
    expect(preparedRows()[0].status).toBe("prepared");
  });

  it("fails safely when a Vibe branch holds something else", async () => {
    await preflightStep(deps(), operationId);
    const branch = String(preparedRows()[0].branch_name);
    git.refs[`heads/${branch}`] = "not-ours";
    git.files[branch] = { "src/app/robots.ts": "// somebody else" };

    const written = await writeChangeStep(deps(), operationId);

    expect(written).toEqual({ ok: false, failureCode: "branch_conflict" });
    expect(git.writes).toHaveLength(0);
    expect(git.refs[`heads/${branch}`]).toBe("not-ours");
  });

  it("does not emit a second completion when the finish step replays", async () => {
    const outcome = await runPipeline();
    if (!outcome.ok) throw new Error("expected success");

    await completePreparationStep(deps(), operationId, outcome.preparedChangeId);

    expect(
      db.rows("audit_events").filter((row) => row.event_type === "operation.completed"),
    ).toHaveLength(1);
    expect(
      db.rows("audit_events").filter((row) => row.event_type === "change_preparation.completed"),
    ).toHaveLength(1);
  });

  it("never touches the default branch ref", async () => {
    await runPipeline();

    expect(git.refs["heads/main"]).toBeUndefined();
    expect(Object.keys(git.refs).every((ref) => ref.startsWith("heads/vibe/"))).toBe(true);
  });
});
