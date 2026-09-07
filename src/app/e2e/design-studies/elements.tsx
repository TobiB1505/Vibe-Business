/**
 * The thread's vocabulary, as the studies name it.
 *
 * ## Why this file is now almost empty
 *
 * Every element here was written in the lab and argued out in the sheets
 * beside it. When Nova Home began rendering them they moved to
 * `src/components/nova/` — a component the product renders may not live under
 * `e2e/`, and two copies of one bubble is how a lab stops being an answer to
 * anything.
 *
 * So the studies keep their short names and the product keeps its explicit
 * ones, and both draw the same components. A change to the Move's hover, the
 * block's frame or the header's status row shows up in the lab because it *is*
 * the lab's Move, block and header.
 */

export { NovaBubble as Bubble } from "@/components/nova/nova-bubble";
export {
  NovaMove as Move,
  NovaMoves as Moves,
  novaMoveShowsCost as moveShowsCost,
} from "@/components/nova/nova-move";
export {
  NovaLine as Line,
  NovaAside as Context,
  NovaThreadHeader as Header,
  NovaHappened as Happened,
  NovaThinking as Thinking,
  NovaRenderBlock as RenderBlock,
  NovaDissolving as Dissolving,
  type NovaAvailability,
} from "@/components/nova/nova-thread";
