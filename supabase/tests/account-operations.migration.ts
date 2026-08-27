import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * ADR 0057 — the durable-operation model's account level.
 *
 * The five assertions ADR 0057 §Verification requirements names, and they are
 * in that document rather than invented here because this changes a model
 * everything else runs on. The first is the one that matters most and is the
 * easiest to forget: **a project-scoped operation's visibility must be
 * unchanged**. Everything else in this file is new behaviour; that one is a
 * promise about behaviour that already existed.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IDENTITY = "d".repeat(64);

let db: Cluster;

function makeUser(label: string): string {
  return db.sql(
    `with i as (insert into auth.users (email) values ('${label}@fixture.test') returning id)` +
      ` select id from i;`,
  );
}

function makeProject(userId: string, label: string): string {
  return db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${userId}', '${label}')` +
      ` returning id) select id from i;`,
  );
}

/** Runs a statement with RLS in force as one authenticated user. */
function asUser<T extends string>(userId: string, statements: string): T {
  return db.sqlLast(
    `begin; set local role authenticated;` +
      ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
      ` ${statements} commit;`,
  ) as T;
}

function asUserExpectingError(userId: string, statements: string): string {
  return db.sqlExpectingError(
    `begin; set local role authenticated;` +
      ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
      ` ${statements} commit;`,
  );
}

