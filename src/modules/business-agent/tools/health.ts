import { FRESHNESS_LABELS, freshnessOf } from "@/modules/nova/briefing/freshness";
import { readBusinessHealth } from "@/modules/projects/business-health-read";
import { boundToolResult, strictObject, type AgentTool } from "./registry";

/**
 * `get_business_health` — the Business Audit reading, and how old it is.
 *
 * ## The three states are three different answers
 *
 * No audit, an outdated one, and a current one lead the skill somewhere
 * different, so the rendering says which it is before it says anything else.
 * A reading that cannot be scored says *why* it cannot — `insufficientCoverage
 * Reason` is a sentence the audit produced and the Brain once rendered as an em
 * dash — because rule 44's "missing evidence is never a bad result" is only
 * kept if the reason crosses the boundary with the `null`.
 *
 * ## Age is a bucket, not a number
 *
 * `freshnessOf` returns "months ago", not "94 days". A model's sentence is
 * persisted and read later, and a number inside a persisted sentence is a lie
 * with a delay on it (`nova/briefing/freshness.ts`). The raw timestamp is not
 * sent either, for the same reason: nothing here should let the model compute
 * an age it can write down.
 *
 * ## What is deliberately not sent
 *
 * Per-lens internal prose, the relationship graph, the score history and the
 * evidence bodies. The model gets the overall state, the lenses that are
 * unhealthy, the ranked priorities with their evidence *labels*, and the
 * strengths. Everything else is a drill-down the thread reaches through the
 * canonical screen.
 */
export const getBusinessHealthTool: AgentTool = {
  name: "get_business_health",
  description:
    "The latest Business Audit reading: the overall state or the reason there is none, which areas are weakest, the ranked priorities with the evidence behind them, the strengths, and how old the reading is. Free.",
  inputSchema: strictObject({}),
  classification: "read_only",
  progressLabel: "Reading your Business Health",
  async execute(context) {
    let health;
    try {
      health = await readBusinessHealth(context.supabase, { projectId: context.projectId });
    } catch {
      return {
        kind: "error",
        code: "read_failed",
        message: "The Business Audit reading could not be read. Answer from what you have.",
      };
    }

    if (!health.hasAudit) {
      return {
        kind: "ok",
        content: "state: no_audit_has_run\nThere is no Business Audit for this project yet.",
        subjectIds: [],
        artifacts: [],
      };
    }

    const view = health.view;
    if (!view) {
      return {
        kind: "ok",
        content:
          "state: audit_without_reading\nAn audit ran but produced no reading, so there is nothing to rank.",
        subjectIds: health.auditId ? [health.auditId] : [],
        artifacts: [],
      };
    }

    const age = freshnessOf(health.producedAt, new Date());
    const lines: string[] = [
      `state: ${health.currency.upToDate ? "current" : "outdated"}`,
      `produced: ${age ? FRESHNESS_LABELS[age] : "unknown"}`,
      health.currency.newDeepScanEvidence
        ? "note: evidence has been gathered since this reading was produced"
        : null,
      view.overall.score === null
        ? `overall: not scored — ${view.overall.insufficientCoverageReason ?? "the evidence did not support a score"}`
        : `overall: ${view.overall.stateLabel} (${view.overall.score} out of a possible 100, from ${view.overall.scoredLenses} of ${view.overall.eligibleLenses} areas)`,
      view.overall.summary ? `summary: ${view.overall.summary}` : null,
    ].filter((line): line is string => line !== null);

    /*
     * "weak" and "unclear" are different answers and both belong here: one is
     * a finding and the other is a gap, and a founder who is told only about
     * findings will read silence about the gaps as health. "blocked_by_missing
     * _context" is the third, and it is the audit saying it could not look.
     */
    const weak = view.nodes.filter(
      (node) => node.health !== "strong" && node.health !== "adequate",
    );
    lines.push(
      weak.length > 0
        ? `areas_needing_attention: ${weak.map((node) => `${node.label} (${node.healthLabel})`).join(", ")}`
        : "areas_needing_attention: (none)",
    );

    const unscored = view.nodes.filter((node) => node.score === null);
    if (unscored.length > 0) {
      lines.push(
        `areas_not_assessed: ${unscored.map((node) => node.label).join(", ")} — these were not scored and are not counted as bad`,
      );
    }

    if (view.priorities.length === 0) {
      lines.push("priorities: (none ranked)");
    } else {
      lines.push("priorities:");
      for (const priority of view.priorities.slice(0, 4)) {
        lines.push(`  ${priority.rank}. ${priority.headline}`);
        lines.push(`     why: ${priority.whyItMatters ?? priority.explanation}`);
        if (priority.evidence.length > 0) {
          lines.push(
            `     evidence: ${priority.evidence.map((item) => `${item.detail} (${item.source})`).join("; ")}`,
          );
        }
        if (priority.move) lines.push(`     move: ${priority.move.title}`);
      }
    }

    if (health.strengths.length > 0) {
      lines.push(`strengths: ${health.strengths.map((item) => item.headline).join("; ")}`);
    }

    return {
      kind: "ok",
      content: boundToolResult(lines.join("\n")),
      subjectIds: health.auditId ? [health.auditId] : [],
      artifacts: health.auditId ? [{ kind: "audit", subjectId: health.auditId }] : [],
    };
  },
};
