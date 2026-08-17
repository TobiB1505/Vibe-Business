import { describe, expect, it } from "vitest";
import { classifyStep } from "./classify";
import {
  EXECUTION_SUPPORT,
  EXECUTION_SUPPORT_LABELS,
  isExecutableByVibe,
  isVibesResponsibility,
  type ExecutionSupport,
} from "./schema";
import {
  FAKE_PLAN_EVIDENCE_IDS,
  fakeRepositorySnapshotFor,
  fakeWirePlan,
  fakeWirePlanStep,
} from "./test-support";
import { validateActionPlanOutput } from "./validate";

/**
 * "Vibe can prepare this" is not "Vibe can apply this" (CORE-2b FIX §11–§15).
 *
 * The distinction the whole execution boundary rests on, and the one a UI will have to
 * render without ambiguity. Two axes, never collapsed:
 *
 * ```
 * actor             RESPONSIBILITY — who owns the work          model
 * executionSupport  PLATFORM       — what Vibe can perform      server
 * ```
 *
 * The dangerous confusion runs one way: a step that is Vibe's responsibility being read
 * as a step Vibe can carry out. Everything below exists to make that unrepresentable.
 */

const CONTEXT = { repository: fakeRepositorySnapshotFor() };
const SEO_EVIDENCE = ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"];

describe("prepare is not execute", () => {
  /**
   * §14 — the regression case, stated as the sprint states it.
   *
   * "Prepare homepage positioning around the selected segment" is genuinely Vibe's work
   * and there is no approved executor for it. Both halves must survive the pipeline.
   */
  it("keeps a preparable positioning step as preparation, with no capability", () => {
    const wire = fakeWirePlan({
      steps: [
        fakeWirePlanStep({
          order: 1,
          title: "Prepare homepage positioning around the selected segment",
          description:
            "Vibe drafts the positioning direction the homepage should take for the chosen first customer, with the reasoning behind it.",
          purpose:
            "Turns a segment choice into a concrete promise the site could carry, so the founder is reviewing a proposal rather than a blank page.",
          actor: "vibe",
          changeKind: "analysis",
          completionCriteria:
            "A written positioning direction exists, naming the chosen segment and the promise the homepage would make to it.",
          evidenceIds: ["profile.identity.description"],
        }),
        fakeWirePlanStep({
          order: 2,
          title: "Apply that positioning to the live homepage",
          description: "The homepage's primary promise is replaced with the prepared direction.",
          purpose: "Until the site says it, the positioning is a document rather than a change.",
          actor: "vibe",
          changeKind: "product_change",
          completionCriteria:
            "A visitor to the homepage reads the prepared promise as its first sentence.",
          dependsOn: [1],
          evidenceIds: ["live.site.title"],
        }),
      ],
    });

    const result = validateActionPlanOutput(wire, FAKE_PLAN_EVIDENCE_IDS, CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [prepare, apply] = result.result.steps;

    // Responsibility: both are Vibe's.
    expect(isVibesResponsibility(prepare)).toBe(true);
    expect(isVibesResponsibility(apply)).toBe(true);

    // Platform: neither can be applied, and they say so differently and honestly.
    expect(prepare.executionSupport).toBe("vibe_prepares");
    expect(prepare.capability).toBeNull();
    expect(isExecutableByVibe(prepare)).toBe(false);

    expect(apply.executionSupport).toBe("not_yet_supported");
    expect(apply.capability).toBeNull();
    expect(isExecutableByVibe(apply)).toBe(false);
  });

  /** §15 — and the contrast, which must stay valid and distinct. */
  it("still marks a registry-matched step as one Vibe can apply", () => {
    const wire = fakeWirePlan({
      steps: [
        fakeWirePlanStep({
          order: 1,
          title: "Add the missing discoverability foundations",
          completionCriteria:
            "A crawler requesting the two structural discovery files receives both, listing the product's real public routes.",
          actor: "vibe",
          changeKind: "product_change",
          evidenceIds: SEO_EVIDENCE,
        }),
        fakeWirePlanStep({
          order: 2,
          title: "Define what would show the change worked",
          completionCriteria:
            "The indexing signal to watch, and the window to watch it over, are written down.",
          actor: "vibe",
          changeKind: "measurement",
          dependsOn: [1],
          evidenceIds: [],
        }),
      ],
    });

    const result = validateActionPlanOutput(wire, FAKE_PLAN_EVIDENCE_IDS, CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [execute, prepare] = result.result.steps;

    expect(isExecutableByVibe(execute)).toBe(true);
    expect(execute.capability).toBe("nextjs_seo_foundations_v2");

    // Both are Vibe's responsibility; only one is Vibe's capability. That pairing is
    // the whole point of keeping the two axes apart.
    expect(isVibesResponsibility(execute)).toBe(true);
    expect(isVibesResponsibility(prepare)).toBe(true);
    expect(isExecutableByVibe(prepare)).toBe(false);
  });
});

describe("isExecutableByVibe", () => {
  /**
   * The predicate every caller should use, pinned across the whole enum.
   *
   * Written as an exhaustive sweep rather than a spot check because the failure mode is
   * a *new* value being added later and quietly reading as executable.
   */
  it("is true for exactly one support value, and only with a capability", () => {
    for (const support of EXECUTION_SUPPORT) {
      const withCapability = isExecutableByVibe({
        executionSupport: support,
        capability: "nextjs_seo_foundations_v2",
      });
      const without = isExecutableByVibe({ executionSupport: support, capability: null });

      expect(withCapability).toBe(support === "vibe_executes_now");
      // A support value alone never establishes execution. The capability is the thing
      // that would actually run, so its absence is decisive.
      expect(without).toBe(false);
    }
  });

  it("never reads vibe_prepares as executable", () => {
    expect(isExecutableByVibe({ executionSupport: "vibe_prepares", capability: null })).toBe(false);
  });
});

describe("the copy keeps the two apart", () => {
  /**
   * The label is the last place the distinction can be lost, and the first place a user
   * would act on losing it. `vibe_prepares` must not read as an offer to apply.
   */
  it("never promises application in a non-executable label", () => {
    const promises = ["apply", "applies", "publish", "deploy", "ship", "make the change"];

    for (const support of EXECUTION_SUPPORT) {
      if (support === "vibe_executes_now") continue;
      const label = EXECUTION_SUPPORT_LABELS[support as ExecutionSupport].toLowerCase();
      for (const promise of promises) {
        expect(label.includes(promise), `"${label}" promises "${promise}"`).toBe(false);
      }
    }
  });

  it("gives the two Vibe states different copy", () => {
    expect(EXECUTION_SUPPORT_LABELS.vibe_prepares).not.toBe(
      EXECUTION_SUPPORT_LABELS.vibe_executes_now,
    );
  });
});

describe("the model has no say in either axis's platform half", () => {
  /**
   * §13 — restated at the classifier, because this is the boundary a future change
   * would most plausibly erode: the temptation is one extra hint field to "help"
   * routing, and the answer is that the classifier's input type has no room for one.
   */
  it("derives support from structure alone", () => {
    const prepared = classifyStep(
      { actor: "vibe", changeKind: "analysis", evidenceIds: SEO_EVIDENCE },
      CONTEXT,
    );
    // Cites exactly the evidence that would match the registry — and does not match,
    // because an analysis step is not a product change.
    expect(prepared.executionSupport).toBe("vibe_prepares");
    expect(prepared.capability).toBeNull();
  });
});
