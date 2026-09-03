import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The claim that makes Nova's voice attempted once (ADR 0084).
 *
 * ## Why this needs a real PostgreSQL
 *
 * Because the thing being relied on is not TypeScript. The store's whole
 * concurrency argument is "`insert … on conflict (identity) do nothing …
 * returning` returns a row to exactly one caller" — and a double can be made
 * to behave that way whether or not the database does. So the primary key, the
 * returning shape, and every CHECK that keeps a resolution interpretable are
 * asserted here, against the migrations as they will actually deploy.
 *
 * ## What this cannot cover
 *
 * Genuine simultaneity. `harness.sql` runs psql to completion per call, so two
 * overlapping transactions are not expressible here. What *is* expressible is
 * the mechanism the store depends on: that a second insert of the same
 * identity conflicts rather than duplicating, and that `do nothing … returning`
 * hands the loser an empty result rather than the winner's row. Serializing
 * two simultaneous inserts against a unique index is then Postgres's own
 * guarantee, not a claim this file is making on its behalf.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const IDENTITY = "a".repeat(64);
const OTHER_IDENTITY = "b".repeat(64);
const MESSAGE = "Pricing clarity is the thing holding the business back right now.";

let db: Cluster;
let userId: string;
let projectId: string;
let label = 0;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  userId = db.sql(
    `with i as (insert into auth.users (email) values ('voice@fixture.test') returning id) select id from i;`,
  );
  projectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${userId}', 'voice') returning id) select id from i;`,
  );
}, 300_000);

afterAll(() => db?.stop());

/** A claim row, exactly as `claimNovaVoiceGeneration` writes one. */
function claim(identity: string, columns: Record<string, string> = {}): string {
  const row: Record<string, string> = {
    identity: `'${identity}'`,
    project_id: `'${projectId}'`,
    slot: `'audit_result'`,
    locale: `'en'`,
    prompt_version: `'nova-voice-prompt-v4'`,
    policy_version: `'nova-voice-policy-v1'`,
    model: `'claude-sonnet-5'`,
    ...columns,
  };

  return (
    `insert into public.nova_voice_messages (${Object.keys(row).join(", ")})` +
    ` values (${Object.values(row).join(", ")})`
  );
}

/** A fresh identity per test, so each one starts from an unclaimed key. */
function freshIdentity(): string {
  label += 1;
  return label.toString(16).padStart(64, "c");
}

describe("one identity is claimed exactly once", () => {
  /**
   * Wrapped in a CTE so the only output is the answer: psql prints its own
   * `INSERT 0 1` status line otherwise, and a test that asserted on that would
   * be asserting on psql rather than on the claim.
   */
  function claimReturning(identity: string, onConflict = ""): string {
    return db.sql(
      `with claimed as (${claim(identity)} ${onConflict} returning identity)` +
        ` select coalesce((select identity from claimed), '<lost>');`,
    );
  }

  it("accepts the first claim", () => {
    const identity = freshIdentity();

    expect(claimReturning(identity)).toBe(identity);
  });

  /**
   * The primary key is the whole concurrency mechanism. Without it two callers
   * that both read "nothing stored" would both insert and both call the model,
   * which is the per-visit spend §M refuses.
   */
  it("refuses a second claim on the same identity", () => {
    const identity = freshIdentity();
    db.sql(`${claim(identity)};`);

    const error = db.sqlExpectingError(`${claim(identity)};`);

    expect(error).toContain("nova_voice_messages_pkey");
  });

  /**
   * What the store actually issues. The loser is told it lost by getting no
   * row back — not by a second read that could itself race the first.
   */
  it("returns nothing to the loser of a do-nothing insert", () => {
    const identity = freshIdentity();
    db.sql(`${claim(identity)};`);

    expect(claimReturning(identity, "on conflict (identity) do nothing")).toBe("<lost>");
    expect(
      db.sql(`select count(*) from public.nova_voice_messages where identity = '${identity}';`),
    ).toBe("1");
  });

  it("returns the row to the winner of a do-nothing insert", () => {
    const identity = freshIdentity();

    expect(claimReturning(identity, "on conflict (identity) do nothing")).toBe(identity);
  });

  it("lets a different identity through untouched", () => {
    const first = freshIdentity();
    const second = freshIdentity();
    db.sql(`${claim(first)};`);

    expect(claimReturning(second)).toBe(second);
  });

  it("refuses an identity that is not a sha256 digest", () => {
    const error = db.sqlExpectingError(`${claim("not-a-hash")};`);

    expect(error).toContain("nova_voice_messages_identity_check");
  });

  it("refuses a truncated digest", () => {
    const error = db.sqlExpectingError(`${claim("a".repeat(63))};`);

    expect(error).toContain("nova_voice_messages_identity_check");
  });
});

