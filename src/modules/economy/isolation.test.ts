import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS } from "@/modules/credits/rating";

/**
 * PART G — the economy layer is analysis, and must stay analysis.
 *
 * This sprint was told to change no billing behaviour, no credit behaviour and
 * no execution. Its actual diff was two new paths and nothing else, which is
 * the strongest form of that guarantee — but "nothing else was touched" is a
 * fact about one commit, and these assertions are about every commit after it.
 *
 * ## Why the walk recurses (Sprint 0054)
 *
 * It did not, originally, and it did not need to: the module was one flat
 * directory. Sprint 0054 added `intelligence/`, and a `readdirSync` that stops
 * at the top level would have kept passing while covering none of it — the
 * module's only architectural enforcement would have silently stopped applying
 * to its newest code. A guard that quietly narrows is worse than no guard,
 * because it still reads green.
 */

const ECONOMY_DIR = join(process.cwd(), "src/modules/economy");

type EconomySource = { path: string; source: string };

/** Every non-test `.ts` file under `src/modules/economy`, at any depth. */
function economySources(dir: string = ECONOMY_DIR): EconomySource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return economySources(full);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [{ path: relative(ECONOMY_DIR, full), source: readFileSync(full, "utf8") }];
  });
}

describe("the economy module cannot charge anyone", () => {
  /**
   * The load-bearing one. `CREDIT_RATE_CARDS` being empty is what makes "Vibe
   * has no approved production Credit rate" a structural fact rather than a
   * claim, and this sprint's entire purpose is to *inform* filling it — never
   * to fill it.
   */
  it("leaves the production rate card empty", () => {
    expect(CREDIT_RATE_CARDS).toEqual([]);
  });

  it("imports nothing from billing, credits or execution", () => {
    // A read-only derivation layer that reached into the ledger would stop
    // being read-only the first time someone added a convenience helper.
    for (const { path, source } of economySources()) {
      expect(
        source.match(/from "@\/modules\/(credits|billing|coding-agent|operations)\//),
        `${path} imports a module the economy layer must not reach into`,
      ).toBeNull();
    }
  });

  it("contains no write to any table", () => {
    for (const { path, source } of economySources()) {
      expect(source.match(/\.(insert|update|upsert|delete)\(/), `${path} writes to a table`).toBeNull();
      expect(source.match(/SupabaseClient/), `${path} holds a Supabase client`).toBeNull();
    }
  });

  /**
   * The rule that keeps the analysis honest: no rate may be hard-coded here.
   * `run-economics.ts` takes a sandbox rate as an optional parameter precisely
   * so that a number nobody approved cannot become one everybody quotes.
   */
  it("hard-codes no sandbox price", () => {
    const source = readFileSync(join(ECONOMY_DIR, "run-economics.ts"), "utf8");

    // The only rate-shaped constant permitted is the one in the type, which has
    // no value attached.
    expect(source).toMatch(/nanoUsdPerMs: number;/);
    expect(source).not.toMatch(/nanoUsdPerMs\s*[:=]\s*\d/);
  });

  /**
   * The guard on the guard. If someone flattens the walk again, or moves the
   * sources somewhere this function does not look, every assertion above turns
   * into a loop over nothing and passes for the wrong reason.
   */
  it("walks the whole module, subdirectories included", () => {
    const paths = economySources()
      .map((entry) => entry.path)
      .sort();

    // Cross-checked against Node's own recursive walk rather than against a
    // hand-written list, so the assertion keeps holding as files are added.
    const expected = readdirSync(ECONOMY_DIR, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
      .sort();

    expect(paths).toEqual(expected);
    expect(paths).toContain("cost.ts");
  });
});
