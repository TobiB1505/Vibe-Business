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
const RUN_AUDIT = read("src/app/app/projects/[projectId]/run-audit-button.tsx");
const AUDIT_STORE = read("src/modules/business-audit/store.ts");
const SOURCE = read("src/modules/action-plans/source.ts");
const WORKSPACE_READ_MODEL = read("src/modules/execution/workspace.ts");
const AGENT_PAGE = read("src/app/app/projects/[projectId]/agent/page.tsx");
const AGENT_READY = read("src/app/app/projects/[projectId]/agent/agent-ready-stage.tsx");
const AGENT_START = read("src/app/app/projects/[projectId]/agent/agent-start-action.tsx");
const AGENT_STAGE_ACTIONS = read(
  "src/app/app/projects/[projectId]/agent/agent-stage-actions.tsx",
);
const AGENT_VALIDATE = read(
  "src/app/app/projects/[projectId]/agent/agent-validate-action.tsx",
);
const VALIDATE_ACTION = read(
  "src/app/app/projects/[projectId]/validate-change-action.ts",
);
const AGENT_WORKSPACE_READ = read("src/modules/coding-agent/agent-workspace.ts");
const DOGFOOD_ACTIONS = read(
  "src/app/app/projects/[projectId]/agent-dogfood/[stepKey]/actions.ts",
);
const DOGFOOD_PAGE = read("src/app/app/projects/[projectId]/agent-dogfood/page.tsx");
const DOGFOOD_STEP_PAGE = read(
  "src/app/app/projects/[projectId]/agent-dogfood/[stepKey]/page.tsx",
);
const AGENT_FOCUS = read("src/modules/projects/agent-focus.ts");
const CHANGE_ORIGIN = read("src/app/app/projects/[projectId]/change-origin.tsx");
const PROJECT_NAV = read("src/components/layout/project-nav.tsx");
const HOME_STATUS = read("src/app/app/projects/[projectId]/home-status.tsx");
const NEXT_MOVE_CARD = read("src/app/app/next-move-card.tsx");

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
    expect(PREPARE_PANEL).toContain("agentMoveHref(preparedHref, opportunityId)");
    expect(PREPARE_PANEL).toContain("agentChangeHref(agentHref, preparedChangeId)");
    expect(PREPARE_PANEL).toContain("agentChangeHref(agentHref, next.resultId)");
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
    expect(AGENT_PAGE).toContain("preparedChangeAnchorId(change.id)");
    expect(AGENT_PAGE).toContain("scroll-mt-24");
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

describe("the plan screen believes the resolver about what Vibe could build", () => {
  /**
   * Regression: a `vibe` + `product_change` step with no registry capability
   * read "Not automated yet" on this screen while the Agent workspace offered
   * to run the same step. The stored classification knows one registry entry;
   * the resolver knows the coding agent.
   */
  it("resolves each step's route on the route, with no allowlist in front of it", () => {
    expect(MOVES_PAGE).toContain("resolvePlanExecutionRoutes");
    expect(MOVES_PAGE).not.toContain("resolveDogfoodPlanRoutes");
    // State only. A screen that classifies a whole plan must spend nothing.
    expect(MOVES_PAGE).not.toContain("liveHead");
    expect(MOVES_PAGE).not.toContain("establishLivePremise");
  });

  it("hands the panel two strings, never the resolution", () => {
    expect(MOVES_PAGE).toContain("responsibilityByStepKey");
    expect(PLAN_DETAIL).not.toContain("RESPONSIBILITY_SUBLABELS[step.executionSupport]");
    expect(PLAN_DETAIL).not.toContain("ExecutionResolution");
  });
});

