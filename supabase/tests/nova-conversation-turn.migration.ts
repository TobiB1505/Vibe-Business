import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The one write a conversation makes, and everything it refuses.
 *
 * ## Why this needs a real PostgreSQL
 *
 * Because the function is the boundary. `nova_messages`' insert policy pins an
 * authenticated caller to `author = 'founder'` on purpose — a browser that
 * could write `author = 'nova'` could put words in her mouth in the founder's
 * own history — and the restructure audit's §C.8 forecloses the service-role
 * client for this layer by name. What is left is a `security definer` function,
 * and the whole of its safety is that it re-checks ownership inside itself.
 * Nothing but a real database evaluates that.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let owner: string;
let stranger: string;
let projectId: string;
let threadId: string;

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

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  owner = db.sql(
    `with i as (insert into auth.users (email) values ('owner@fixture.test') returning id) select id from i;`,
  );
  stranger = db.sql(
    `with i as (insert into auth.users (email) values ('stranger@fixture.test') returning id) select id from i;`,
  );
  projectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${owner}', 'talk') returning id) select id from i;`,
  );
  threadId = db.sql(
    `with i as (insert into public.nova_threads (project_id, user_id, title)` +
      ` values ('${projectId}', '${owner}', 'Your product') returning id) select id from i;`,
  );
}, 300_000);

afterAll(() => db?.stop());

describe("one turn, written once", () => {
  it("writes the question and the reply together, in order", () => {
    db.sqlLast(
      asUser(
        owner,
        call(`'${threadId}', 'why is conversion the blocker?', 'Your pricing is not stated.'`),
      ),
    );

    const rows = db.sql(
      `select author || ':' || kind from public.nova_messages` +
        ` where thread_id = '${threadId}' order by sequence;`,
    );

    expect(rows.split("\n")).toEqual(["founder:text", "nova:text"]);
  });

  it("writes a pointer and a proposal as their own turns", () => {
    const other = db.sql(
      `with i as (insert into public.nova_threads (project_id, user_id, title)` +
        ` values ('${projectId}', '${owner}', 'Second') returning id) select id from i;`,
    );

    db.sqlLast(
      asUser(
        owner,
        call(
          `'${other}', 'what should I do?', 'The audit is out of date.',` +
            ` 'business_health', null, 'nova.refresh_audit'`,
        ),
      ),
    );

    const rows = db.sql(
      `select author || ':' || kind from public.nova_messages` +
        ` where thread_id = '${other}' order by sequence;`,
    );

    expect(rows.split("\n")).toEqual([
      "founder:text",
      "nova:text",
      "nova:artifact",
      "nova:action_proposal",
    ]);
  });

  it("keeps the sequence going across turns", () => {
    const before = Number(
      db.sql(`select count(*) from public.nova_messages where thread_id = '${threadId}';`),
    );

    db.sqlLast(asUser(owner, call(`'${threadId}', 'and the second one?', 'That one is smaller.'`)));

    const sequences = db.sql(
      `select string_agg(sequence::text, ',' order by sequence) from public.nova_messages` +
        ` where thread_id = '${threadId}';`,
    );

    expect(sequences).toBe(Array.from({ length: before + 2 }, (_, index) => index + 1).join(","));
  });

  it("moves the thread's last message time", () => {
    expect(
      db.sql(
        `select last_message_at is not null from public.nova_threads where id = '${threadId}';`,
      ),
    ).toBe("t");
  });
});

describe("what it refuses", () => {
  /**
   * The one that matters. Ownership is re-checked inside the function against
   * `auth.uid()` through the project row, never trusted from the thread id an
   * argument carried — which is rule 53's rule about the service-role client,
   * asked one layer down of a definer function that has the same reach.
   */
  it("refuses a thread the caller does not own", () => {
    expect(
      db.sqlExpectingError(asUser(stranger, call(`'${threadId}', 'let me in', 'no'`))),
    ).toContain("thread_not_found");
  });

  it("refuses a thread that does not exist", () => {
    expect(
      db.sqlExpectingError(
        asUser(owner, call(`'00000000-0000-0000-0000-000000000000', 'hello', 'hi'`)),
      ),
    ).toContain("thread_not_found");
  });

  /**
   * A question with no answer reads as an answer that never came; an answer
   * with no question reads as Nova volunteering something. They are one write,
   * and half of one is worse than neither.
   */
  it.each([
    ["an empty question", "'   ', 'a reply'"],
    ["an empty reply", "'a question', '   '"],
  ])("refuses %s", (_name, args) => {
    expect(db.sqlExpectingError(asUser(owner, call(`'${threadId}', ${args}`)))).toContain(
      "turn_incomplete",
    );
  });

  it("is not executable by an anonymous caller", () => {
    expect(
      db.sqlExpectingError(
        `begin; set local role anon;` +
          ` select public.append_nova_conversation_turn('${threadId}', 'a', 'b'); commit;`,
      ),
    ).toMatch(/permission denied|not_authenticated/);
  });
});

describe("what it can never write", () => {
  /**
   * The transcript is memory and the domain is truth (ADR 0109 §6). A function
   * that could write a canonical table is the mechanism by which a conversation
   * would eventually decide something — so it writes two tables and no others,
   * and that is asserted against the function's own body rather than hoped for.
   */
  it("names no table but the two a transcript is made of", () => {
    const body = db.sql(
      `select prosrc from pg_proc where proname = 'append_nova_conversation_turn';`,
    );

    const written = [...body.matchAll(/(?:insert into|update)\s+public\.(\w+)/g)].map(
      (match) => match[1],
    );

    expect(new Set(written)).toEqual(new Set(["nova_messages", "nova_threads"]));
  });
});
