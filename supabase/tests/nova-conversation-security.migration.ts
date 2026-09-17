import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The conversation as a trust boundary, attacked on purpose.
 *
 * ## Why this file is separate from `nova-conversation-turn.migration.ts`
 *
 * That one proves the function does its job. This one assumes an attacker holds
 * a valid session — which is the realistic case, because every founder does —
 * and asks what they can reach with it. The two read differently and fail for
 * different reasons, and merging them would bury each in the other.
 *
 * ## The threat model
 *
 * A signed-in founder with a browser, a REST endpoint and no scruples. They
 * control every byte of every request: the thread id, the project id, the
 * `user_id` column, the `author` column, the sequence, the artifact reference,
 * the action id, and how many requests they send at once. They do **not**
 * control `auth.uid()`, which is the claim PostgREST sets from a verified JWT,
 * and that asymmetry is the whole of the security model here.
 *
 * ## What is deliberately not asserted
 *
 * That the JWT is genuine. That is Supabase Auth's boundary and this suite
 * stubs `auth.uid()` from a GUC to reach the one below it. And nothing here
 * says a word about *answer quality* — a model that says something wrong is not
 * a security failure, it is an eval, and there is not one yet.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let owner: string;
let stranger: string;
let ownerProject: string;
let strangerProject: string;
let ownerThread: string;
let strangerThread: string;
let archivedThread: string;

/** One statement, run as a founder with a session. */
function asUser(userId: string, statement: string): string {
  return (
    `begin;` +
    ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
    ` set local role authenticated;` +
    ` ${statement} commit;`
  );
}

function call(args: string): string {
  return `select public.append_nova_conversation_turn(${args});`;
}

function newUser(email: string): string {
  return db.sql(
    `with i as (insert into auth.users (email) values ('${email}') returning id) select id from i;`,
  );
}

function newProject(userId: string, name: string): string {
  return db.sql(
    `with i as (insert into public.projects (user_id, name)` +
      ` values ('${userId}', '${name}') returning id) select id from i;`,
  );
}

function newThread(projectId: string, userId: string, title: string): string {
  return db.sql(
    `with i as (insert into public.nova_threads (project_id, user_id, title)` +
      ` values ('${projectId}', '${userId}', '${title}') returning id) select id from i;`,
  );
}

function messageCount(threadId: string): number {
  return Number(
    db.sql(`select count(*) from public.nova_messages where thread_id = '${threadId}';`),
  );
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);

  owner = newUser("owner@boundary.test");
  stranger = newUser("stranger@boundary.test");

  ownerProject = newProject(owner, "mine");
  strangerProject = newProject(stranger, "theirs");

  ownerThread = newThread(ownerProject, owner, "Your product");
  strangerThread = newThread(strangerProject, stranger, "Their product");

  archivedThread = newThread(ownerProject, owner, "Put away");
  db.sql(`update public.nova_threads set status = 'archived' where id = '${archivedThread}';`);
}, 300_000);

afterAll(() => db?.stop());

/**
 * Who the caller is, and where that answer comes from.
 *
 * Rule 53's sentence, asked of a definer function rather than of the
 * service-role client: authority is a persisted relationship, never an argument.
 */