describe("the identity's inputs are closed vocabularies", () => {
  it("refuses a slot nobody declared", () => {
    const error = db.sqlExpectingError(`${claim(freshIdentity(), { slot: `'weekly_digest'` })};`);

    expect(error).toContain("nova_voice_messages_slot_check");
  });

  /**
   * One legal value today. The column exists so that a second locale is a new
   * identity rather than a founder served the cached English sentence, and the
   * CHECK is what makes shipping one without touching this file impossible.
   */
  it("refuses a locale nobody declared", () => {
    const error = db.sqlExpectingError(`${claim(freshIdentity(), { locale: `'de'` })};`);

    expect(error).toContain("nova_voice_messages_locale_check");
  });

  it("refuses an empty model, which is the shape a dropped value takes", () => {
    const error = db.sqlExpectingError(`${claim(freshIdentity(), { model: `''` })};`);

    expect(error).toContain("nova_voice_messages_model_check");
  });
});

describe("a resolution is whole, or it is absent", () => {
  function resolve(identity: string, columns: Record<string, string>): string {
    const sets = Object.entries(columns)
      .map(([column, value]) => `${column} = ${value}`)
      .join(", ");
    return `update public.nova_voice_messages set ${sets} where identity = '${identity}';`;
  }

  function claimed(): string {
    const identity = freshIdentity();
    db.sql(`${claim(identity)};`);
    return identity;
  }

  it("starts unresolved", () => {
    const identity = claimed();

    const row = db.sql(
      `select coalesce(source, '<null>') || '|' || coalesce(resolved_at::text, '<null>')
         from public.nova_voice_messages where identity = '${identity}';`,
    );

    expect(row).toBe("<null>|<null>");
  });

  it("accepts a voice resolution with its message", () => {
    const identity = claimed();

    db.sql(
      resolve(identity, {
        resolved_at: "now()",
        source: `'voice'`,
        message: `'${MESSAGE}'`,
      }),
    );

    expect(
      db.sql(`select message from public.nova_voice_messages where identity = '${identity}';`),
    ).toBe(MESSAGE);
  });

  it("accepts a template resolution with its reason", () => {
    const identity = claimed();

    db.sql(
      resolve(identity, {
        resolved_at: "now()",
        source: `'template'`,
        fallback_reason: `'provider_failed'`,
      }),
    );

    expect(
      db.sql(
        `select fallback_reason from public.nova_voice_messages where identity = '${identity}';`,
      ),
    ).toBe("provider_failed");
  });

  it("refuses a source with no timestamp", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), { source: `'template'`, fallback_reason: `'disabled'` }),
    );

    expect(error).toContain("nova_voice_messages_resolution_is_whole");
  });

  it("refuses a timestamp with no source", () => {
    const error = db.sqlExpectingError(resolve(claimed(), { resolved_at: "now()" }));

    expect(error).toContain("nova_voice_messages_resolution_is_whole");
  });

  /**
   * An accepted sentence with nothing in it would read as `voice` and render
   * as the template, which is a row that says one thing and does another.
   */
  it("refuses a voice resolution with no message", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), { resolved_at: "now()", source: `'voice'` }),
    );

    expect(error).toContain("nova_voice_messages_voice_carries_the_message");
  });

  it("refuses a voice resolution that also carries a fallback reason", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), {
        resolved_at: "now()",
        source: `'voice'`,
        message: `'${MESSAGE}'`,
        fallback_reason: `'provider_failed'`,
      }),
    );

    expect(error).toContain("nova_voice_messages_voice_carries_the_message");
  });

  /**
   * The constraint that keeps the template out of the database. Storing a copy
   * would freeze today's wording into a row that outlives it, and a reworded
   * template would leave the old sentence on screen with nothing to reveal it.
   */
  it("refuses a fallback that carries a message", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), {
        resolved_at: "now()",
        source: `'template'`,
        fallback_reason: `'disabled'`,
        message: `'${MESSAGE}'`,
      }),
    );

    expect(error).toContain("nova_voice_messages_fallback_carries_no_message");
  });

  it("refuses a fallback with no reason", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), { resolved_at: "now()", source: `'template'` }),
    );

    expect(error).toContain("nova_voice_messages_fallback_carries_no_message");
  });

  it("refuses a fallback reason nobody declared", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), {
        resolved_at: "now()",
        source: `'template'`,
        fallback_reason: `'model_was_rude'`,
      }),
    );

    expect(error).toContain("nova_voice_messages_fallback_reason_check");
  });

  it("refuses a message below the length a message starts at", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), { resolved_at: "now()", source: `'voice'`, message: `'ok'` }),
    );

    expect(error).toContain("nova_voice_messages_message_check");
  });

  it("refuses a message past the domain ceiling", () => {
    const error = db.sqlExpectingError(
      resolve(claimed(), {
        resolved_at: "now()",
        source: `'voice'`,
        message: `'${"a".repeat(701)}'`,
      }),
    );

    expect(error).toContain("nova_voice_messages_message_check");
  });
});

