import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS } from "@/modules/credits/rating";

/**
 * PART G — the economy layer is analysis, and must stay analysis.
 *
 * This sprint was told to change no billing behaviour, no credit behaviour and
 * no execution. Its actual diff was two new paths and nothing else, which is
 * the strongest form of that guarantee — but "nothing else was touched" is a
 * fact about one commit, and these assertions are about every commit after it.
 */

const ECONOMY_DIR = join(process.cwd(), "src/modules/economy");

function economySources(): string[] {
  return readdirSync(ECONOMY_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => readFileSync(join(ECONOMY_DIR, file), "utf8"));
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
    for (const source of economySources()) {
      expect(source).not.toMatch(/from "@\/modules\/(credits|billing|coding-agent|operations)\//);
    }
  });

  it("contains no write to any table", () => {
    for (const source of economySources()) {
      expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(source).not.toMatch(/SupabaseClient/);
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
});