describe("a refused run says which gate stopped it", () => {
  /**
   * Regression: the start action answered every refusal with one opaque
   * `not_eligible`, rendered as "the page will show why above" — while the
   * page's own render had resolved fine, which is why the button existed. The
   * production case was a default branch that moved between the last
   * repository read and the click.
   */
  it("carries the reason the fresh chain established, as closed enums", () => {
    expect(DOGFOOD_ACTIONS).toContain("preview.resolution.reason");
    expect(DOGFOOD_ACTIONS).toContain("preview.resolution.admission");
    expect(DOGFOOD_ACTIONS).toContain("preview.preflight.refusals[0]");
    // Never the resolution object itself: it carries capability ids and
    // version strings that must not cross into a component.
    expect(DOGFOOD_ACTIONS).not.toContain("resolution: preview.resolution");
  });

  it("renders it, and never claims the page explains it", () => {
    expect(AGENT_START).toContain("AgentStartRefusalNotice");
    expect(read("src/modules/coding-agent/view.ts")).not.toContain("will show why above");
  });

  /** Rule 60: a re-read costs, so it is offered as a link and never started here. */
  it("offers the repository re-read without starting one", () => {
    const notice = read(
      "src/app/app/projects/[projectId]/agent/agent-start-refusal-notice.tsx",
    );

    expect(notice).toContain("<Link");
    expect(notice).not.toContain("startUnderstandingAction");
    expect(notice).not.toContain("useActionState");
  });
});