describe("identity is never taken from the request", () => {
  it("refuses a thread in a project the caller does not own", () => {
    expect(
      db.sqlExpectingError(asUser(owner, call(`'${strangerThread}', 'let me read this', 'no'`))),
    ).toContain("thread_not_found");

    expect(messageCount(strangerThread)).toBe(0);
  });

  it("gives a thread that does not exist the same answer as one that is not yours", () => {
    const missing = db.sqlExpectingError(
      asUser(owner, call(`'00000000-0000-0000-0000-000000000000', 'hello', 'hi'`)),
    );
    const foreign = db.sqlExpectingError(asUser(owner, call(`'${strangerThread}', 'hello', 'hi'`)));

    // From outside, "not yours" and "not there" must be indistinguishable.
    expect(missing).toContain("thread_not_found");
    expect(foreign).toContain("thread_not_found");
  });

  it("refuses a caller with no session at all", () => {
    expect(
      db.sqlExpectingError(
        `begin; set local role authenticated;` + ` ${call(`'${ownerThread}', 'a', 'b'`)} commit;`,
      ),
    ).toContain("not_authenticated");
  });

  it("is not executable by anon", () => {
    expect(
      db.sqlExpectingError(
        `begin; set local role anon; ${call(`'${ownerThread}', 'a', 'b'`)} commit;`,
      ),
    ).toMatch(/permission denied|not_authenticated/);
  });

  /**
   * The `author` column is not an argument, so there is nothing to forge. The
   * function writes `'founder'` and `'nova'` as literals and the caller has no
   * say — which is what stops a browser putting words in Nova's mouth inside
   * the founder's own history.
   */
  it("takes no author argument to forge", () => {
    const args = db.sql(
      `select pg_get_function_arguments(oid) from pg_proc` +
        ` where proname = 'append_nova_conversation_turn';`,
    );

    expect(args).not.toContain("author");
    expect(args).not.toContain("user_id");
    expect(args).not.toContain("p_project");
  });

  /**
   * Every row the function writes carries `auth.uid()` and the thread's own
   * project, both read inside the function. A caller supplies neither.
   */
  it("stamps the rows it writes with the session's own identity", () => {
    db.sqlLast(asUser(owner, call(`'${ownerThread}', 'whose row is this?', 'Yours.'`)));

    expect(
      db.sql(
        `select count(*) from public.nova_messages` +
          ` where thread_id = '${ownerThread}'` +
          ` and (user_id <> '${owner}' or project_id <> '${ownerProject}');`,
      ),
    ).toBe("0");
  });
});

/**
 * The second door onto the transcript, and the fact that it is now shut.
 *
 * Before Slice 7's boundary migration an authenticated founder could insert
 * their own `author = 'founder'` rows. Nothing ever used it, and it was the
 * route every direct-insert attack below would have taken: a chosen sequence, a
 * message filed under someone else's thread, a write into an archived
 * conversation. Least privilege (rule 11) closed it.
 */
