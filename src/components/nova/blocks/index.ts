/**
 * The render blocks, by the kind `BLOCK_FOR_MOMENT` names.
 *
 * ## Why a barrel here and nowhere else in this repository
 *
 * Because the registry answers in *kinds* and a screen has to get from a kind
 * to a component. Seven imports at every call site is seven places to forget
 * one; one map is the thing a total record deserves. `blocks.ts` stays free of
 * React so it can be checked without rendering anything, and this is where the
 * two halves meet.
 */

export { AuditBlock } from "./audit";
export { ScanBlock } from "./scan";
export { AgentWorking, AgentChecks } from "./agent";
export { ReviewBlock } from "./review";
export { MoveBlock } from "./move";
export { AskBlock, PlanAskBlock } from "./ask";
export { WorkspaceAskBlock } from "./workspace";
export { ProgressBlock } from "./progress";
