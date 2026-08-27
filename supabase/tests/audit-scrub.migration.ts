import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-002 M3 — the audit-log scrub (ADR 0056 §8).
 *
 * §8 requires this to be tested "against a fixture covering every event
 * category in the vocabulary, not a sample", for the reason it gives: the
 * operation is irreversible, so a gap is not a bug that can be fixed
 * afterwards. {@link CATEGORIES} is therefore not invented — it is the set of
 * `recordAuditEvent` call sites in the repository, grouped by the prefix of
 * their event type, with the §8-sensitive keys each one actually writes.
 *
 * The other half of the risk is nesting. None of the three path fields §8 names
 * is a top-level metadata key; they sit inside richer evidence objects whose
 * shapes differ per event and will change again. {@link NESTING} covers that
 * directly, because a transform that is correct only for today's shapes is a
 * transform that fails silently on an operation nobody can re-run.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Removed outright. */
const DELETED = [
  "githubLogin",
  "accountLogin",
  "githubRepositoryId",
  "externalReference",
  "message",
  "stage",
  "monetizationModel",
  "primaryGoal",
  "projectId",
  "project_id",
] as const;

/** Kept as a key with a null value, so "withheld" still reads differently from "absent". */
const NULLED = [
  "sourceOrigin",
  "newOrigin",
  "previousOrigin",
  "beforeOrigin",
  "public_origin",
  "beforeObjectPath",
  "afterObjectPath",
] as const;

/**
 * Every `recordAuditEvent` category in the repository, and the §8-sensitive
 * keys it writes. Twenty-nine categories; between them they cover all
 * seventeen deleted-or-nulled keys.
 */
const CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  action_plan: ["projectId"],
  agent_execution: ["projectId"],
  billing: ["externalReference", "projectId"],
  business_audit: ["projectId"],
  business_measurement: ["project_id"],
  change_approval: ["project_id"],
  change_merge: ["project_id"],
  change_outcome: ["project_id", "public_origin"],
  change_preparation: ["projectId"],
  change_preview: ["projectId"],
  change_review: ["afterObjectPath", "beforeObjectPath", "beforeOrigin", "projectId"],
  change_validation: ["projectId"],
  credit_account: [],
  credit_charge: ["projectId"],
  credit_drift: ["message"],
  credit_grant: [],
  credit_refund: [],
  credit_reservation: ["projectId"],
  deep_scan: ["projectId"],
  execution: ["projectId"],
  founder_intent: ["monetizationModel", "primaryGoal", "projectId", "stage"],
  github: ["accountLogin", "githubLogin"],
  live_product: ["projectId", "sourceOrigin"],
  onboarding: ["projectId"],
  operation: ["projectId"],
  opportunities: ["projectId"],
  product_understanding: ["projectId"],
  project: ["newOrigin", "previousOrigin", "projectId"],
  repository: ["githubRepositoryId", "projectId"],
};

/** A value distinctive enough that finding it anywhere in the output is proof. */
const SECRET = "SENSITIVE-VALUE-MUST-NOT-SURVIVE";

/** Retained under every category, per §8's "retained untouched" list. */
const RETAINED = {
  commitSha: "a".repeat(40),
  credits: 250,
  policyVersion: "v3",
  failureCode: "merge_repository_changed",
  durationMs: 1234,
  intentHash: "b".repeat(64),
};

let db: Cluster;

function scrub(metadata: unknown): Record<string, unknown> {
  const literal = JSON.stringify(metadata).replaceAll("'", "''");
  return JSON.parse(db.sql(`select public.scrub_audit_metadata('${literal}'::jsonb);`));
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
}, 300_000);

afterAll(() => db?.stop());

describe("every event category in the vocabulary (§8)", () => {
  for (const [category, sensitiveKeys] of Object.entries(CATEGORIES)) {
    it(`${category}: withholds what it must and keeps what it must`, () => {
      const payload: Record<string, unknown> = { ...RETAINED };
      for (const key of sensitiveKeys) payload[key] = SECRET;

      const scrubbed = scrub(payload);

      expect(JSON.stringify(scrubbed)).not.toContain(SECRET);
      for (const key of sensitiveKeys) {
        if ((DELETED as readonly string[]).includes(key)) expect(key in scrubbed).toBe(false);
        else expect(scrubbed[key]).toBeNull();
      }
      // Nothing outside the §8 lists is touched — a scrub that quietly widened
      // would destroy the evidence the row is retained for.
      expect(scrubbed).toMatchObject(RETAINED);
    });
  }
});

describe("the two verbs are distinguishable", () => {
  it("deletes the deleted keys and nulls the nulled ones", () => {
    const payload = Object.fromEntries(
      [...DELETED, ...NULLED].map((key) => [key, SECRET] as const),
    );

    const scrubbed = scrub(payload);

    for (const key of DELETED) expect(key in scrubbed).toBe(false);
    for (const key of NULLED) {
      expect(key in scrubbed).toBe(true);
      expect(scrubbed[key]).toBeNull();
    }
  });
});

