import type { ReactNode } from "react";
import { AgentWorkspaceChoice } from "@/app/app/projects/[projectId]/agent/agent-workspace-choice";
import type { WorkspaceCandidate } from "@/modules/validation/profile";

/**
 * Which application Vibe works on, chosen in the thread.
 *
 * `AgentWorkspaceChoice` splits the same two halves as the question panel: it
 * renders the candidates and takes one control *per candidate* from the
 * caller. So the list travels and the choosing stays behind — and the notice
 * it carries travels with it, which matters more than it looks. "Choosing is
 * free and you can change it later. Nothing starts running" is the sentence
 * that stops a founder reading this as the moment a priced run begins, and a
 * block that rebuilt the list would have had to remember to write it.
 */
export function WorkspaceAskBlock({
  candidates,
  chosen,
  action,
}: {
  candidates: readonly WorkspaceCandidate[];
  chosen?: string | null;
  /**
   * One submit control per candidate, from whoever can perform the choice.
   *
   * `AgentWorkspaceChoiceAction` in the product, which binds the directory as
   * an argument so there is no field for anything else to arrive in. Required
   * rather than optional, and that is the point: a render prop cannot cross
   * from a server component to a client one, so whoever supplies the control
   * has to be a client component. A default would have let a caller mount a
   * choice nobody can make.
   */
  action: (candidate: WorkspaceCandidate) => ReactNode;
}) {
  return <AgentWorkspaceChoice candidates={candidates} chosen={chosen} action={action} />;
}
