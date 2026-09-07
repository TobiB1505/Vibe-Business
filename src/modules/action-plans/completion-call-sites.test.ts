import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Every completion set has to know about handoffs (ADR 0096).
 *
 * ## Why this is a source test
 *
 * Because the seam is where it keeps breaking, and the seam is not a function —
 * it is a *call*. `isFounderAttestable`, `completedStepsFromEvidence` and
 * `completedStepsForExecutionRouting` all take the handed-off step keys with an
 * empty default, which is the safe fallback and also a silent one: a caller
 * that forgets them compiles, passes every unit test of the function itself,
 * and produces a product that disagrees with itself.
 *
 * That happened three times in one afternoon. The plan screen offered a
 * confirmation the server refused; then the founder recorded a finding the
 * plan would not count; then the plan advanced while the Agent stayed blocked
 * on the step behind it. Each time the pure function was right and the call was
 * not, and each time the unit tests were green.
 *
 * So this asserts the calls. It is deliberately crude — reading source and
 * looking for the argument — because the alternative is a Supabase client, a
 * session and a seeded plan for each of four call sites, and what has to hold
 * is one argument in each.
 */

const SITES: readonly { file: string; why: string }[] = [
  {
    file: join("src", "modules", "action-plans", "service.ts"),
    why: "The plan screen and onboarding both read completion here, and they must agree.",
  },
  {
    file: join("src", "modules", "coding-agent", "website-preflight.ts"),
    why: "The routing set decides whether the *next* step may start. Blind to handoffs, a ticked-off step leaves its successor blocked forever.",
  },
  {
    file: join("src", "app", "app", "projects", "[projectId]", "founder-action-attestation.ts"),
    why: "The gate that admits the founder's confirmation. Blind to handoffs, it refuses the step the screen just offered.",
  },
];

describe("callers that decide what is finished", () => {
  it.each(SITES)("$file passes the handoffs it read", ({ file }) => {
    const source = read(file);

    // It reads them...
    expect(source).toMatch(/listHandoffsForPlan|handoffByStepKey/);
    /*
     * ...and hands on the **build** ones, rather than every issued prompt.
     *
     * The set became narrower than "a prompt was issued" when verification
     * handoffs arrived (ADR 0096 follow-on). A build handoff is what admits a
     * `vibe` + `product_change` step to being closed by the founder's word; a
     * verify handoff is issued for the founder's own measurement and grants
     * nothing. A caller that kept passing every key would let a prompt issued
     * to *check* something admit work the agent exists to write — which is the
     * one thing this whole gate exists to prevent.
     *
     * `handoffByStepKey` on the view is already build-only, so a call site
     * reading the view satisfies this by naming that field.
     */
    expect(source).toMatch(
      /buildHandoffKeys\(\s*handoffs\s*\)|new Set\(\s*Object\.keys\(current\.handoffByStepKey\)\s*,?\s*\)/,
    );
  });

  it("finds every call site it is supposed to be checking", () => {
    /*
     * The list above is hand-maintained, so it has to fail when a fifth caller
     * appears rather than quietly covering four of five. `completion.ts` itself
     * is excluded: it is the definition, not a call site.
     */
    const callers = [
      join("src", "modules", "action-plans", "service.ts"),
      join("src", "modules", "coding-agent", "website-preflight.ts"),
      join("src", "modules", "action-plans", "completion.ts"),
    ];
    const found = callers.filter((file) =>
      /completedStepsFromEvidence\(|completedStepsForExecutionRouting\(/.test(read(file)),
    );

    expect(found).toHaveLength(3);
  });
});
