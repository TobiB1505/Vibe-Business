import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_VERSIONS, EXECUTION_CAPABILITIES } from "./schema";

/**
 * The capability list against the deployed schema.
 *
 * This test exists because of a near-miss. Bumping the capability to
 * `nextjs_seo_foundations_v2` passed lint, typecheck, build and 1376 unit tests
 * — while the database still held
 * `CHECK (execution_capability = 'nextjs_seo_foundations_v1')`. Every real
 * preparation would have failed at INSERT.
 *
 * The in-memory test database does not evaluate CHECK constraints, so no
 * behavioural test could see it. The gap is structural: a TypeScript union and
 * a SQL constraint express the same rule in two places that nothing forced to
 * agree. This makes them agree.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/** The capability values permitted by the most recent constraint definition. */
function capabilitiesAllowedBySchema(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();

  let allowed: string[] | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Both forms the constraint has taken: `in (...)` and a single `= '...'`.
    const list = sql.match(/execution_capability in \(([^)]*)\)/i);
    const single = sql.match(/execution_capability = '([^']+)'/i);

    if (list) allowed = [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    else if (single) allowed = [single[1]];
  }

  if (allowed === null) throw new Error("no execution_capability constraint found in migrations");
  return allowed;
}

describe("execution capabilities match the database constraint", () => {
  it("permits every declared capability", () => {
    // A capability the code can resolve but the schema rejects is an outage.
    expect(capabilitiesAllowedBySchema().sort()).toEqual([...EXECUTION_CAPABILITIES].sort());
  });

  it("still permits the historical v1 capability", () => {
    // The first real Vibe-prepared change is stored under it.
    expect(capabilitiesAllowedBySchema()).toContain("nextjs_seo_foundations_v1");
  });

  it("gives every capability a version", () => {
    for (const capability of EXECUTION_CAPABILITIES) {
      expect(CAPABILITY_VERSIONS[capability]).toBeTruthy();
    }
  });
});
