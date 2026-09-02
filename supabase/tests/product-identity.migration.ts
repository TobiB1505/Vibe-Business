import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The two identity columns, and the backfill that fills them for rows written
 * before they existed.
 *
 * ## Why this needs a real PostgreSQL
 *
 * Because the thing at risk is not TypeScript. `identity-columns.test.ts`
 * proves the write path and compares its *text* with the migration's; what no
 * text comparison can prove is that the migration's `jsonb_array_elements`
 * ordering actually prefers the primary logo, that a JSON `null` displayUrl
 * becomes SQL NULL rather than the string "null", and that the two CHECK
 * constraints reject what they claim to.
 *
 * The migration applies to an empty table here — every cluster starts fresh —
 * so the backfill statement is read back out of the shipped file and run again
 * over rows inserted to look pre-migration. That keeps this a test of the SQL
 * that ships rather than of a copy of it that could drift.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATION = join(
  REPO_ROOT,
  "supabase/migrations/20260902220007_product_identity_columns.sql",
);

/** The shipped backfill, taken from the file rather than restated. */
function backfillStatement(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("update public.product_profiles p");
  expect(start, "the migration still contains its backfill").toBeGreaterThan(-1);
  return sql.slice(start);
}

let db: Cluster;
let userId: string;
let label = 0;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  userId = db.sql(
    `with i as (insert into auth.users (email) values ('identity@fixture.test') returning id) select id from i;`,
  );
}, 300_000);

afterAll(() => db?.stop());

/** A completed profile carrying `result`, with both columns left unwritten. */
function legacyProfile(result: unknown): string {
  label += 1;
  const projectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${userId}', 'p${label}')` +
      ` returning id) select id from i;`,
  );
  return db.sql(
    `with i as (insert into public.product_profiles
       (project_id, schema_version, builder_version, evidence_version, input_hash, status, result)
       values ('${projectId}', 'v1', 'v1', 'v1', repeat('a', 64), 'completed',
               $json$${JSON.stringify(result)}$json$::jsonb)
       returning id) select id from i;`,
  );
}

function columnsOf(profileId: string): { name: string; logo: string } {
  const row = db.sql(
    `select coalesce(product_name, '<null>') || '|' || coalesce(product_logo_url, '<null>')
     from public.product_profiles where id = '${profileId}';`,
  );
  const [name, logo] = row.split("|");
  return { name, logo };
}

function asset(role: string, displayUrl: string | null) {
  return { role, reference: `/${role}.svg`, displayUrl };
}

function profileDocument(name: string | null, assets: ReturnType<typeof asset>[]) {
  return { identity: { name: { value: name } }, brand: { assets } };
}

describe("the backfill", () => {
  it("copies the name the product calls itself", () => {
    const id = legacyProfile(profileDocument("Acme", []));
    db.sql(backfillStatement());

    expect(columnsOf(id).name).toBe("Acme");
  });

  it("leaves a blank name absent rather than storing whitespace", () => {
    // Storing it would violate the column's own CHECK, so this is the
    // difference between a migration that applies and one that aborts.
    const id = legacyProfile(profileDocument("   ", []));
    db.sql(backfillStatement());

    expect(columnsOf(id).name).toBe("<null>");
  });

  it("takes the primary logo over the alternate, whichever is stored first", () => {
    const id = legacyProfile(
      profileDocument("Acme", [
        asset("logo_alternate", "https://acme.test/mark.svg"),
        asset("logo", "https://acme.test/logo.svg"),
      ]),
    );
    db.sql(backfillStatement());

    expect(columnsOf(id).logo).toBe("https://acme.test/logo.svg");
  });

  it("skips an asset whose displayUrl is JSON null", () => {
    // `->>` on a JSON null yields SQL NULL, not the four characters "null".
    // A card handed the string would request /null and draw a broken image.
    const id = legacyProfile(
      profileDocument("Acme", [
        asset("logo", null),
        asset("logo_alternate", "https://acme.test/mark.svg"),
      ]),
    );
    db.sql(backfillStatement());

    expect(columnsOf(id).logo).toBe("https://acme.test/mark.svg");
  });

  it("never substitutes an icon for a logo", () => {
    const id = legacyProfile(
      profileDocument("Acme", [
        asset("favicon", "https://acme.test/favicon.ico"),
        asset("app_icon", "https://acme.test/icon.png"),
        asset("open_graph_image", "https://acme.test/og.png"),
      ]),
    );
    db.sql(backfillStatement());

    expect(columnsOf(id).logo).toBe("<null>");
  });

  it("skips a stored url the https constraint would reject", () => {
    // A row written before `resolveDisplayUrl` guaranteed https must not fail
    // the whole migration — and must not reach an <img src> either.
    const id = legacyProfile(
      profileDocument("Acme", [asset("logo", "http://acme.test/insecure.svg")]),
    );
    db.sql(backfillStatement());

    expect(columnsOf(id).logo).toBe("<null>");
  });

  it("survives a document with no brand block at all", () => {
    const id = db.sql(
      `with p as (insert into public.projects (user_id, name) values ('${userId}', 'bare')
         returning id),
       i as (insert into public.product_profiles
         (project_id, schema_version, builder_version, evidence_version, input_hash, status, result)
         select id, 'v1', 'v1', 'v1', repeat('b', 64), 'completed', '{"identity":{"name":{"value":"Bare"}}}'::jsonb
         from p returning id)
       select id from i;`,
    );
    db.sql(backfillStatement());

    expect(columnsOf(id)).toEqual({ name: "Bare", logo: "<null>" });
  });

  it("leaves an incomplete profile alone, because it has no result to read", () => {
    const projectId = db.sql(
      `with i as (insert into public.projects (user_id, name) values ('${userId}', 'pending')
         returning id) select id from i;`,
    );
    const id = db.sql(
      `with i as (insert into public.product_profiles
         (project_id, schema_version, builder_version, evidence_version, input_hash, status)
         values ('${projectId}', 'v1', 'v1', 'v1', repeat('c', 64), 'pending')
         returning id) select id from i;`,
    );
    db.sql(backfillStatement());

    expect(columnsOf(id)).toEqual({ name: "<null>", logo: "<null>" });
  });
});

describe("what the columns refuse to hold", () => {
  it("rejects a blank name", () => {
    const id = legacyProfile(profileDocument("Acme", []));
    const error = db.sqlExpectingError(
      `update public.product_profiles set product_name = '   ' where id = '${id}';`,
    );

    expect(error).toContain("product_profiles_product_name_is_stated");
  });

  it("rejects a logo url a browser must not be handed", () => {
    // The value goes straight into an <img src>. `resolveDisplayUrl` already
    // guarantees https before anything is stored; this is the guarantee
    // surviving a writer that does not go through it.
    const id = legacyProfile(profileDocument("Acme", []));

    for (const hostile of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "http://acme.test/logo.svg",
      "//acme.test/logo.svg",
    ]) {
      const error = db.sqlExpectingError(
        `update public.product_profiles set product_logo_url = '${hostile}' where id = '${id}';`,
      );
      expect(error, hostile).toContain("product_profiles_logo_is_https");
    }
  });

  it("accepts the https url the write path produces", () => {
    const id = legacyProfile(profileDocument("Acme", []));
    db.sql(
      `update public.product_profiles set product_logo_url = 'https://acme.test/logo.svg' where id = '${id}';`,
    );

    expect(columnsOf(id).logo).toBe("https://acme.test/logo.svg");
  });
});
