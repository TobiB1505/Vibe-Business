import { novaCandidateMessage } from "@/modules/nova/feed";
import { readNovaFocus } from "@/modules/nova/read";
import type { FocusCandidate } from "@/modules/nova/focus";
import { boundToolResult, strictObject, type AgentTool } from "./registry";

/**
 * `get_project_focus` — Vibe's own deterministic answer, handed to the model.
 *
 * ## Why this is the first tool the skill calls
 *
 * `deriveNovaFocus` already answers "what needs attention now" from rows, by
 * rules nobody's judgement is involved in. A model that re-ranks from an audit
 * and a Move list has produced a second opinion Vibe never sanctioned; a model
 * that starts here is reading the product's answer and explaining it. The
 * ranking stays the product's.
 *
 * ## Every candidate carries its subject id
 *
 * The seam pilot's first paid run failed on a focus that named a kind and no
 * id: the model had nothing to pass onward and invented identifiers until the
 * ceiling stopped the turn. So the rendering below carries the id of whatever
 * the candidate is about — a Move, a prepared change, a question — and the ids
 * are also returned separately, which is what lets the reply validator refuse a
 * reference to anything this turn did not read.
 */

function subjectOf(candidate: FocusCandidate): { id: string | null; label: string | null } {
  if ("move" in candidate) return { id: candidate.move.id, label: candidate.move.title };
  if ("preparedChangeId" in candidate) {
    return { id: candidate.preparedChangeId, label: candidate.headline };
  }
  if ("founderInputRequestId" in candidate) {
    return { id: candidate.founderInputRequestId, label: candidate.question };
  }
  if ("stepTitle" in candidate) return { id: null, label: candidate.stepTitle };
  return { id: null, label: null };
}

function renderCandidate(candidate: FocusCandidate): string {
  const subject = subjectOf(candidate);
  const parts = [`kind: ${candidate.kind}`, `means: ${novaCandidateMessage(candidate.kind)}`];
  if (subject.id) parts.push(`id: ${subject.id}`);
  if (subject.label) parts.push(`about: ${subject.label}`);
  return parts.join("\n  ");
}

export const getProjectFocusTool: AgentTool = {
  name: "get_project_focus",
  description:
    "What needs the founder's attention now, ranked by Vibe's own deterministic rules, what else is true, and whether something is already running. Every entry carries the id of the thing it is about. Call this first when the founder asks what to do next. Free.",
  inputSchema: strictObject({}),
  classification: "read_only",
  progressLabel: "Checking what needs attention",
  async execute(context) {
    let focus;
    try {
      focus = await readNovaFocus(context.supabase, context.projectId, context.userId);
    } catch {
      return {
        kind: "error",
        code: "read_failed",
        message: "The attention ranking could not be read. Answer from what you have.",
      };
    }

    const lines = [
      `attention_now:\n  ${renderCandidate(focus.primary)}`,
      focus.secondary.length > 0
        ? `also_true:\n${focus.secondary.map((candidate) => `  ${renderCandidate(candidate)}`).join("\n")}`
        : "also_true: (nothing else)",
      `running_now: ${focus.working ? focus.working.type : "(nothing)"}`,
    ];

    const subjectIds = [focus.primary, ...focus.secondary]
      .map((candidate) => subjectOf(candidate).id)
      .filter((id): id is string => id !== null);

    return {
      kind: "ok",
      content: boundToolResult(lines.join("\n")),
      subjectIds,
      artifacts: [],
    };
  },
};
