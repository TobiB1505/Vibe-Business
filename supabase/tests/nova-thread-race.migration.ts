import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Opening a thread, from several sessions at once.
 *
 * ## Why this cannot be a unit test
 *
 * Because there is nothing to test until two callers are inside the window at
 * the same moment. `ensureOpenThread` was a read and then an insert, two
 * PostgREST requests with no transaction between them — so two tabs asking a
 * first question together both read *no open thread* and both inserted, and the
 * founder's conversation was **split across two threads**, each looking
 * complete. `FakeDatabase` runs in one JavaScript turn and cannot produce that
 * interleaving; a double that claimed to would be asserting the property while
 * proving nothing about it.
 *
 * `open_nova_thread` decides under a transaction-scoped advisory lock keyed on
 * the project, and this is the only place that claim is worth anything: real
 * sessions, started together, against one project.
 *
 * ## What is asserted, and what deliberately is not
 *
 * **Exactly one row**, and every caller holding the same id. Not *which* caller
 * wrote it — that is a race and a race has no right answer — and not the lock's
 * mechanism, which is an implementation detail the row count is the evidence
 * for.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let owner: string;
let stranger: string;
let projectId: string;

function asUser(userId: string, statement: string): string {
  return (
    `begin;` +
    ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
    ` set local role authenticated;` +
    ` ${statement} commit;`
  );
}

/**
 * The call, tagged so its answer can be picked out of the session's noise.
 *
 * `asUser` runs `set_config('request.jwt.claim.sub', …)`, and **`set_config`
 * returns the value it set** — so a session that opens no thread still prints a
 * uuid, and a reader taking the last line gets the founder's own id back and
 * reads it as a thread. Two of these tests asserted that before the tag existed.
 */
function open(projectRef: string, title: string, onlyIfEmpty = false): string {
  return (
    `select 'thread=' || id from public.open_nova_thread(` +
    `'${projectRef}'::uuid, '${title}', ${onlyIfEmpty ? "true" : "false"});`
  );
}

/** Every thread id a session actually returned, and nothing else it printed. */
function openedIds(output: string): string[] {
  return [...output.matchAll(/^thread=([0-9a-f-]{36})$/gm)].map((match) => match[1]);
}

function threadCount(): number {
  return Number(
    db.sql(`select count(*) from public.nova_threads where project_id = '${projectId}';`),
  );
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);

  owner = db.sql(
    `with i as (insert into auth.users (email) values ('owner@race.test') returning id) select id from i;`,
  );
  stranger = db.sql(
    `with i as (insert into auth.users (email) values ('stranger@race.test') returning id) select id from i;`,
  );
  projectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${owner}', 'race') returning id) select id from i;`,
  );
}, 300_000);

afterAll(() => db?.stop());