describe("a founder cannot write a message directly", () => {
  it.each([
    [
      "into their own thread",
      `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
        ` values ('$THREAD', '$PROJECT', '$OWNER', 9001, 'founder', 'text', 'let me in');`,
    ],
    [
      "as Nova",
      `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
        ` values ('$THREAD', '$PROJECT', '$OWNER', 9002, 'nova', 'text', 'I already merged it.');`,
    ],
    [
      "as the system, claiming an outcome",
      `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind,` +
        ` action_id, subject_kind, subject_id, outcome)` +
        ` values ('$THREAD', '$PROJECT', '$OWNER', 9003, 'system', 'action_result',` +
        ` 'nova.merge_change', 'prepared_change', 'made-up', 'succeeded');`,
    ],
    [
      "into another founder's thread",
      `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
        ` values ('$FOREIGN_THREAD', '$FOREIGN_PROJECT', '$OWNER', 9004, 'founder', 'text', 'hello');`,
    ],
    [
      "under their own project id but somebody else's thread",
      `insert into public.nova_messages (thread_id, project_id, user_id, sequence, author, kind, body)` +
        ` values ('$FOREIGN_THREAD', '$PROJECT', '$OWNER', 9005, 'founder', 'text', 'hello');`,
    ],
  ])("refuses an insert %s", (_name, statement) => {
    const filled = statement
      .replaceAll("$THREAD", ownerThread)
      .replaceAll("$PROJECT", ownerProject)
      .replaceAll("$OWNER", owner)
      .replaceAll("$FOREIGN_THREAD", strangerThread)
      .replaceAll("$FOREIGN_PROJECT", strangerProject);

    expect(db.sqlExpectingError(asUser(owner, filled))).toContain("permission denied");
  });

  it("holds no insert, update or delete privilege on the table", () => {
    const granted = db.sql(
      `select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'none')` +
        ` from information_schema.role_table_grants` +
        ` where grantee = 'authenticated' and table_name = 'nova_messages';`,
    );

    expect(granted).toBe("SELECT");
  });

  it("has no insert policy left to satisfy", () => {
    expect(
      db.sql(
        `select count(*) from pg_policies where tablename = 'nova_messages' and cmd = 'INSERT';`,
      ),
    ).toBe("0");
  });
});

/**
 * Threads are the one thing a founder may create, because *New chat* is a
 * founder pressing a button. The grant is three columns; the policy is the
 * project row.
 */
describe("a founder may open a thread, and only their own", () => {
  it("opens one in a project they own", () => {
    const id = db.sqlLast(
      asUser(
        owner,
        `with opened as (` +
          `insert into public.nova_threads (project_id, user_id, title)` +
          ` values ('${ownerProject}', '${owner}', 'A new chat') returning id` +
          `) select id from opened;`,
      ),
    );

    // Born open, born unread, and with no last message it never had — every
    // one of those from a column default, because the grant covers no other.
    expect(
      db.sql(
        `select status || '/' || last_read_sequence || '/' ||` +
          ` coalesce(last_message_at::text, 'never')` +
          ` from public.nova_threads where id = '${id}';`,
      ),
    ).toBe("open/0/never");
  });

  it("refuses one in a project they do not own", () => {
    expect(
      db.sqlExpectingError(
        asUser(
          owner,
          `insert into public.nova_threads (project_id, user_id, title)` +
            ` values ('${strangerProject}', '${owner}', 'Reading theirs');`,
        ),
      ),
    ).toMatch(/row-level security|permission denied/);
  });

  it("refuses one owned by somebody else", () => {
    expect(
      db.sqlExpectingError(
        asUser(
          owner,
          `insert into public.nova_threads (project_id, user_id, title)` +
            ` values ('${ownerProject}', '${stranger}', 'Filed under them');`,
        ),
      ),
    ).toMatch(/row-level security|permission denied/);
  });

  /**
   * The columns that carry a thread's *state* are Vibe's. A founder supplies
   * the project, themselves and a title; `status`, the read marker and the
   * timestamps take their defaults, so a thread cannot be born archived, born
   * read, or born with a last message it never had.
   */
  it("may insert exactly three columns", () => {
    const granted = db.sql(
      `select string_agg(column_name, ',' order by column_name)` +
        ` from information_schema.column_privileges` +
        ` where grantee = 'authenticated' and table_name = 'nova_threads'` +
        ` and privilege_type = 'INSERT';`,
    );

    expect(granted).toBe("project_id,title,user_id");
  });

  it("refuses a thread that tries to be born archived", () => {
    expect(
      db.sqlExpectingError(
        asUser(
          owner,
          `insert into public.nova_threads (project_id, user_id, title, status)` +
            ` values ('${ownerProject}', '${owner}', 'Born away', 'archived');`,
        ),
      ),
    ).toContain("permission denied");
  });
});

describe("an archived thread is closed to writing", () => {
  it("refuses a turn", () => {
    expect(
      db.sqlExpectingError(asUser(owner, call(`'${archivedThread}', 'still there?', 'no'`))),
    ).toContain("thread_archived");

    expect(messageCount(archivedThread)).toBe(0);
  });

  it("opens again once the founder un-archives it", () => {
    db.sql(
      asUser(
        owner,
        `update public.nova_threads set status = 'open' where id = '${archivedThread}';`,
      ),
    );

    db.sqlLast(asUser(owner, call(`'${archivedThread}', 'and now?', 'Now I can answer.'`)));
    expect(messageCount(archivedThread)).toBe(2);

    db.sql(
      asUser(
        owner,
        `update public.nova_threads set status = 'archived' where id = '${archivedThread}';`,
      ),
    );
  });
});

describe("a reference is checked, and an unusable one takes the whole turn down", () => {
  it.each([
    ["an artifact kind that is not one of the eight", `'not_an_artifact', null, null`],
    ["an action id from somewhere else entirely", `null, null, 'DROP TABLE projects'`],
    ["an action id wearing the right shape but the wrong alphabet", `null, null, 'nova.MERGE'`],
  ])("refuses %s and writes nothing", (_name, tail) => {
    const before = messageCount(ownerThread);

    expect(
      db.sqlExpectingError(asUser(owner, call(`'${ownerThread}', 'point at it', 'here', ${tail}`))),
    ).toMatch(/violates check constraint/);

    // The whole function is one statement, so a refused pointer takes the
    // question and the reply with it rather than leaving half a turn.
    expect(messageCount(ownerThread)).toBe(before);
  });

  /**
   * A reference to another founder's object is *storable* — it is a string, and
   * the transcript does not join to the tables it points at. It is also
   * harmless, and this test is what says why: the address it resolves to is
   * gated by the route that reads it, so the founder who stored it sees what
   * they would have seen without it. The boundary is at the read, and it is the
   * same boundary every deep link has.
   */
  it("stores a reference without granting anything", () => {
    const foreignChange = "11111111-1111-1111-1111-111111111111";

    db.sqlLast(
      asUser(
        owner,
        call(
          `'${ownerThread}', 'show me their change', 'Here.',` +
            ` 'prepared_change', '${foreignChange}'`,
        ),
      ),
    );

    // Stored as text, joined to nothing, and reachable only through a route
    // that re-checks ownership. The transcript never became an access path.
    expect(
      db.sql(
        `select count(*) from information_schema.table_constraints` +
          ` where table_name = 'nova_messages' and constraint_type = 'FOREIGN KEY'` +
          ` and constraint_name like '%artifact%';`,
      ),
    ).toBe("0");
  });
});

describe("sequence and ordering", () => {
  /**
   * The read marker is a granted column, so a client can send any number. It
   * may only go forward: one that went backwards would re-announce turns the
   * founder has already read.
   */
  it("never lets the read marker retreat", () => {
    const thread = newThread(ownerProject, owner, "Marker");

    db.sql(
      asUser(
        owner,
        `update public.nova_threads set last_read_sequence = 7 where id = '${thread}';`,
      ),
    );
    db.sql(
      asUser(
        owner,
        `update public.nova_threads set last_read_sequence = 2 where id = '${thread}';`,
      ),
    );

    expect(
      db.sql(`select last_read_sequence from public.nova_threads where id = '${thread}';`),
    ).toBe("7");
  });

  it("keeps one sequence per thread, uniquely", () => {
    expect(
      db.sql(
        `select count(*) from pg_indexes where tablename = 'nova_messages'` +
          ` and indexdef like '%UNIQUE%(thread_id, sequence)%';`,
      ),
    ).toBe("1");
  });

  /**
   * The same question twice within seconds is a double press, not a founder
   * asking again. Refused under the thread lock, so two tabs racing it resolve
   * to one turn rather than two identical ones in the record.
   */
  it("refuses a replayed question", () => {
    const thread = newThread(ownerProject, owner, "Replay");

    db.sqlLast(asUser(owner, call(`'${thread}', 'what now?', 'This.'`)));
    expect(
      db.sqlExpectingError(asUser(owner, call(`'${thread}', 'what now?', 'This.'`))),
    ).toContain("turn_duplicate");

    expect(messageCount(thread)).toBe(2);
  });

  it("lets a different question through immediately", () => {
    const thread = newThread(ownerProject, owner, "Not a replay");

    db.sqlLast(asUser(owner, call(`'${thread}', 'first', 'one'`)));
    db.sqlLast(asUser(owner, call(`'${thread}', 'second', 'two'`)));

    expect(messageCount(thread)).toBe(4);
  });

  /**
   * Eight sessions, started together, against one thread.
   *
   * This is the test the row lock exists for, and it is the only one in this
   * file that could not be written with a single connection. What it pins is
   * not *how many* win — a duplicate refusal and a serialisation failure are
   * both legitimate answers — but that whatever lands is a whole, gapless,
   * collision-free transcript. Half a turn, two messages at sequence 3, or a
   * gap the read marker would skip past are each a defect, and each is exactly
   * what an unlocked `max(sequence) + 1` produces under load.
   */
  it("survives eight founders pressing send at once", async () => {
    const thread = newThread(ownerProject, owner, "All at once");

    const results = await db.sqlParallel(
      Array.from({ length: 8 }, (_unused, index) =>
        asUser(owner, call(`'${thread}', 'question ${index}', 'answer ${index}'`)),
      ),
    );

    const landed = results.filter((result) => result.ok).length;
    expect(landed).toBeGreaterThan(0);

    const rows = db.sql(
      `select string_agg(sequence::text, ',' order by sequence) from public.nova_messages` +
        ` where thread_id = '${thread}';`,
    );

    // Gapless from 1, two rows per landed turn, and no sequence twice.
    expect(rows).toBe(Array.from({ length: landed * 2 }, (_u, i) => i + 1).join(","));

    expect(
      db.sql(
        `select count(*) from (select sequence from public.nova_messages` +
          ` where thread_id = '${thread}' group by sequence having count(*) > 1) duplicated;`,
      ),
    ).toBe("0");

    // Every landed turn is whole: one founder message and one of Nova's.
    const authors = db.sql(
      `select author || '=' || count(*) from public.nova_messages` +
        ` where thread_id = '${thread}' group by author order by author;`,
    );
    expect(authors.split("\n")).toEqual([`founder=${landed}`, `nova=${landed}`]);
  }, 120_000);
});

/**
 * The line ADR 0109 §6 draws, checked rather than asserted: deleting a
 * transcript must change no fact about the business.
 */
describe("the transcript decides nothing", () => {
  it("writes no table but the two a transcript is made of", () => {
    const body = db.sql(
      `select prosrc from pg_proc where proname = 'append_nova_conversation_turn';`,
    );

    const written = [...body.matchAll(/(?:insert into|update)\s+public\.(\w+)/g)].map(
      (match) => match[1],
    );

    expect(new Set(written)).toEqual(new Set(["nova_messages", "nova_threads"]));
  });

  it("carries no trigger that could reach a canonical table", () => {
    expect(
      db.sql(
        `select coalesce(string_agg(tgname, ','), 'none') from pg_trigger` +
          ` where tgrelid in ('public.nova_messages'::regclass)` +
          ` and not tgisinternal;`,
      ),
    ).toBe("none");
  });

  it("leaves the business exactly as it was when a thread is deleted", () => {
    const thread = newThread(ownerProject, owner, "About to go");
    db.sqlLast(asUser(owner, call(`'${thread}', 'does this matter?', 'Not to your business.'`)));

    const before = db.sql(
      `select (select count(*) from public.projects)::text || '/' ||` +
        ` (select count(*) from public.operation_runs)::text || '/' ||` +
        ` (select coalesce(max(name), '-') from public.projects where id = '${ownerProject}');`,
    );

    db.sql(`delete from public.nova_threads where id = '${thread}';`);

    const after = db.sql(
      `select (select count(*) from public.projects)::text || '/' ||` +
        ` (select count(*) from public.operation_runs)::text || '/' ||` +
        ` (select coalesce(max(name), '-') from public.projects where id = '${ownerProject}');`,
    );

    expect(after).toBe(before);
    // And the turns go with it rather than being orphaned.
    expect(messageCount(thread)).toBe(0);
  });

  /**
   * A founder may not delete a thread through their own session either — the
   * table grants them `select`, `insert` and two updatable columns. Deletion is
   * an account or project erasure, which cascades.
   */
  it("gives a founder no delete grant on a thread", () => {
    /*
     * Table-level, which is `select` and nothing else. The insert and the
     * update are both *column*-level and are asserted where they are granted —
     * that asymmetry is the point rather than an accident: a whole-table grant
     * would have let a founder set their own `last_message_at`, and a founder
     * who could delete a thread row could remove a turn from a record they are
     * elsewhere shown as complete.
     */
    const granted = db.sql(
      `select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'none')` +
        ` from information_schema.role_table_grants` +
        ` where grantee = 'authenticated' and table_name = 'nova_threads';`,
    );

    expect(granted).toBe("SELECT");

    const updatable = db.sql(
      `select string_agg(column_name, ',' order by column_name)` +
        ` from information_schema.column_privileges` +
        ` where grantee = 'authenticated' and table_name = 'nova_threads'` +
        ` and privilege_type = 'UPDATE';`,
    );

    expect(updatable).toBe("last_read_sequence,status");
  });
});

/**
 * What a founder can *read*. RLS is defence in depth under every one of the
 * reads the application makes with a session-scoped client.
 */
describe("reading stops at the project line", () => {
  it("shows a founder their own threads and none of anybody else's", () => {
    expect(db.sqlLast(asUser(owner, `select count(*) from public.nova_threads;`))).toBe(
      db.sql(`select count(*) from public.nova_threads where project_id = '${ownerProject}';`),
    );
  });

  it("shows a founder none of another project's messages", () => {
    db.sqlLast(asUser(stranger, call(`'${strangerThread}', 'mine', 'yours'`)));

    expect(
      db.sqlLast(
        asUser(
          owner,
          `select count(*) from public.nova_messages where thread_id = '${strangerThread}';`,
        ),
      ),
    ).toBe("0");
  });

  it("shows anon nothing at all", () => {
    expect(
      db.sqlExpectingError(
        `begin; set local role anon; select * from public.nova_threads; commit;`,
      ),
    ).toContain("permission denied");

    expect(
      db.sqlExpectingError(
        `begin; set local role anon; select * from public.nova_messages; commit;`,
      ),
    ).toContain("permission denied");
  });
});