describe("nesting", () => {
  const NESTING = [
    { name: "top level", build: () => ({ githubLogin: SECRET }) },
    { name: "one object down", build: () => ({ detail: { githubLogin: SECRET } }) },
    { name: "inside an array of objects", build: () => ({ items: [{ accountLogin: SECRET }] }) },
    {
      name: "array inside an object inside an array",
      build: () => ({ runs: [{ evidence: { violations: [{ message: SECRET }] } }] }),
    },
  ] as const;

  for (const { name, build } of NESTING) {
    it(`reaches a sensitive key ${name}`, () => {
      expect(JSON.stringify(scrub(build()))).not.toContain(SECRET);
    });
  }

  it("keeps the surrounding structure rather than flattening it", () => {
    const scrubbed = scrub({ runs: [{ evidence: { violations: [{ message: SECRET, bytes: 12 }] } }] });

    expect(scrubbed).toEqual({ runs: [{ evidence: { violations: [{ bytes: 12 }] } }] });
  });
});

describe("path pseudonymization (§8)", () => {
  it("replaces a path with its position and keeps every sibling fact", () => {
    const scrubbed = scrub({
      changedPaths: [
        { path: "src/app/secret-project/page.tsx", status: "modified", bytes: 120 },
        { path: "src/modules/billing/ledger.ts", status: "added", bytes: 4096 },
      ],
    });

    expect(scrubbed).toEqual({
      changedPaths: [
        { path: "path-1", status: "modified", bytes: 120 },
        { path: "path-2", status: "added", bytes: 4096 },
      ],
    });
  });

  it("labels each of the three path-bearing fields §8 names", () => {
    const scrubbed = scrub({
      largestChanges: [{ path: "a/b.ts", bytes: 9 }],
      violations: [{ kind: "forbidden_path", path: "c/d.ts" }],
      changedPaths: [{ path: "e/f.ts" }],
    });

    expect(JSON.stringify(scrubbed)).not.toContain(".ts");
    expect(scrubbed).toEqual({
      largestChanges: [{ path: "path-1", bytes: 9 }],
      violations: [{ kind: "forbidden_path", path: "path-1" }],
      changedPaths: [{ path: "path-1" }],
    });
  });

  it("withholds a path that is not inside an array at all", () => {
    // The positional label is a convenience for arrays; the withholding is the
    // guarantee, and it must not depend on the shape the path happens to sit in.
    expect(scrub({ file: { path: "src/private/thing.ts" } })).toEqual({
      file: { path: "path-1" },
    });
  });
});

describe("the privileged driver", () => {
  function seedEvent(userId: string, metadata: string): void {
    db.sql(
      `insert into public.audit_events (user_id, event_type, metadata)` +
        ` values ('${userId}', 'github.installation.connected', '${metadata}'::jsonb);`,
    );
  }

  it("scrubs one identity's rows and leaves everybody else's alone", () => {
    const mine = db.sql(
      `with i as (insert into auth.users (email) values ('scrub-a@fixture.test') returning id)` +
        ` select id from i;`,
    );
    const theirs = db.sql(
      `with i as (insert into auth.users (email) values ('scrub-b@fixture.test') returning id)` +
        ` select id from i;`,
    );

    seedEvent(mine, `{"githubLogin": "${SECRET}", "credits": 5}`);
    seedEvent(theirs, `{"githubLogin": "${SECRET}", "credits": 5}`);

    const affected = db.sql(`select public.erase_account_audit_metadata('${mine}');`);
    expect(affected).toBe("1");

    expect(db.sql(`select metadata::text from public.audit_events where user_id = '${mine}';`)).toBe(
      '{"credits": 5}',
    );
    expect(
      db.sql(`select metadata ? 'githubLogin' from public.audit_events where user_id = '${theirs}';`),
    ).toBe("t");
  });

  it("refuses a null identity rather than scrubbing everything", () => {
    // The failure mode this exists for: a caller whose owner lookup returned
    // nothing, invoking the scrub anyway. `where user_id = null` matches no
    // rows, so this would be harmless — but "harmless because the WHERE clause
    // happened to be empty" is not a property worth relying on.
    const error = db.sqlExpectingError(`select public.erase_account_audit_metadata(null);`);
    expect(error).toContain("requires a user id");
  });

  it("is not reachable by anon or authenticated", () => {
    for (const role of ["anon", "authenticated"]) {
      const error = db.sqlExpectingError(
        `begin; set local role ${role};` +
          ` select public.erase_account_audit_metadata('00000000-0000-0000-0000-000000000000');` +
          ` commit;`,
      );
      expect(error).toContain("permission denied");
    }
  });
});
