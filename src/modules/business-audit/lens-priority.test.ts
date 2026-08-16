import { describe, expect, it } from "vitest";
import {
  countAbsenceClauses,
  findEvidenceEnumeration,
  findPriorityInversions,
  isActionable,
  rankLenses,
} from "./lens-priority";
import {
  AUDIT_SYNTHESIS_VERSION,
  type AuditSynthesis,
  type BusinessConclusion,
  type BusinessLens,
  type BusinessLensAssessment,
  type LensHealth,
  type LensMateriality,
} from "./schema";

/**
 * Prioritization review (CORE-2a.3.1 §41–§49, §62).
 *
 * ## What is actually under test
 *
 * Not "does the model prioritize well" — that is the dogfood's job and this
 * sprint says so explicitly. What is testable is the thing that failed last
 * time: **the pipeline had no way to notice that the ranking contradicted the
 * reasoning behind it.** The audit called audience and acquisition material and
 * then shipped a top three without them, and every green test stayed green.
 *
 * So these cases are built as the sprint's fixtures are: the same evidence with
 * a different stage, the same gap with a different business model. Each asserts
 * that the machinery permits the right answer and flags the wrong one — never
 * that a specific ordering is correct, because that judgment is the model's.
 */

function lens(
  id: BusinessLens,
  health: LensHealth,
  materiality: LensMateriality,
): BusinessLensAssessment {
  return {
    lens: id,
    health,
    materiality,
    summary: `Internal reasoning for ${id}.`,
    evidenceIds: [],
    missingContext: [],
  };
}

function blocker(headline: string, lenses: BusinessLens[], explanation = "A real problem."): BusinessConclusion {
  return {
    headline,
    explanation,
    whyItMatters: "It holds the business back.",
    evidenceIds: ["live.site.title"],
    dimensions: ["product"],
    lenses,
    tone: "critical",
    confidence: "high",
  };
}

function synthesis(
  lenses: BusinessLensAssessment[],
  blockers: BusinessConclusion[],
  strengths: BusinessConclusion[] = [],
): AuditSynthesis {
  return {
    version: AUDIT_SYNTHESIS_VERSION,
    lenses,
    overall: "One sentence about the business.",
    strengths,
    blockers,
  };
}

describe("health and priority are independent (§3, §5, §45)", () => {
  /**
   * The critical regression test the sprint names.
   *
   * Lens A looks worse. Lens B is the milestone blocker. Ranking must follow B,
   * and the ordering must be indifferent to how bad A looks — because "worst
   * area wins" is precisely how a prototype's missing privacy policy outranked
   * its undefined revenue model.
   */
  it("ranks the milestone blocker above the unhealthier lens", () => {
    const ranked = rankLenses([
      lens("business_readiness", "weak", "later"),
      lens("audience", "adequate", "now"),
    ]);

    expect(ranked.map((entry) => entry.lens)).toEqual(["audience", "business_readiness"]);
  });

  it("orders purely by when it matters, ignoring health entirely", () => {
    const ranked = rankLenses([
      lens("retention", "strong", "later"),
      lens("measurement", "weak", "soon"),
      lens("revenue_economics", "weak", "now"),
      lens("scalability", "strong", "now"),
    ]);

    expect(ranked.map((entry) => entry.materiality)).toEqual(["now", "now", "soon", "later"]);
    // Both `now` lenses keep the model's own order; health does not reshuffle
    // them, or severity would creep back in through the sort.
    expect(ranked.slice(0, 2).map((entry) => entry.lens)).toEqual([
      "revenue_economics",
      "scalability",
    ]);
  });

  /** A materiality the audit could not state must never outrank one it did. */
  it("sorts unknown last rather than treating it as a middle value", () => {
    const ranked = rankLenses([
      lens("offer", "strong", "unknown"),
      lens("acquisition", "weak", "not_material"),
      lens("audience", "adequate", "later"),
    ]);

    expect(ranked.map((entry) => entry.lens)).toEqual(["audience", "acquisition", "offer"]);
  });

  it("treats only now and soon as candidates for the top three", () => {
    expect(isActionable("now")).toBe(true);
    expect(isActionable("soon")).toBe(true);
    for (const materiality of ["later", "not_material", "unknown"] as const) {
      expect(isActionable(materiality)).toBe(false);
    }
  });
});

describe("prematurity (§41, §46)", () => {
  /**
   * The exact shape of the real failure: a prototype with no monetization, no
   * users, no analytics and no legal pages. Legal and measurement completeness
   * taking a top slot while the fundamentals are unrepresented is the defect.
   */
  it("flags a legal blocker that displaced an unaddressed fundamental", () => {
    const notes = findPriorityInversions(
      synthesis(
        [
          lens("revenue_economics", "weak", "now"),
          lens("audience", "adequate", "now"),
          lens("business_readiness", "weak", "later"),
          lens("measurement", "weak", "later"),
        ],
        [
          blocker("The basics a stranger expects aren't in place.", ["business_readiness"]),
          blocker("You can't see what people do.", ["measurement"]),
          blocker("It's unclear how this makes money.", ["revenue_economics"]),
        ],
      ),
    );

    expect(notes).toHaveLength(2);
    expect(notes.join(" ")).toContain("audience");
    // It names the displaced lens, not just the fact that something is wrong —
    // a note nobody can act on is a note nobody reads.
    expect(notes[0]).toContain("The basics a stranger expects aren't in place.");
  });

  /**
   * §46: with the prerequisite unresolved, scaling and measurement are the
   * premature pair — the same rule, a different domain.
   */
  it("flags scaling and measurement ahead of an unresolved first-customer problem", () => {
    const notes = findPriorityInversions(
      synthesis(
        [
          lens("audience", "weak", "now"),
          lens("acquisition", "weak", "later"),
          lens("measurement", "weak", "later"),
        ],
        [
          blocker("Reaching more people needs work.", ["acquisition"]),
          blocker("You have no analytics.", ["measurement"]),
        ],
      ),
    );

    expect(notes).toHaveLength(2);
  });
});

