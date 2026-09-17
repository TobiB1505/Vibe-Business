import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The transcript's shape, and what it refuses (ADR 0109 §6, audit §C.9).
 *
 * ## Why this needs a real PostgreSQL
 *
 * Because every claim the schema makes is a CHECK, a composite foreign key, a
 * column-level grant or an RLS policy, and the in-memory test double evaluates
 * none of them. A unit suite can prove the store *sends* the right columns; it
 * cannot prove the database would refuse the wrong ones, which is the whole
 * reason they are constraints rather than comments.
 *
 * ## The two that matter most
 *
 * **A founder may write words and nothing else.** `authenticated` has insert on
 * `nova_messages`, and a client controls every byte it sends — so a policy that
 * only checked ownership would let a founder's own browser write an
 * `action_result` saying a merge succeeded into the record they later read back
 * as history. Two constraints refuse it: the RLS policy pins `author` to
 * `founder`, and a CHECK pins a founder's rows to `text`.
 *
 * **A message cannot be filed under the wrong project.** `project_id` is
 * denormalized onto every message so a scoped read needs no join, and the
 * composite foreign key is what stops that denormalization from being a second,
 * disagreeing answer.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let userId: string;
let otherUserId: string;
let projectId: string;
let otherProjectId: string;
let threadId: string;
let sequence = 0;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  userId = db.sql(
    `with i as (insert into auth.users (email) values ('threads@fixture.test') returning id) select id from i;`,
  );
  otherUserId = db.sql(
    `with i as (insert into auth.users (email) values ('other@fixture.test') returning id) select id from i;`,
  );
  projectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${userId}', 'threads') returning id) select id from i;`,
  );
  otherProjectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${otherUserId}', 'other') returning id) select id from i;`,
  );
  threadId = db.sql(
    `with i as (insert into public.nova_threads (project_id, user_id, title)` +
      ` values ('${projectId}', '${userId}', 'What to do next') returning id) select id from i;`,
  );
}, 300_000);

afterAll(() => db?.stop());

/** A message insert with the columns a kind needs, as the store writes one. */
function message(columns: Record<string, string>): string {
  sequence += 1;
  const row: Record<string, string> = {
    thread_id: `'${threadId}'`,
    project_id: `'${projectId}'`,
    user_id: `'${userId}'`,
    sequence: String(sequence),
    ...columns,
  };
  return (
    `insert into public.nova_messages (${Object.keys(row).join(", ")})` +
    ` values (${Object.values(row).join(", ")})`
  );
}

describe("a thread", () => {
  it("belongs to a project and starts open, unread and empty", () => {
    const row = db.sql(
      `select status || ' ' || last_read_sequence || ' ' || coalesce(last_message_at::text, 'none')` +
        ` from public.nova_threads where id = '${threadId}';`,
    );
    expect(row).toBe("open 0 none");
  });

  it("refuses a title nobody could read", () => {
    expect(
      db.sqlExpectingError(
        `insert into public.nova_threads (project_id, user_id, title)` +
          ` values ('${projectId}', '${userId}', '   ');`,
      ),
    ).toContain("nova_threads_title_check");
  });

  it("refuses a status outside the two it has", () => {
    expect(
      db.sqlExpectingError(
        `insert into public.nova_threads (project_id, user_id, title, status)` +
          ` values ('${projectId}', '${userId}', 'x', 'deleted');`,
      ),
    ).toContain("nova_threads_status_check");
  });
});