describe("a finished re-scan reaches the screen", () => {
  /**
   * Regression: the workspace polled the generation run, watched it finish and
   * told nobody. Everything a finished run produces — the new Moves, their
   * readiness, the set's date — is rendered by the server, so without a
   * refresh the founder kept reading the previous plan (or "No moves yet"
   * seconds after a run that had succeeded) until a manual reload.
   */
  it("refreshes the route when the run leaves working, not on every tick", () => {
    expect(WORKSPACE).toContain("useRouter");
    expect(WORKSPACE).toContain('operationPollPhase(next) !== "working"');
    expect(WORKSPACE).toContain("router.refresh()");
    expect(WORKSPACE.match(/router\.refresh\(\)/g)).toHaveLength(1);
  });

  /** A re-scan over an existing plan had no running state at all: `PlanGenerating`
   *  answers the empty case only, and it is in the other branch. */
  it("says a re-scan is running while the previous Moves are still shown", () => {
    expect(WORKSPACE).toContain('data-testid="moves-rescanning"');
    expect(WORKSPACE).toContain('operationProgressSteps("opportunity_generation"');
    const rescan = WORKSPACE.slice(WORKSPACE.indexOf('data-testid="moves-rescanning"'));
    expect(rescan).toContain("The plan below is your previous one until this finishes.");
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

/**
 * The last leg of the loop (UI-S3).
 *
 * Everything above pins diagnosis → Moves. These pin Moves → Agent → back,
 * which is where the wiring stopped: `/agent` took no search parameters, the
 * engineer's card stated three project-level booleans, and a prepared change
 * quoted its Move at length and linked to nothing.
 */
describe("the plan hands off to the agent, and the agent points back", () => {
  /** Regression: a second parameter name for the same fact. */
  it("names the Move with one parameter shared by both surfaces", () => {
    expect(SOURCE).toContain('export const PLAN_OPPORTUNITY_PARAM = "plan"');
    expect(SOURCE).toContain('export const AGENT_CHANGE_PARAM = "change"');
    expect(SOURCE).toContain("export function agentMoveHref");
    expect(SOURCE).toContain("export function agentChangeHref");
    expect(SOURCE).toContain("export function planMoveHref");
    expect(AGENT_PAGE).toContain("PLAN_OPPORTUNITY_PARAM");
  });

  /**
   * Regression: `planMoveHref`'s fragment pointed at `plan-this-move`, which
   * nothing rendered. It had no callers, so nobody ever followed it.
   */
  it("targets a fragment the plan actually renders", () => {
    expect(SOURCE).toContain('export const PLANNED_WORK_ANCHOR = "planned-work"');
    expect(SOURCE).toContain("#${PLANNED_WORK_ANCHOR}");
    expect(copyOf(SOURCE)).not.toContain("plan-this-move");
    expect(PLAN_DETAIL).toContain("id={PLANNED_WORK_ANCHOR}");
  });

  /** §31, §46: the parameter is untrusted text and is never a raw lookup. */
  it("sanitizes the requested Move before it means anything", () => {
    expect(AGENT_PAGE).toContain("sanitizeRequestedOpportunityId");
    expect(AGENT_PAGE).toContain("sanitizeRequestedChangeId");
    const resolution = AGENT_PAGE.slice(
      AGENT_PAGE.indexOf("const requestedOpportunityId"),
      AGENT_PAGE.indexOf("const basePlanHref"),
    );
    // Resolved against this project's own set, never fetched by the id alone.
    expect(resolution).toContain("opportunities?.set.opportunities.find");
  });

  /**
   * The regression this whole seam exists to prevent: the Agent claiming to be
   * working on a Move the founder never chose.
   */
  it("never substitutes another Move for one it cannot resolve", () => {
    expect(AGENT_FOCUS).toContain('return { kind: "unresolved" }');
    for (const substitution of ["defaultPlannedOpportunity", "rank === 1", "[0]", "sort"]) {
      expect(copyOf(AGENT_FOCUS), substitution).not.toContain(substitution);
    }
  });

  /**
   * Two screens, one decision. A second derivation of "can Vibe execute this"
   * would eventually offer work the plan had already called blocked.
   */
  it("reads the Action Plan's execution answer rather than deriving its own", () => {
    expect(AGENT_PAGE).toContain("buildOpportunityActionState({");
    expect(AGENT_FOCUS).toContain("OpportunityActionState");
    for (const derivation of ["executionReadiness", "resolveExecutionCapability", "capability ==="]) {
      expect(copyOf(AGENT_FOCUS), derivation).not.toContain(derivation);
    }
  });

  it("starts only through the existing freshly admitted server action", () => {
    expect(AGENT_PAGE).toContain("resolveDogfoodPlanRoutes");
    expect(AGENT_READY).toContain("startAction");
    expect(AGENT_START).toContain("startDogfoodRunAction");
    expect(DOGFOOD_ACTIONS).toContain("previewDogfoodStep");
    expect(DOGFOOD_ACTIONS).toContain("startAgentExecution");
    expect(copyOf(AGENT_START)).not.toContain("startAgentExecution(");
    expect(AGENT_START).toContain("Run with Vibe");
    /*
     * The ceiling is the server's answer, never a number the page invents —
     * and since `launch-v1` it is resolved for the *step* that would run,
     * because the Agent price is per execution pricing class (Sprint 0111).
     * The route set can no longer answer it plan-wide.
     */
    expect(AGENT_PAGE).toContain("resolveRouteAgentEconomics");
    expect(AGENT_PAGE).toContain("formatCreditsForDisplay(routeEconomics.budget.maxCredits)");
    expect(AGENT_READY).toContain("creditEstimate={startAction ? creditEstimate : null}");
    expect(AGENT_PAGE).toContain("agentRoutes.plan.opportunityId === taskOpportunityId");
    expect(AGENT_PAGE).toContain("!agentWorking");
  });

  /** Regression: a prepared change that quotes its Move and links nowhere. */
  it("links a prepared change back to the Move it answers", () => {
    expect(WORKSPACE_READ_MODEL).toContain("opportunityId: opportunity ? prepared.opportunityId : null");
    expect(AGENT_PAGE).toContain("planMoveHref(basePlanHref, taskOpportunityId)");
    expect(AGENT_PAGE).toContain("backHref={planHref}");
    expect(CHANGE_ORIGIN).toContain("moveHref");
  });

  /**
   * §6: a panel does not know what the workspace's segments are called. Two
   * blocked states once shipped hard-coded fragments that pointed at nothing.
   */
  it("takes the plan's URL from the route rather than building one", () => {
    expect(AGENT_PAGE).toContain("const basePlanHref: string");
    expect(AGENT_PAGE).toContain('projectSectionHref(project.id, "action-plan")');
    /*
     * Narrowed when the gate panels moved onto the route: the rule is that the
     * *plan's* URL comes from `projectSectionHref`, not that a route may never
     * build any path. This page legitimately builds the internal dogfood href.
     */
    expect(copyOf(AGENT_PAGE)).not.toContain('`/app/projects/${project.id}/action-plan');
  });

  it("keeps every production gate inside the new stage workspace", () => {
    expect(AGENT_PAGE).toContain("AgentPreviewActions");
    expect(AGENT_PAGE).toContain("AgentReviewDecision");
    expect(AGENT_STAGE_ACTIONS).toContain("PreviewPanel");
    expect(AGENT_STAGE_ACTIONS).toContain("ReviewPanel");
    expect(AGENT_STAGE_ACTIONS).toContain("ApprovalPanel");
    expect(AGENT_STAGE_ACTIONS).toContain("MergePanel");
    expect(AGENT_PAGE).not.toContain("AgentPanel");
    expect(AGENT_PAGE).not.toContain("ChangeGates");
  });

  it("leaves no legacy Agent run screen visible", () => {
    for (const source of [DOGFOOD_PAGE, DOGFOOD_STEP_PAGE]) {
      expect(source).toContain("redirect(projectSectionHref(projectId, \"agent\"))");
      expect(source).not.toContain("RunPanel");
      expect(source).not.toContain("StatusView");
    }
    expect(DOGFOOD_ACTIONS).toContain("redirect(agentHref)");
  });

  it("keeps validation live until the durable operation settles", () => {
    expect(AGENT_VALIDATE).toContain("validateChangeAction");
    expect(AGENT_VALIDATE).toContain("getValidationProgressAction");
    expect(AGENT_VALIDATE).toContain("useOperationPoll");
    expect(AGENT_VALIDATE).toContain("router.refresh()");
    expect(AGENT_VALIDATE).toContain("rerunChangeValidationAction");
    expect(VALIDATE_ACTION).toContain("reusePassed: boolean");
    expect(VALIDATE_ACTION).toContain('revalidatePath(`/app/projects/${projectId}/agent`)');
  });

  it("loads the exact prepared artifact named by the handoff", () => {
    expect(AGENT_PAGE).toContain("selectedPreparedChangeId: requestedPreparedChangeId");
    expect(WORKSPACE_READ_MODEL).toContain("getPreparedChange(supabase");
    expect(WORKSPACE_READ_MODEL).not.toContain("prepared.find");
  });

  it("does not assemble historical changes or reload the current Move on the hot path", () => {
    expect(AGENT_PAGE).not.toContain("getPreparedChangeWorkspace(");
    expect(AGENT_WORKSPACE_READ).toContain("getPreparedChangeWorkspaceItem");
    expect(AGENT_PAGE).toContain("requestedOpportunityId && !requestedTaskMatchesRun");
  });

  /**
   * Narrow on purpose. A general "carry the query string" rule would send
   * audit context and checkout returns to destinations they mean nothing to.
   */
  it("carries the selection on the Agent item alone", () => {
    expect(PROJECT_NAV).toContain('item.id !== "agent"');
    expect(PROJECT_NAV).toContain("agentMoveHref(item.href, selectedMove)");
    // Only while the founder is on the Action Plan, and only that parameter.
    expect(PROJECT_NAV).toContain("pathname === actionPlanHref");
    expect(PROJECT_NAV).toContain("searchParams.get(PLAN_OPPORTUNITY_PARAM)");
    // The active state still ignores the query, or Agent would light up wrong.
    expect(PROJECT_NAV).toContain("isActive(item.href)");
  });

  /**
   * Regression: "Review this move" reviewed whatever was rank 1 at click time
   * — the same Move almost always, and a different one exactly when a re-scan
   * had reordered the set.
   */
  it("opens the Move a card names, not the plan's current first", () => {
    expect(HOME_STATUS).toContain("planMoveHref(planHref, nextMove.id)");
    expect(NEXT_MOVE_CARD).toContain("planMoveHref(planHref, move.id)");
  });
});
