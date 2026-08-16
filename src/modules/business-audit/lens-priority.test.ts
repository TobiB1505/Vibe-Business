import { describe, expect, it } from "vitest";
import {
  countAbsenceClauses,
  findEvidenceEnumeration,
  findOrderingOverrides,
  findPriorityInversions,
  findUnconfirmedAssertions,
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

function blocker(
  headline: string,
  lenses: BusinessLens[],
  explanation = "A real problem.",
  /** Empty means the audit recorded no reason for where it placed this. */
  rootProblem = "",
): BusinessConclusion {
  return {
    rootProblem,
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

describe("ordering must not silently reverse materiality (§9, §37, §48)", () => {
  /**
   * The exact v4 defect. Audience was `now`, revenue was `soon`, and the audit
   * listed revenue first — a defensible call, possibly, but it said nothing
   * about why. "Had a reason" and "ignored its own assessment" looked identical
   * from the outside, which is what this note exists to end.
   */
  it("flags a soon problem placed above a now problem with no reason recorded", () => {
    const notes = findOrderingOverrides(
      synthesis(
        [lens("audience", "weak", "now"), lens("revenue_economics", "weak", "soon")],
        [
          blocker("You haven't decided how this makes money.", ["revenue_economics"]),
          blocker("Your first customer isn't defined.", ["audience"]),
        ],
      ),
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("You haven't decided how this makes money.");
    expect(notes[0]).toContain("Your first customer isn't defined.");
  });

  /**
   * The override is permitted. This deliberately does not judge whether the
   * stated reason is a good one — that is a human's call on reading the audit,
   * and a validator that graded reasoning would be inventing authority it has
   * no basis for.
   */
  it("accepts the same order once the audit records why", () => {
    const notes = findOrderingOverrides(
      synthesis(
        [lens("audience", "weak", "now"), lens("revenue_economics", "weak", "soon")],
        [
          blocker(
            "You haven't decided how this makes money.",
            ["revenue_economics"],
            "A real problem.",
            "Placed first because the audience question cannot be answered without knowing who is being charged for what.",
          ),
          blocker("Your first customer isn't defined.", ["audience"]),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });

  it("says nothing when the order already follows materiality", () => {
    const notes = findOrderingOverrides(
      synthesis(
        [lens("audience", "weak", "now"), lens("revenue_economics", "weak", "soon")],
        [
          blocker("Your first customer isn't defined.", ["audience"]),
          blocker("You haven't decided how this makes money.", ["revenue_economics"]),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });

  /**
   * §10 — a root problem spanning several lenses is as urgent as its most
   * urgent part. "The economics aren't defined" resting on one `now` lens and
   * two `later` ones is a `now` problem, not an average.
   */
  it("takes a multi-lens problem's urgency from its most urgent lens", () => {
    const notes = findOrderingOverrides(
      synthesis(
        [
          lens("revenue_economics", "weak", "now"),
          lens("scalability", "unclear", "later"),
          lens("conversion", "adequate", "later"),
          lens("audience", "weak", "soon"),
        ],
        [
          blocker("The economics of this business aren't defined.", [
            "revenue_economics",
            "scalability",
            "conversion",
          ]),
          blocker("Your first customer isn't defined.", ["audience"]),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });

  it("stays silent on a single blocker and on audits with no lenses", () => {
    expect(
      findOrderingOverrides(
        synthesis([lens("audience", "weak", "now")], [blocker("Only one.", ["audience"])]),
      ),
    ).toEqual([]);
    expect(findOrderingOverrides(synthesis([], [blocker("A.", []), blocker("B.", [])]))).toEqual([]);
  });
});

/**
 * §47, §52 — the legacy five dimensions must not drive business judgment.
 *
 * The mechanism is structural rather than a rule the model is asked to follow:
 * the conclusions are generated before the dimensions exist, and nothing in the
 * prioritization path reads a dimension score. These assert the structure,
 * because a rule in a prompt is a hope and a schema order is a guarantee.
 */
describe("legacy dimension scores cannot drive blocker ranking (§47, §52)", () => {
  it("ranks on lens materiality even when a dimension scores catastrophically", () => {
    // Vibe Business's real numbers: monetization 10/100, and yet `audience` —
    // which has no scored dimension at all — is what blocks the next milestone.
    const notes = findPriorityInversions(
      synthesis(
        [lens("audience", "weak", "now"), lens("revenue_economics", "weak", "soon")],
        [blocker("Your first customer isn't defined.", ["audience"])],
      ),
    );

    expect(notes).toEqual([]);
  });

  it("reviews prioritization from lenses only — dimensions are not an input", () => {
    // `findPriorityInversions` and `findOrderingOverrides` take a synthesis,
    // which carries lenses and conclusions. There is no parameter through which
    // a dimension score could reach either.
    const withoutDimensionData = synthesis(
      [lens("business_readiness", "weak", "later"), lens("audience", "weak", "now")],
      [blocker("Some basics are missing.", ["business_readiness"])],
    );

    expect(findPriorityInversions(withoutDimensionData)).toHaveLength(1);
    expect(findOrderingOverrides(withoutDimensionData)).toEqual([]);
  });
});

describe("an unanswered question is not a confirmed problem (§31)", () => {
  /**
   * Vibe cannot see what an audit run costs to deliver. If that absence gets
   * written as "your unit economics don't work", the audit has turned its own
   * blind spot into a diagnosis — CLAUDE.md rule 44, in the synthesis layer.
   */
  it("flags a deficiency asserted on an area the audit could not assess", () => {
    const notes = findUnconfirmedAssertions(
      synthesis(
        [lens("scalability", "blocked_by_missing_context", "now")],
        [
          blocker("Your unit economics don't work at scale.", ["scalability"], "Costs will outrun revenue."),
        ],
      ),
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("open question rather than a finding");
  });

  /** The same evidence, written honestly, passes untouched. */
  it("accepts the same conclusion framed as the open question it is", () => {
    const notes = findUnconfirmedAssertions(
      synthesis(
        [lens("scalability", "blocked_by_missing_context", "now")],
        [
          blocker(
            "What this costs you to run is still an open question.",
            ["scalability"],
            "Vibe couldn't see what each run costs to deliver.",
          ),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });

  /** One assessable lens is enough to ground an assertion. */
  it("says nothing when any lens behind the blocker was actually assessed", () => {
    const notes = findUnconfirmedAssertions(
      synthesis(
        [
          lens("revenue_economics", "weak", "now"),
          lens("scalability", "blocked_by_missing_context", "later"),
        ],
        [blocker("The economics aren't defined.", ["revenue_economics", "scalability"])],
      ),
    );

    expect(notes).toEqual([]);
  });
});

describe("root-cause synthesis across lenses (§49, §50, §51)", () => {
  /**
   * §49 — undecided monetization, no pricing, no checkout, unexamined cost to
   * serve. One economic root problem spanning three lenses, not three blockers.
   * The machinery must accept that shape without complaint.
   */
  it("accepts one economic root problem carrying revenue, conversion and scalability", () => {
    const economics = synthesis(
      [
        lens("revenue_economics", "weak", "now"),
        lens("conversion", "adequate", "later"),
        lens("scalability", "unclear", "later"),
      ],
      [
        blocker(
          "You haven't decided what people are paying for.",
          ["revenue_economics", "conversion", "scalability"],
          "The choice of what to charge for, and how usage becomes a price, hasn't been made.",
          "The economics of this business are not defined.",
        ),
      ],
    );

    expect(findPriorityInversions(economics)).toEqual([]);
    expect(findOrderingOverrides(economics)).toEqual([]);
    expect(findEvidenceEnumeration(economics)).toEqual([]);
    expect(findUnconfirmedAssertions(economics)).toEqual([]);
  });

  /**
   * §50 — the counterexample. Established pricing, real paying demand, broken
   * checkout. Here the surface *is* the business problem and must survive every
   * check, or the abstraction rule becomes a ban on saying plain things.
   */
  it("leaves a broken-checkout blocker intact for a business that already sells", () => {
    const broken = synthesis(
      [lens("conversion", "weak", "now"), lens("revenue_economics", "strong", "soon")],
      [
        blocker(
          "Customers who want to buy can't complete the purchase.",
          ["conversion"],
          "People reach the payment step and the order never completes.",
          "A working business cannot take the money it has already earned.",
        ),
      ],
    );

    expect(findPriorityInversions(broken)).toEqual([]);
    expect(findEvidenceEnumeration(broken)).toEqual([]);
    expect(findUnconfirmedAssertions(broken)).toEqual([]);
  });

  /**
   * §51 — audience absorbs acquisition evidence rather than spawning a second,
   * premature "no acquisition channel" blocker.
   */
  it("accepts audience absorbing acquisition without a separate premature blocker", () => {
    const audience = synthesis(
      [
        lens("audience", "weak", "now"),
        lens("acquisition", "weak", "later"),
        lens("measurement", "weak", "later"),
      ],
      [
        blocker(
          "It's still unclear who your first real customer is.",
          ["audience", "acquisition"],
          "The product is aimed broadly and nothing narrows it to a first group.",
          "Nobody has chosen who to win first.",
        ),
      ],
    );

    expect(findPriorityInversions(audience)).toEqual([]);
    expect(findOrderingOverrides(audience)).toEqual([]);
  });
});

/**
 * §55, §56 — the re-audit loop.
 *
 * A gap ranked `later` today has to survive to rise later, and materiality has
 * to be free to change when the business does. Both are properties of the data
 * rather than of the ranking, so they are asserted where they can be: nothing
 * here filters a lens out, and the same lens with a different materiality sorts
 * differently.
 */
describe("lower-priority issues survive to rise later (§55, §56)", () => {
  it("keeps every lens regardless of whether it became a blocker", () => {
    const early = synthesis(
      [
        lens("audience", "weak", "now"),
        lens("measurement", "weak", "later"),
        lens("business_readiness", "weak", "later"),
        lens("retention", "adequate", "not_material"),
      ],
      [blocker("Your first customer isn't defined.", ["audience"])],
    );

    expect(rankLenses(early.lenses)).toHaveLength(4);
    expect(rankLenses(early.lenses).map((entry) => entry.lens)).toContain("measurement");
  });

  it("reprioritizes the same lens when the business moves on", () => {
    const beforeLaunch = rankLenses([
      lens("audience", "weak", "now"),
      lens("measurement", "weak", "later"),
    ]);
    // Same product later: the first customer is settled, traffic is real.
    const afterLaunch = rankLenses([
      lens("audience", "adequate", "later"),
      lens("measurement", "weak", "now"),
    ]);

    expect(beforeLaunch[0]!.lens).toBe("audience");
    expect(afterLaunch[0]!.lens).toBe("measurement");
  });
});

/**
 * Root problem → explanation fidelity (CORE-2a.3.2 final fix, §14–§17).
 *
 * Semantic shape, not exact prose. What is checkable deterministically is
 * whether the explanation stayed at the root problem's level or fell back to an
 * inventory — which is precisely what `findEvidenceEnumeration` measures, and
 * precisely what the v5 revenue blocker failed.
 */
describe("the explanation translates the root problem (§14)", () => {
  const rootProblem =
    "The business has not decided what customers would pay for, how usage would turn into a price, or where free stops and paid starts.";

  /** The v5 failure, preserved as the case that must not come back. */
  it("flags an explanation that abandons the root problem for an inventory", () => {
    const notes = findEvidenceEnumeration(
      synthesis(
        [lens("revenue_economics", "weak", "soon")],
        [
          blocker(
            "You haven't yet decided how this will make money.",
            ["revenue_economics"],
            "You told Vibe the model isn't decided, and there's no pricing shown anywhere, no way to pay, and no billing code in the product.",
            rootProblem,
          ),
        ],
      ),
    );

    expect(notes).toHaveLength(1);
  });

  /** The same root problem, translated rather than re-analysed. */
  it("accepts an explanation that says the root problem in the founder's words", () => {
    const notes = findEvidenceEnumeration(
      synthesis(
        [lens("revenue_economics", "weak", "soon")],
        [
          blocker(
            "You haven't yet decided how this will make money.",
            ["revenue_economics"],
            "You still need to decide what people are actually paying for, how much someone's usage should affect what they pay, and where the free experience ends. Those choices define the business before any pricing page could.",
            rootProblem,
          ),
        ],
      ),
    );

    expect(notes).toEqual([]);
  });

  /**
   * §15 — the counter-test. Overcorrection would make it impossible to say the
   * plainly true thing about a business whose checkout is genuinely broken.
   */
  it("still accepts a surface problem when the surface is the root problem", () => {
    const broken = synthesis(
      [lens("conversion", "weak", "now"), lens("revenue_economics", "strong", "soon")],
      [
        blocker(
          "Customers who want to buy can't complete the purchase.",
          ["conversion"],
          "People reach the payment step and the order never goes through, so demand you already have is being turned away.",
          "A business with settled pricing and real demand cannot take the money it has already earned.",
        ),
      ],
    );

    expect(findEvidenceEnumeration(broken)).toEqual([]);
    expect(findUnconfirmedAssertions(broken)).toEqual([]);
    expect(findPriorityInversions(broken)).toEqual([]);
  });

  /** §16 — the audience conclusion was already right and must not degrade. */
  it("leaves the audience conclusion alone", () => {
    const audience = synthesis(
      [lens("audience", "weak", "now"), lens("offer", "adequate", "soon")],
      [
        blocker(
          "Vibe couldn't tell who your very first customers are meant to be.",
          ["audience", "offer"],
          "Right now the target is described broadly as software founders. That's a real market, but it isn't narrow enough to know exactly who to talk to first or what would make them say yes.",
          "The product targets a broad market without a narrowed first customer segment.",
        ),
      ],
    );

    expect(findEvidenceEnumeration(audience)).toEqual([]);
    expect(findOrderingOverrides(audience)).toEqual([]);
  });

  /**
   * §17 — acquisition must not be pushed *more* abstract than useful either.
   * "There is no clear way for the right people to discover this" is already a
   * business problem; it should pass untouched.
   */
  it("leaves the acquisition conclusion alone", () => {
    const acquisition = synthesis(
      [lens("acquisition", "weak", "soon"), lens("audience", "weak", "now")],
      [
        blocker("Your first customer isn't defined.", ["audience"]),
        blocker(
          "Vibe couldn't see how new people would find out this exists.",
          ["acquisition"],
          "There's no blog, documentation, or other public content, and nothing in the evidence points to a plan for reaching people yet.",
          "There is no visible channel or stated plan for how the right people would discover this once it's live.",
        ),
      ],
    );

    expect(findEvidenceEnumeration(acquisition)).toEqual([]);
    expect(findOrderingOverrides(acquisition)).toEqual([]);
  });
});
