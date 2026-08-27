import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The seam between diagnosis and action, pinned where the browser cannot reach
 * (UI-S2 §50).
 *
 * The browser suite proves what each screen shows for a given state. These
 * assertions cover the *wiring* that produces the state — which is the layer
 * the fixture harness cannot see, because it supplies the state itself.
 *
 * Each test names the regression it exists to catch. A failure here is a
 * question about whether the product has started claiming something nobody
 * asserted, not an invitation to update the string.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const copyOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LINEAGE = read("src/modules/opportunities/lineage.ts");
const SERVICE = read("src/modules/opportunities/service.ts");
const MOVES_PAGE = read("src/app/app/projects/[projectId]/plan/page.tsx");
const SCORE_PAGE = read("src/app/app/projects/[projectId]/health/content.tsx");
const PANEL = read("src/app/app/projects/[projectId]/plan/move-card.tsx");
const STEPPER = read("src/app/app/projects/[projectId]/plan/move-stepper.tsx");
const WORKSPACE = read("src/app/app/projects/[projectId]/plan/action-plan-workspace.tsx");
const PLAN_DETAIL = read("src/app/app/projects/[projectId]/plan/plan-detail-panel.tsx");
const PRIORITIES = read(
  "src/app/app/projects/[projectId]/business-brain/audit-intelligence.tsx",
);
const BRAIN_VIEW = read("src/modules/projects/business-brain-view.ts");
const PREPARE_PANEL = read("src/app/app/projects/[projectId]/prepare-change-panel.tsx");
const PREPARED_SECTION = read("src/app/app/projects/[projectId]/prepared-changes-section.tsx");
const RUN_AUDIT = read("src/app/app/projects/[projectId]/run-audit-button.tsx");
const AUDIT_STORE = read("src/modules/business-audit/store.ts");