describe("who may touch a stored message", () => {
  function asOwner(statement: string): string {
    return (
      `begin;` +
      ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
      ` set local role authenticated;` +
      ` ${statement} commit;`
    );
  }

  beforeAll(() => {
    db.sql(
      `${claim(IDENTITY)};` +
        ` update public.nova_voice_messages` +
        ` set resolved_at = now(), source = 'voice', message = '${MESSAGE}'` +
        ` where identity = '${IDENTITY}';`,
    );
  });

  it("lets the owning founder read their own message", () => {
    const read = db.sqlLast(
      asOwner(`select message from public.nova_voice_messages where identity = '${IDENTITY}';`),
    );

    expect(read).toBe(MESSAGE);
  });

  it("shows a founder nothing of another project's message", () => {
    const otherUser = db.sql(
      `with i as (insert into auth.users (email) values ('other@fixture.test') returning id) select id from i;`,
    );
    const otherProject = db.sql(
      `with i as (insert into public.projects (user_id, name) values ('${otherUser}', 'other') returning id) select id from i;`,
    );
    db.sql(
      `insert into public.nova_voice_messages (identity, project_id, slot, locale, prompt_version, policy_version, model)` +
        ` values ('${OTHER_IDENTITY}', '${otherProject}', 'audit_result', 'en', 'p', 'q', 'm');`,
    );

    const count = db.sqlLast(
      asOwner(
        `select count(*) from public.nova_voice_messages where identity = '${OTHER_IDENTITY}';`,
      ),
    );

    expect(count).toBe("0");
  });

  /**
   * A render reads; nothing else. A founder who could write here could put
   * words in Nova's mouth, and a founder who could delete could remove the
   * record of an attempt that may have been billed.
   */
  it.each(["insert", "update", "delete"])("denies %s to authenticated", (privilege) => {
    const granted = db.sql(
      `select has_table_privilege('authenticated', 'public.nova_voice_messages', '${privilege}');`,
    );

    expect(granted).toBe("f");
  });

  it("denies everything to anon", () => {
    const granted = db.sql(
      `select has_table_privilege('anon', 'public.nova_voice_messages', 'select');`,
    );

    expect(granted).toBe("f");
  });

  /** An attempt is a record of a charge that may have happened. */
  it("denies delete even to the service role", () => {
    const granted = db.sql(
      `select has_table_privilege('service_role', 'public.nova_voice_messages', 'delete');`,
    );

    expect(granted).toBe("f");
  });

  it("has row level security enabled", () => {
    const enabled = db.sql(
      `select relrowsecurity from pg_class where oid = 'public.nova_voice_messages'::regclass;`,
    );

    expect(enabled).toBe("t");
  });
});