describe("a turn", () => {
  it("takes words for a text message", () => {
    db.sql(message({ author: "'nova'", kind: "'text'", body: "'Your audit is out of date.'" }));
  });

  it("refuses words on an event, because the sentence is composed today", () => {
    const run = db.sql(
      `with i as (insert into public.operation_runs` +
        ` (project_id, user_id, operation_type, input_identity, status, completed_at, result_id)` +
        ` values ('${projectId}', '${userId}', 'business_audit', '${"a".repeat(64)}',` +
        ` 'completed', now(), gen_random_uuid()) returning id) select id from i;`,
    );
    db.sql(message({ author: "'system'", kind: "'event'", operation_run_id: `'${run}'` }));

    expect(
      db.sqlExpectingError(
        message({
          author: "'system'",
          kind: "'event'",
          operation_run_id: `'${run}'`,
          body: "'Your audit finished.'",
        }),
      ),
    ).toContain("nova_messages_event_names_its_run");
  });

  it("refuses an event that names no run", () => {
    expect(db.sqlExpectingError(message({ author: "'system'", kind: "'event'" }))).toContain(
      "nova_messages_event_names_its_run",
    );
  });

  it("refuses a proposal that already carries an outcome", () => {
    expect(
      db.sqlExpectingError(
        message({
          author: "'nova'",
          kind: "'action_proposal'",
          action_id: "'nova.refresh_audit'",
          subject_kind: "'project'",
          outcome: "'succeeded'",
        }),
      ),
    ).toContain("nova_messages_proposal_names_its_action");
  });

  it("takes a proposal about the project with no subject id", () => {
    db.sql(
      message({
        author: "'nova'",
        kind: "'action_proposal'",
        action_id: "'nova.refresh_audit'",
        subject_kind: "'project'",
      }),
    );
  });

  it("refuses a subject kind with no id, when the kind needs one", () => {
    expect(
      db.sqlExpectingError(
        message({
          author: "'nova'",
          kind: "'action_proposal'",
          action_id: "'nova.merge_change'",
          subject_kind: "'prepared_change'",
        }),
      ),
    ).toContain("nova_messages_subject_is_whole");
  });

  it("refuses an action id from somewhere other than the catalogue", () => {
    expect(
      db.sqlExpectingError(
        message({
          author: "'nova'",
          kind: "'action_proposal'",
          action_id: "'DROP TABLE'",
          subject_kind: "'project'",
        }),
      ),
    ).toContain("nova_messages_action_id_check");
  });

  it("takes an artifact by reference and refuses one by URL", () => {
    db.sql(
      message({
        author: "'nova'",
        kind: "'artifact'",
        artifact_kind: "'prepared_change'",
        artifact_ref: "'change_7'",
      }),
    );

    expect(
      db.sqlExpectingError(
        message({
          author: "'nova'",
          kind: "'artifact'",
          artifact_kind: "'not_a_kind'",
          artifact_ref: "'x'",
        }),
      ),
    ).toContain("nova_messages_artifact_kind_check");
  });

  it("keeps one sequence per thread", () => {
    const at = sequence + 1;
    db.sql(
      `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
        ` values ('${threadId}', '${projectId}', '${userId}', ${at}, 'nova', 'text', 'first');`,
    );
    sequence = at;

    expect(
      db.sqlExpectingError(
        `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
          ` values ('${threadId}', '${projectId}', '${userId}', ${at}, 'nova', 'text', 'second');`,
      ),
    ).toContain("nova_messages_sequence_unique");
  });

  it("cannot be filed under a project its thread does not belong to", () => {
    expect(
      db.sqlExpectingError(
        `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
          ` values ('${threadId}', '${otherProjectId}', '${userId}', 9001, 'nova', 'text', 'x');`,
      ),
    ).toContain("nova_messages_thread_project_fk");
  });

  it("refuses a message longer than a founder would write", () => {
    expect(
      db.sqlExpectingError(
        message({ author: "'nova'", kind: "'text'", body: `'${"x".repeat(1201)}'` }),
      ),
    ).toContain("nova_messages_body_check");
  });
});

describe("what a founder's own session may write", () => {
  /** Acts as PostgREST does: that user's JWT subject, then the role. */
  function asOwner(statements: string): string {
    return (
      `begin;` +
      ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
      ` set local role authenticated;` +
      ` ${statements} commit;`
    );
  }

  /**
   * Written when a founder's session could insert their own words, and rewritten
   * in the open when Slice 7's boundary migration took that grant away.
   *
   * The `insert own nova_messages` policy admitted `author = 'founder'` rows and
   * no code ever used it: the conversation's one write is
   * `append_nova_conversation_turn`, which is `security definer` and does not
   * pass through a policy at all. So the assertions below used to measure which
   * *rows* the policy rejected, and they now measure that there is no row a
   * founder can offer it — which is the stronger claim, and the one rule 11
   * asks for. The per-kind CHECKs those rows were also exercising are proved
   * directly, above, where the writer is the service role and the constraint is
   * the only thing standing there.
   */
  it.each([
    ["their own words", `${"$SEQ"}, 'founder', 'text', 'Why is conversion the blocker?'`],
    ["a system event", `${"$SEQ"}, 'system', 'text', 'The merge finished.'`],
    ["something in Nova's voice", `${"$SEQ"}, 'nova', 'text', 'I merged it for you.'`],
  ])("refuses to let them write %s", (_name, tail) => {
    const at = sequence + 1;
    expect(
      db.sqlExpectingError(
        asOwner(
          `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
            ` values ('${threadId}', '${projectId}', '${userId}', ${tail.replace("$SEQ", String(at))});`,
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("holds no insert privilege on the table at all", () => {
    expect(
      db.sql(
        `select count(*) from information_schema.role_table_grants` +
          ` where grantee = 'authenticated' and table_name = 'nova_messages'` +
          ` and privilege_type = 'INSERT';`,
      ),
    ).toBe("0");
  });

  it("shows them their own threads and nobody else's", () => {
    expect(db.sqlLast(asOwner(`select count(*) from public.nova_threads;`))).toBe("1");

    const otherThread = db.sql(
      `with i as (insert into public.nova_threads (project_id, user_id, title)` +
        ` values ('${otherProjectId}', '${otherUserId}', 'not yours') returning id) select id from i;`,
    );
    expect(otherThread).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.sqlLast(asOwner(`select count(*) from public.nova_threads;`))).toBe("1");
  });

  it("lets them mark a thread read, and nothing else about it", () => {
    db.sql(
      asOwner(`update public.nova_threads set last_read_sequence = 3 where id = '${threadId}';`),
    );
    expect(
      db.sql(`select last_read_sequence from public.nova_threads where id = '${threadId}';`),
    ).toBe("3");

    expect(
      db.sqlExpectingError(
        asOwner(`update public.nova_threads set title = 'renamed' where id = '${threadId}';`),
      ),
    ).toMatch(/permission denied/);
  });

  it("gives them no way to remove one turn from a transcript", () => {
    expect(
      db.sqlExpectingError(
        asOwner(`delete from public.nova_messages where thread_id = '${threadId}';`),
      ),
    ).toMatch(/permission denied/);
  });
});