/** A durable operation, inserted with the privileges the store actually has. */
function insertOperation(params: {
  userId: string;
  projectId: string | null;
  type: string;
  status?: string;
  identity?: string;
}): string {
  const project = params.projectId ? `'${params.projectId}'` : "null";
  const status = params.status ?? "queued";
  const terminal = ["completed", "failed", "cancelled"].includes(status) ? "now()" : "null";
  // `failed` owes a failure code, the same as every other terminal state owes
  // a `completed_at`. Supplied here so the fixture cannot pass by accident.
  const failureCode = status === "failed" ? "'fixture_failure'" : "null";
  return db.sql(
    `with i as (insert into public.operation_runs` +
      ` (project_id, user_id, operation_type, input_identity, status, completed_at, failure_code)` +
      ` values (${project}, '${params.userId}', '${params.type}',` +
      ` '${params.identity ?? IDENTITY}', '${status}', ${terminal}, ${failureCode})` +
      ` returning id) select id from i;`,
  );
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("1. project-scoped visibility is unchanged", () => {
  it("shows a project operation to its owner and to nobody else", () => {
    const owner = makeUser("acct-owner");
    const stranger = makeUser("acct-stranger");
    const projectId = makeProject(owner, "owned");
    insertOperation({ userId: owner, projectId, type: "business_audit" });

    expect(
      asUser(owner, `select count(*) from public.operation_runs where project_id = '${projectId}';`),
    ).toBe("1");
    expect(
      asUser(stranger, `select count(*) from public.operation_runs where project_id = '${projectId}';`),
    ).toBe("0");
  });

  it("still hides a project operation whose user_id matches but whose project does not", () => {
    // The reason ADR 0057 §1 uses `case` rather than `or`. A disjunction would
    // have turned this row from denied into visible — a different rule for data
    // that already exists, which is not what the ADR decided.
    const owner = makeUser("acct-mismatch-a");
    const other = makeUser("acct-mismatch-b");
    const othersProject = makeProject(other, "theirs");
    insertOperation({ userId: owner, projectId: othersProject, type: "business_audit" });

    expect(
      asUser(owner, `select count(*) from public.operation_runs where project_id = '${othersProject}';`),
    ).toBe("0");
  });
});

describe("2. an account-level operation is visible to its owner alone", () => {
  it("is readable by the owner and invisible to everybody else", () => {
    const owner = makeUser("acct-level-owner");
    const stranger = makeUser("acct-level-stranger");
    const id = insertOperation({ userId: owner, projectId: null, type: "account_erasure" });

    expect(asUser(owner, `select count(*) from public.operation_runs where id = '${id}';`)).toBe("1");
    expect(asUser(stranger, `select count(*) from public.operation_runs where id = '${id}';`)).toBe("0");
  });

  it("can be inserted by its owner under RLS", () => {
    // The start path is a Server Action on the user's own session client, so
    // this has to work through the INSERT policy and not only as service_role.
    const owner = makeUser("acct-level-insert");

    asUser(
      owner,
      `insert into public.operation_runs (project_id, user_id, operation_type, input_identity, status)` +
        ` values (null, '${owner}', 'account_erasure', '${"e".repeat(64)}', 'queued');`,
    );

    expect(
      asUser(owner, `select count(*) from public.operation_runs where operation_type = 'account_erasure';`),
    ).toBe("1");
  });

  it("cannot be inserted on somebody else's behalf", () => {
    const owner = makeUser("acct-level-forge-a");
    const victim = makeUser("acct-level-forge-b");

    const error = asUserExpectingError(
      owner,
      `insert into public.operation_runs (project_id, user_id, operation_type, input_identity, status)` +
        ` values (null, '${victim}', 'account_erasure', '${"f".repeat(64)}', 'queued');`,
    );

    expect(error).toContain("row-level security");
  });
});

describe("3. account-level double submission is blocked", () => {
  it("refuses a second active operation with the same identity", () => {
    const owner = makeUser("acct-dupe");
    insertOperation({ userId: owner, projectId: null, type: "account_erasure" });

    const error = db.sqlExpectingError(
      `insert into public.operation_runs` +
        ` (project_id, user_id, operation_type, input_identity, status)` +
        ` values (null, '${owner}', 'account_erasure', '${IDENTITY}', 'queued');`,
    );

    // The same unique violation `createOperationRun` already maps to
    // `already_active` — which is why this is an index and not a lookup.
    expect(error).toContain("operation_runs_single_active_account_idx");
  });

  it("permits a second one once the first is terminal", () => {
    const owner = makeUser("acct-dupe-after");
    insertOperation({ userId: owner, projectId: null, type: "account_erasure", status: "failed" });

    expect(() =>
      insertOperation({ userId: owner, projectId: null, type: "account_erasure" }),
    ).not.toThrow();
  });
});

describe("4. the start-path trigger", () => {
  it("refuses new project work while an erasure is live", () => {
    const owner = makeUser("acct-trigger");
    const projectId = makeProject(owner, "frozen");
    insertOperation({ userId: owner, projectId: null, type: "account_erasure", status: "running" });

    const error = db.sqlExpectingError(
      `insert into public.operation_runs` +
        ` (project_id, user_id, operation_type, input_identity, status)` +
        ` values ('${projectId}', '${owner}', 'business_audit', '${IDENTITY}', 'queued');`,
    );

    expect(error).toContain("account erasure in progress");
  });

  it("refuses while the erasure is paused in needs_user, not only while running", () => {
    // ADR 0056 §10's named trap. A gate built on the store's two-value
    // ACTIVE_STATUSES would admit work beside a paused erasure.
    const owner = makeUser("acct-trigger-paused");
    const projectId = makeProject(owner, "paused");
    insertOperation({ userId: owner, projectId: null, type: "account_erasure", status: "needs_user" });

    const error = db.sqlExpectingError(
      `insert into public.operation_runs` +
        ` (project_id, user_id, operation_type, input_identity, status)` +
        ` values ('${projectId}', '${owner}', 'business_audit', '${IDENTITY}', 'queued');`,
    );

    expect(error).toContain("account erasure in progress");
  });

  it("never blocks the erasure's own insert", () => {
    const owner = makeUser("acct-trigger-self");
    insertOperation({ userId: owner, projectId: null, type: "account_erasure", status: "failed" });

    expect(() =>
      insertOperation({ userId: owner, projectId: null, type: "account_erasure" }),
    ).not.toThrow();
  });

  it("releases the account once the erasure is terminal", () => {
    // A failed erasure must not lock somebody out of their own product.
    const owner = makeUser("acct-trigger-released");
    const projectId = makeProject(owner, "released");
    insertOperation({ userId: owner, projectId: null, type: "account_erasure", status: "failed" });

    expect(() =>
      insertOperation({ userId: owner, projectId, type: "business_audit" }),
    ).not.toThrow();
  });

  it("does not freeze a different account", () => {
    const erasing = makeUser("acct-trigger-mine");
    const other = makeUser("acct-trigger-theirs");
    const othersProject = makeProject(other, "unaffected");
    insertOperation({ userId: erasing, projectId: null, type: "account_erasure", status: "running" });

    expect(() =>
      insertOperation({ userId: other, projectId: othersProject, type: "business_audit" }),
    ).not.toThrow();
  });
});

describe("5. the operation outlives its owner", () => {
  it("survives the identity's deletion with both owner columns null", () => {
    const owner = makeUser("acct-tombstone");
    const id = insertOperation({
      userId: owner,
      projectId: null,
      type: "account_erasure",
      status: "completed",
    });

    db.sql(`delete from auth.users where id = '${owner}';`);

    expect(
      db.sql(
        `select status || ':' || (user_id is null)::text || ':' || (project_id is null)::text` +
          ` from public.operation_runs where id = '${id}';`,
      ),
    ).toBe("completed:true:true");
  });

  it("accepts a completed erasure with no result_id", () => {
    // An erasure's product is absence. Every other type still owes a result.
    const owner = makeUser("acct-no-result");
    expect(() =>
      insertOperation({ userId: owner, projectId: null, type: "account_erasure", status: "completed" }),
    ).not.toThrow();

    const projectId = makeProject(owner, "still-owes");
    const error = db.sqlExpectingError(
      `insert into public.operation_runs` +
        ` (project_id, user_id, operation_type, input_identity, status, completed_at)` +
        ` values ('${projectId}', '${owner}', 'business_audit', '${IDENTITY}', 'completed', now());`,
    );
    expect(error).toContain("operation_runs_completed_has_result");
  });
});
