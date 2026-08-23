import type { DashboardProject } from "./dashboard";

/**
 * What needs your attention (Sprint UI-3).
 *
 * ## What this is, and firmly is not
 *
 * A **presentation-layer ordering of states the domain already produced.** It
 * runs no model, calls nothing, scores nothing and decides nothing about the
 * business. Every item corresponds to a fact already on a `DashboardProject`:
 * a failed validation, a prepared change, an opportunity set, a missing audit,
 * a missing repository.
 *
 * It is a pure function of that input, which is what makes it testable and
 * what keeps it honest — there is no way for it to invent an item, because it
 * has nothing to invent one from.
 *
 * ## The priority tiers
 *
 * Four tiers, in this order, matching how much the user is actually blocked:
 *
 *   1. **blocked**   — something failed and will not proceed on its own.
 *   2. **decision**  — Vibe has done its part and is waiting on a person.
 *   3. **ready**     — work is available to start.
 *   4. **setup**     — the project cannot produce work yet.
 *
 * Within a tier, ties break by project name, so the list is stable across
 * renders rather than reshuffling on every load.
 *
 * ## What is deliberately absent
 *
 * **Merge-readiness.** "This change could merge right now" would be a strong
 * attention item, and it is not here: deciding it requires a live GitHub
 * preflight per change (`getMergeCard`), and a dashboard that made an external
 * call per project is the cost this whole read model is shaped to avoid. The
 * Prepared route answers it, freshly, where it matters.
 *
 * **Deep Scan, outcome and measurement prompts.** Each needs per-project state
 * the dashboard does not load. Adding them means adding reads, and they are
 * not urgent enough to justify that.
 */

export type AttentionTier = "blocked" | "decision" | "ready" | "setup";

export type AttentionKind =
  | "validation_failed"
  | "prepared_waiting"
  | "moves_waiting"
  | "never_audited"
  | "no_repository";

export type AttentionItem = {
  /** Stable across renders — safe as a React key and in tests. */
  id: string;
  kind: AttentionKind;
  tier: AttentionTier;
  projectId: string;
  projectName: string;
  title: string;
  /** One sentence saying what Vibe observed. Never a promise. */
  detail: string;
  action: { label: string; href: string };
};

const TIER_ORDER: Record<AttentionTier, number> = {
  blocked: 0,
  decision: 1,
  ready: 2,
  setup: 3,
};

/** How many the dashboard shows before it stops being a dashboard. */
export const ATTENTION_DISPLAY_LIMIT = 4;

function projectHref(projectId: string, segment?: string): string {
  return segment ? `/app/projects/${projectId}/${segment}` : `/app/projects/${projectId}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * One project can raise more than one item — a project with a failed
 * validation and waiting moves genuinely needs attention twice, and hiding one
 * behind the other would mean the user never sees it.
 */
function itemsForProject(project: DashboardProject): AttentionItem[] {
  const items: AttentionItem[] = [];

  // 1. Blocked. A failed validation stops that change until someone looks.
  if (project.failedValidationCount > 0) {
    items.push({
      id: `${project.id}:validation_failed`,
      kind: "validation_failed",
      tier: "blocked",
      projectId: project.id,
      projectName: project.name,
      title: `${project.failedValidationCount} prepared ${plural(
        project.failedValidationCount,
        "change failed validation",
        "changes failed validation",
      )}`,
      detail: "Vibe built the change in an isolated environment and it did not pass.",
      action: { label: "Review change", href: projectHref(project.id, "agent") },
    });
  }

  // 2. Waiting on a person. Only changes that are not already counted as
  //    failed — otherwise one prepared change produces two items saying
  //    opposite things.
  const waiting = project.preparedCount - project.failedValidationCount;
  if (waiting > 0) {
    items.push({
      id: `${project.id}:prepared_waiting`,
      kind: "prepared_waiting",
      tier: "decision",
      projectId: project.id,
      projectName: project.name,
      title: `${waiting} prepared ${plural(waiting, "change is", "changes are")} waiting for you`,
      detail: "Nothing merges until you review and approve it.",
      action: { label: "Review change", href: projectHref(project.id, "agent") },
    });
  }

  // 3. Ready to start.
  if (project.nextMovesCount !== null && project.nextMovesCount > 0) {
    items.push({
      id: `${project.id}:moves_waiting`,
      kind: "moves_waiting",
      tier: "ready",
      projectId: project.id,
      projectName: project.name,
      title: `${project.nextMovesCount} ${plural(
        project.nextMovesCount,
        "move is",
        "moves are",
      )} waiting`,
      detail: "Vibe ranked these from your latest business audit.",
      action: { label: "Review moves", href: projectHref(project.id, "plan") },
    });
  }

  // 4. Setup. A project with no repository can do nothing at all, so it is
  //    reported instead of — not alongside — "never audited": telling someone
  //    to run an audit they cannot run is a dead end.
  if (project.repositoryFullName === null) {
    items.push({
      id: `${project.id}:no_repository`,
      kind: "no_repository",
      tier: "setup",
      projectId: project.id,
      projectName: project.name,
      title: "No repository connected",
      detail: "Vibe needs a repository before it can analyse anything.",
      action: { label: "Finish setup", href: projectHref(project.id) },
    });
  } else if (project.scoreState === "not_audited") {
    items.push({
      id: `${project.id}:never_audited`,
      kind: "never_audited",
      tier: "setup",
      projectId: project.id,
      projectName: project.name,
      title: "Never analysed",
      detail: "A business audit is what produces a score and the moves that follow from it.",
      action: { label: "Run audit", href: projectHref(project.id, "health") },
    });
  }

  return items;
}

export function buildAttentionItems(projects: DashboardProject[]): AttentionItem[] {
  return projects
    .flatMap(itemsForProject)
    .sort((a, b) => {
      const tier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
      if (tier !== 0) return tier;
      // Stable within a tier: the same input always renders the same order.
      const name = a.projectName.localeCompare(b.projectName);
      return name !== 0 ? name : a.kind.localeCompare(b.kind);
    });
}
