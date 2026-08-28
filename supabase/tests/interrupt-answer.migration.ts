import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-049 — answering a question is not rewriting it.
 *
 * `answer own execution_interrupts` checked that the caller owns the project
 * and nothing else, and `authenticated` held table-level `UPDATE`. The policy's
 * own comment said which fields may change "is enforced in code" — true of the
 * store function, and silent about what a browser holding the publishable key
 * can send to PostgREST directly.
 *
 * Every assertion runs through the role and JWT subject PostgREST would use,
 * because the subject is exactly what a browser-scoped caller may write.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let label = 0;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

type Fixture = { userId: string; projectId: string; interruptId: string };

function makeInterrupt(): Fixture {
  label += 1;
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('interrupt${label}');`)
    .split("|");
  const interruptId = db.sql(
    `select id from public.execution_interrupts where project_id = '${projectId}' limit 1;`,
  );
  return { userId, projectId, interruptId };
}

/** Acts as PostgREST does: the role plus that user's JWT subject. */
function asUser(userId: string, statement: string): string {
  return (
    `begin;` +
    ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
    ` set local role authenticated;` +
    ` ${statement} commit;`
  );
}

function attempt(fixture: Fixture, set: string): { ok: boolean; error: string } {
  const statement = `update public.execution_interrupts set ${set} where id = '${fixture.interruptId}';`;
  const script = asUser(fixture.userId, statement);
  try {
    db.sql(script);
    return { ok: true, error: "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function statusOf(fixture: Fixture): string {
  return db.sql(
    `select status from public.execution_interrupts where id = '${fixture.interruptId}';`,
  );
}

describe("what the owner may write", () => {
  it("answers their own open question", () => {
    const fixture = makeInterrupt();

    const result = attempt(
      fixture,
      `status = 'answered', answer = '{"choice":"a"}'::jsonb, answered_at = now()`,
    );

    expect(result.error).toBe("");
    expect(result.ok).toBe(true);
    expect(statusOf(fixture)).toBe("answered");
  });
});

describe("what the owner may not write", () => {
  /**
   * The one that matters most. `response_schema` is the contract
   * `answerInterrupt` validates against — widen it and a previously invalid
   * answer becomes valid, and that answer is what an execution resumes on.
   */
  it("cannot rewrite the schema its answer will be validated against", () => {
    const fixture = makeInterrupt();

    const result = attempt(fixture, `response_schema = '{"anything":true}'::jsonb`);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission denied/i);
  });

  /**
   * The question is stored so a historical interrupt keeps meaning what the
   * customer read. A customer who can edit it can edit what they were asked.
   */
  it("cannot rewrite the question Vibe asked", () => {
    const fixture = makeInterrupt();

    const result = attempt(fixture, `question = 'Something else entirely'`);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission denied/i);
  });

  it("cannot change what kind of interrupt it is", () => {
    const fixture = makeInterrupt();

    const result = attempt(fixture, `interrupt_type = 'scope_expansion_required'`);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission denied/i);
  });

  /**
   * `cancelled` and `expired` are Vibe's conclusions about its own run, written
   * from durable execution. A customer reaching for one is forging that
   * conclusion to unstick a run.
   */
  it.each(["cancelled", "expired", "open"])("cannot move the status to %s", (status) => {
    const fixture = makeInterrupt();

    const result = attempt(fixture, `status = '${status}'`);

    expect(result.ok).toBe(false);
    expect(statusOf(fixture)).toBe("open");
  });

  /**
   * The store function already filtered on `status = 'open'`; now the database
   * does, so an answer cannot be revised after the execution consumed it.
   */
  it("cannot revise an answer once it has been given", () => {
    const fixture = makeInterrupt();
    attempt(fixture, `status = 'answered', answer = '{"choice":"a"}'::jsonb, answered_at = now()`);

    const second = attempt(
      fixture,
      `status = 'answered', answer = '{"choice":"b"}'::jsonb, answered_at = now()`,
    );

    expect(second.ok).toBe(true); // zero rows matched — no error, and no change
    expect(db.sql(
      `select answer->>'choice' from public.execution_interrupts where id = '${fixture.interruptId}';`,
    )).toBe("a");
  });
});

describe("another account", () => {
  it("cannot answer a question it does not own", () => {
    const mine = makeInterrupt();
    const theirs = makeInterrupt();

    const statement =
      `update public.execution_interrupts set status = 'answered',` +
      ` answer = '{"choice":"a"}'::jsonb, answered_at = now()` +
      ` where id = '${theirs.interruptId}';`;
    db.sql(asUser(mine.userId, statement));

    expect(statusOf(theirs)).toBe("open");
  });
});

describe("the trigger behind it", () => {
  /**
   * `set_updated_at` is SECURITY INVOKER, so an unpinned `search_path` is far
   * less dangerous here than on a definer function. It is pinned anyway,
   * because "this one is not exploitable" is an argument that has to be
   * re-made every time somebody edits the body.
   */
  it("pins its search_path", () => {
    const config = db.sql(`
      select coalesce(array_to_string(p.proconfig, ','), '<none>')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_updated_at';
    `);

    expect(config).toBe('search_path=""');
  });

  it("still stamps updated_at", () => {
    const fixture = makeInterrupt();
    const before = db.sql(
      `select updated_at from public.execution_interrupts where id = '${fixture.interruptId}';`,
    );

    attempt(fixture, `status = 'answered', answer = '{}'::jsonb, answered_at = now()`);

    const after = db.sql(
      `select updated_at from public.execution_interrupts where id = '${fixture.interruptId}';`,
    );
    expect(after).not.toBe(before);
  });
});