describe("the first thread, opened once", () => {
  /**
   * The race the function exists for. Eight sessions, started together, against
   * a project with no thread at all — which is the state every project is in
   * before its first run finishes or its founder asks anything.
   */
  it("survives eight sessions opening it at the same moment", async () => {
    const results = await db.sqlParallel(
      Array.from({ length: 8 }, () => asUser(owner, open(projectId, "Your product"))),
    );

    const failed = results.filter((result) => !result.ok);
    expect(
      failed.map((result) => result.err.trim()),
      "every caller should get a thread",
    ).toEqual([]);

    expect(threadCount(), "eight callers, one conversation").toBe(1);

    // And every one of them holds the same thread, rather than eight ids of
    // which seven point at rows that were rolled back.
    const ids = new Set(results.flatMap((result) => openedIds(result.out)));
    expect(ids.size, "eight callers, one id between them").toBe(1);

    const stored = db.sql(`select id from public.nova_threads where project_id = '${projectId}';`);
    expect([...ids][0]).toBe(stored);
  }, 120_000);

  /**
   * And once one exists, concurrent callers all find it rather than racing to
   * add a second — the lock is not only about the empty case, it is about every
   * caller that has to decide.
   */
  it("adds nothing when one is already open", async () => {
    const before = threadCount();
    expect(before).toBe(1);

    const results = await db.sqlParallel(
      Array.from({ length: 6 }, () => asUser(owner, open(projectId, "Your product"))),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(threadCount()).toBe(1);
  }, 120_000);
});

describe("New chat, pressed more than once", () => {
  /**
   * *New chat* reuses an open thread only when nothing has been said in it, so
   * six simultaneous presses against an empty conversation are six requests for
   * the same thing and must resolve to one.
   */
  it("resolves six simultaneous presses to one empty conversation", async () => {
    expect(threadCount()).toBe(1);

    const results = await db.sqlParallel(
      Array.from({ length: 6 }, () => asUser(owner, open(projectId, "New chat", true))),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(threadCount(), "an empty conversation is already somewhere to start").toBe(1);
  }, 120_000);

  /**
   * And opens a second the moment the first has anything in it, which is what
   * the button is actually for. Serialised the same way: six presses against a
   * used conversation produce one new thread, not six.
   */
  it("opens exactly one more once something has been said", async () => {
    const current = db.sql(
      `select id from public.nova_threads where project_id = '${projectId}' order by created_at desc limit 1;`,
    );

    db.sqlLast(
      asUser(
        owner,
        `select public.append_nova_conversation_turn('${current}', 'what now?', 'This.');`,
      ),
    );

    const results = await db.sqlParallel(
      Array.from({ length: 6 }, () => asUser(owner, open(projectId, "New chat", true))),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(threadCount(), "one more conversation, not six").toBe(2);
  }, 120_000);
});

describe("what the lock does not do", () => {
  /**
   * It orders callers; it does not authorise them. The function is
   * `security invoker` precisely so that it carries no authority of its own —
   * a stranger sees no project to insert against and no thread to reuse,
   * whether or not anybody else is asking at the same moment.
   *
   * **Silence rather than an exception**, and that is the right answer rather
   * than a weaker one: the insert selects from `projects`, which RLS scopes to
   * the caller, so a project that is not yours and one that does not exist are
   * indistinguishable from outside. That is the answer `requireProjectAccess`
   * gives one layer up, and the reason it gives it.
   */
  it("gives a stranger nothing, and writes nothing", () => {
    const before = threadCount();

    const output = db.sql(asUser(stranger, open(projectId, "Reading theirs")));

    expect(openedIds(output), "no thread for a project that is not theirs").toEqual([]);
    expect(threadCount()).toBe(before);
  });

  it("opens nothing for a project that does not exist", () => {
    const before = threadCount();

    const output = db.sql(asUser(owner, open("00000000-0000-0000-0000-000000000000", "Nowhere")));

    // No row, rather than a thread nobody could reach — and the same answer the
    // stranger gets, which is what makes the two indistinguishable.
    expect(openedIds(output)).toEqual([]);
    expect(threadCount()).toBe(before);
  });

  /**
   * `security invoker`, and asserted rather than assumed: a definer function
   * here would be a new definer surface for a problem that is about ordering
   * rather than about permission, and it would show up in the security
   * advisor beside the one function that has argued for it.
   */
  it("is not a security definer function", () => {
    expect(db.sql(`select prosecdef from pg_proc where proname = 'open_nova_thread';`)).toBe("f");
    expect(db.sql(`select proconfig::text from pg_proc where proname = 'open_nova_thread';`)).toBe(
      '{"search_path=\\"\\""}',
    );
  });

  it("is callable by a founder and by the service role, and by nobody else", () => {
    const signature = "public.open_nova_thread(uuid,text,boolean)";
    expect(
      db.sql(`select has_function_privilege('authenticated', '${signature}', 'execute');`),
    ).toBe("t");
    expect(
      db.sql(`select has_function_privilege('service_role', '${signature}', 'execute');`),
    ).toBe("t");
    expect(db.sql(`select has_function_privilege('anon', '${signature}', 'execute');`)).toBe("f");
  });
});