describe("the fix must not become 'legal is always later' (§42, §43, §44)", () => {
  /**
   * The counterweight that keeps this honest. An active paid consumer product
   * missing its customer-facing legal and commercial foundations is a real,
   * immediate problem — and the machinery must stay silent about it.
   */
  it("says nothing when readiness is the thing that matters now", () => {
    const notes = findPriorityInversions(
      synthesis(
        [
          lens("business_readiness", "weak", "now"),
          lens("conversion", "adequate", "soon"),
          lens("scalability", "unclear", "later"),
        ],
        [blocker("People are paying you without the basics in place.", ["business_readiness"])],
      ),
    );

    expect(notes).toEqual([]);
  });

  /** §43: real traffic and conversions make instrumentation urgent. */
  it("says nothing when measurement is the thing that matters now", () => {
    const notes = findPriorityInversions(
      synthesis(
        [lens("measurement", "weak", "now"), lens("retention", "adequate", "later")],
        [blocker("You can't tell which of your channels is working.", ["measurement"])],
      ),
    );

    expect(notes).toEqual([]);
  });

  /** §44: a subscription with paying customers and no reason to stay. */
  it("says nothing when retention is the thing that matters now", () => {
    const notes = findPriorityInversions(
      synthesis(
        [lens("retention", "weak", "now"), lens("business_readiness", "weak", "later")],
        [blocker("Subscribers have little reason to stay past the first month.", ["retention"])],
      ),
    );

    expect(notes).toEqual([]);
  });
});

describe("the inversion is the pairing, not either half (§52, §62)", () => {
  /**
   * Three slots and four urgent problems is arithmetic, not misjudgment. The
   * note must fire on displacement, never on capacity — otherwise it would
   * fire on most healthy audits and be ignored within a week.
   */
  it("accepts a now lens left out when every blocker is itself urgent", () => {
    const notes = findPriorityInversions(
      synthesis(
        [
          lens("offer", "weak", "now"),
          lens("audience", "weak", "now"),
          lens("revenue_economics", "weak", "now"),
          lens("acquisition", "weak", "now"),
        ],
        [
          blocker("Nobody knows why they'd want this.", ["offer"]),
          blocker("You don't know who to sell to.", ["audience"]),
          blocker("There's no way this earns money.", ["revenue_economics"]),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });

  /** With nothing urgent anywhere, a `later` blocker is the honest answer. */
  it("accepts a later blocker when nothing was judged more urgent", () => {
    const notes = findPriorityInversions(
      synthesis(
        [lens("business_readiness", "weak", "later"), lens("offer", "strong", "soon")],
        [blocker("Some basics are still missing.", ["business_readiness"])],
      ),
    );

    expect(notes).toEqual([]);
  });

  /** A blocker spanning several lenses is fine if any one of them is urgent. */
  it("accepts a blocker held up by one urgent lens among several", () => {
    const notes = findPriorityInversions(
      synthesis(
        [
          lens("revenue_economics", "weak", "now"),
          lens("conversion", "adequate", "later"),
          lens("scalability", "unclear", "later"),
          lens("audience", "weak", "now"),
        ],
        [
          blocker("The economics aren't defined.", [
            "revenue_economics",
            "conversion",
            "scalability",
          ]),
          blocker("Your first customer is still too broad.", ["audience"]),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });

  it("stays silent on audits from before the lens framework existed", () => {
    expect(findPriorityInversions(synthesis([], [blocker("Something.", [])]))).toEqual([]);
    expect(
      findPriorityInversions(synthesis([lens("offer", "weak", "now")], [blocker("Something.", [])])),
    ).toEqual([]);
  });
});

describe("a conclusion states a problem, not a list of absences (§21, §48)", () => {
  it("counts the absence clauses in a sentence", () => {
    // The real dogfood explanation this rule was written against.
    expect(
      countAbsenceClauses(
        "There's no pricing shown anywhere, no way for anyone to pay, and no payment system built into the code.",
      ),
    ).toBe(3);

    // The business conclusion underneath it contains none at all.
    expect(
      countAbsenceClauses(
        "You haven't yet decided what customers should pay for, how usage should translate into price, or how the cost of delivering this becomes sustainable revenue.",
      ),
    ).toBe(0);
  });

  it("does not count 'no' inside a longer word", () => {
    expect(countAbsenceClauses("Nobody knows how to find you, and you know it.")).toBe(0);
  });

  it("flags an explanation that enumerates findings instead of naming the problem", () => {
    const notes = findEvidenceEnumeration(
      synthesis(
        [],
        [
          blocker(
            "It's unclear how this makes money.",
            ["revenue_economics"],
            "There is no pricing page, no checkout, and no payment integration in the repository.",
          ),
        ],
      ),
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("It's unclear how this makes money.");
  });

  /**
   * §49 — the counterexample that stops this becoming a ban on talking about
   * missing things. A business with real demand and a broken checkout should
   * say exactly that, and one or two absences is how you describe a gap
   * honestly.
   */
  it("leaves a surface-level blocker alone when the surface is the problem", () => {
    const notes = findEvidenceEnumeration(
      synthesis(
        [],
        [
          blocker(
            "Customers who want to buy can't complete the purchase.",
            ["conversion"],
            "Your prices are set and people are trying to buy, but there is no working checkout to finish the order.",
          ),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });
});