/** `getMoveLineage` alone, not everything declared after it. */
function moveLineageReader(): string {
  const start = SERVICE.indexOf("export async function getMoveLineage");
  const end = SERVICE.indexOf("export async function", start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SERVICE.slice(start, end);
}

describe("lineage comes from stored identity", () => {
  /** Regression 1: `sourceConclusionKey` stops being the relationship. */
  it("resolves through the stored key and the audit's own finder", () => {
    expect(LINEAGE).toContain("opportunity.sourceConclusionKey");
    expect(LINEAGE).toContain("findConclusionByKey");
  });

  /** Regression 2: lineage quietly falls back to matching titles. */
  it("never reads a Move's prose to decide what it addresses", () => {
    const resolver = LINEAGE.slice(
      LINEAGE.indexOf("export function resolveMoveLineage"),
      LINEAGE.indexOf("export function movesPerConclusion"),
    );
    for (const prose of ["title", "headline.includes", "problem", "similarity", "toLowerCase"]) {
      expect(copyOf(resolver), prose).not.toContain(prose);
    }
  });

  /** Regression 10: a historical Move rebound to the newest audit. */
  it("reads the set's own audit, not the latest one", () => {
    const reader = moveLineageReader();
    expect(reader).toContain("auditId: params.set.businessAuditId");
    // The whole point: resolving against the *current* audit would silently
    // rebind a historical Move to whatever finding now sits at its key.
    expect(reader).not.toContain("getLatestSuccessfulAudit");
  });

  it("guards the audit page's lineage on the set matching the shown audit", () => {
    expect(SCORE_PAGE).toContain("opportunities.set.businessAuditId === latestAudit.id");
  });

  /** §32: a new lookup boundary gets an explicit project scope. */
  it("scopes the lineage audit read to the project", () => {
    const reader = AUDIT_STORE.slice(
      AUDIT_STORE.indexOf("export async function getProjectAuditById"),
      AUDIT_STORE.indexOf("export async function getAuditById"),
    );
    expect(reader).toContain('.eq("id", params.auditId)');
    expect(reader).toContain('.eq("project_id", params.projectId)');
  });

  /** §51: one query for the whole list, not one per Move. */
  it("resolves the whole list in a single read", () => {
    const reader = moveLineageReader();
    expect(reader.match(/getProjectAuditById/g)).toHaveLength(1);
    expect(MOVES_PAGE).toContain("getMoveLineage(supabase");
    // Not inside the per-opportunity loop.
    const loop = MOVES_PAGE.slice(MOVES_PAGE.indexOf("for (const summary of executionSummaries)"));
    expect(loop).not.toContain("getMoveLineage");
  });
});

describe("the audit hands off to the moves that answer it", () => {
  /** Regression 3: the audit's primary action becomes inert again. */
  it("gives the top priority a link carrying its conclusion key", () => {
    expect(PRIORITIES).toContain("movesContextHref(movesHref, priority.key)");
    expect(BRAIN_VIEW).toContain('conclusionKey("blocker", index)');
  });

  /** §5: the key is an address. It must not be rendered anywhere. */
  it("renders the finding's headline rather than its key", () => {
    const rendered = copyOf(PRIORITIES);
    expect(rendered).toContain("priority.headline");
    expect(rendered).not.toMatch(/>\s*\{key\}/);
    expect(copyOf(PANEL)).not.toContain("conclusionKey}");
  });

  /** §19: the no-moves state must lead somewhere. */
  it("offers a way forward when nothing addresses the finding", () => {
    expect(PRIORITIES).toContain("Find next moves");
    expect(copyOf(PRIORITIES)).not.toContain("hasn&rsquo;t worked out the next moves");
  });
});

describe("context filters, it never reranks", () => {
  /** Regression 5 / §44. */
  it("orders both groups by the engine's persisted rank", () => {
    const partition = LINEAGE.slice(LINEAGE.indexOf("export function partitionByContext"));
    expect(partition).toContain("byRank(opportunities)");
    // No renumbering anywhere in the module.
    expect(copyOf(LINEAGE)).not.toMatch(/rank\s*[:=]\s*index/);
    expect(copyOf(LINEAGE)).not.toContain("rank + 1");
  });

  it("renders the rank the domain gave, never a positional one", () => {
    // The active card and the priority step both use the persisted rank.
    expect(PANEL).toContain("String(opportunity.rank).padStart(2");
    expect(PANEL).toContain('data-rank={opportunity.rank}');
    expect(STEPPER).toContain("opportunity.rank");
    expect(STEPPER).toContain('data-rank={opportunity.rank}');
    expect(copyOf(PANEL)).not.toMatch(/rank\s*[:=]\s*index/);
  });

  /** §31: the requested key is validated before it means anything. */
  it("validates the requested key against the loaded set", () => {
    expect(MOVES_PAGE).toContain("resolveMovesContext({");
    expect(LINEAGE).toContain("if (addressing.length === 0) return null");
    expect(LINEAGE).toContain("if (requested.length > 64) return null");
  });
});

describe("the card says one thing at a time", () => {
  it("shows impact and effort without turning evidence into card furniture", () => {
    const chips = PANEL.slice(PANEL.indexOf('className="flex flex-wrap items-center gap-2"'));
    expect(chips).toContain("IMPACT_LABELS");
    expect(chips).toContain("EFFORT_LABELS");
    expect(chips).not.toContain("CONFIDENCE_LABELS");
    expect(chips).not.toContain("DIMENSION_LABELS");
    expect(PANEL).not.toContain("describeEvidenceId");
  });

  /**
   * The readiness headline is a domain reading, not a string the card picks.
   *
   * `moveHeadline` owns which of two true things leads, so a component can
   * never quietly start captioning a Move from `executionReadiness` itself.
   */
  it("takes its leading status from the domain, never from the enum", () => {
    expect(PANEL).toContain("moveHeadline(opportunity)");
    expect(copyOf(PANEL)).not.toContain("EXECUTION_READINESS_LABELS");
  });

  /** The domain keeps its internal category; the card uses the attributed Lens. */
  it("no longer imports the dimension labels at all", () => {
    expect(PANEL).not.toContain("DIMENSION_LABELS");
    expect(PANEL).toContain("moveLensLabel(opportunity)");
  });

  it("prints no invented duration", () => {
    expect(PANEL).toContain("EFFORT_LABELS[opportunity.effort]");
    expect(copyOf(PANEL)).not.toMatch(/~\s*\d/);
    expect(copyOf(PANEL)).not.toMatch(/\d\s*(hours?|minutes?|mins?|hrs?|days?|weeks?)\b/i);
  });
});

describe("the stepper owns selection without owning business state", () => {
  it("renders one active Move and changes it through local history", () => {
    expect(WORKSPACE.match(/<MoveCard/g)).toHaveLength(1);
    expect(WORKSPACE).toContain("window.history.pushState");
    expect(WORKSPACE).toContain("setActiveOpportunityId");
    expect(WORKSPACE).not.toContain("router.push");
  });

  it("offers button and keyboard equivalents for swipe", () => {
    expect(STEPPER).toContain('role="tablist"');
    expect(STEPPER).toContain('event.key === "ArrowRight"');
    expect(STEPPER).toContain('aria-label="Previous move"');
    expect(STEPPER).toContain('aria-label="Next move"');
    expect(WORKSPACE).toContain('drag={!reduceMotion');
  });

  it("loads existing readiness per Move rather than deriving it in the browser", () => {
    expect(MOVES_PAGE).toContain("planReadinessByOpportunity");
    expect(MOVES_PAGE).toContain("getActionPlanReadiness(supabase, projectId, opportunity.id)");
    expect(WORKSPACE).not.toContain("executionReadiness === \"ready\"");
  });

  it("keeps the one primary Move action in the detail region", () => {
    expect(PANEL).not.toContain("PrepareChangePanel");
    expect(PLAN_DETAIL).toContain("PrepareChangePanel");
    expect(PLAN_DETAIL).toContain("executionOwnsPrimary");
  });
});

describe("planned work is a compact read-only checklist", () => {
  it("starts each task behind a native disclosure", () => {
    expect(PLAN_DETAIL).toContain('<details className="group/step">');
    expect(PLAN_DETAIL).toContain('data-testid="plan-step"');
    expect(PLAN_DETAIL).toContain('aria-label="Planned work checklist"');
  });

  it("does not turn durable completion into a local checkbox", () => {
    expect(copyOf(PLAN_DETAIL)).not.toContain('type="checkbox"');
    expect(PLAN_DETAIL).toContain("attestFounderActionStepAction");
  });
});

describe("preparing leads to the exact prepared change", () => {
  /** Regression 7: the handoff disappears. */
  it("links onward from a prepared change", () => {
    expect(PREPARE_PANEL).toContain("Review prepared change");
    expect(PREPARE_PANEL).toContain("preparedChangeHref(preparedHref, preparedChangeId)");
  });

  /**
   * Regression 8: the link identifies the newest change rather than this one.
   *
   * `preparedChangeId` is resolved from the action's own result, the stored
   * change for this opportunity, or the completed operation's `resultId` —
   * three exact identities. Sorting or "latest" anywhere in this resolution
   * would be the defect.
   */
  it("resolves the id by exact identity, never by recency", () => {
    const resolution = PREPARE_PANEL.slice(
      PREPARE_PANEL.indexOf("const preparedChangeId ="),
      PREPARE_PANEL.indexOf("async function loadDiff"),
    );
    expect(resolution).toContain("actionState.preparedChangeId");
    expect(resolution).toContain("operation.resultId");
    for (const recency of ["latest", "createdAt", "sort", "[0]", "at(-1)"]) {
      expect(copyOf(resolution), recency).not.toContain(recency);
    }
  });

  it("makes the prepared card addressable by that same id", () => {
    expect(PREPARED_SECTION).toContain("preparedChangeAnchorId(change.id)");
    expect(PREPARED_SECTION).toContain("scroll-mt-24");
  });
});

describe("running an audit enters the audit's own lifecycle", () => {
  /** Regression 9: a stale verdict stays on screen while a new run executes. */
  it("revalidates the route as soon as a run is accepted", () => {
    expect(RUN_AUDIT).toContain("useRouter");
    expect(RUN_AUDIT).toContain("router.refresh()");
    expect(RUN_AUDIT).toContain("startedOperationId");
  });

  /** §21, §52: navigation and refreshing must never start paid work. */
  it("starts nothing by itself", () => {
    const refresh = RUN_AUDIT.slice(RUN_AUDIT.indexOf("const startedOperationId"));
    expect(refresh.slice(0, refresh.indexOf("}, [router, startedOperationId]);"))).not.toContain(
      "formAction",
    );
    // The moves route reads; it never starts a generation on render.
    expect(MOVES_PAGE).not.toContain("startOpportunityOperation");
  });
});

describe("the loop speaks business", () => {
  it("carries no implementation commentary on the changed surfaces", () => {
    for (const [name, source] of [
      ["moves route", MOVES_PAGE],
      ["moves panel", PANEL],
      ["priorities", PRIORITIES],
    ] as const) {
      const copy = copyOf(source);
      for (const banned of [
        "The order is the engine's",
        "shown as produced",
        "source conclusion key",
        "the model ranked",
      ]) {
        expect(copy, `${name} must not say "${banned}"`).not.toContain(banned);
      }
    }
  });
});
