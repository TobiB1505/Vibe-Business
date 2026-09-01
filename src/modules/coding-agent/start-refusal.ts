import type {
  ExecutionAdmission,
  ExecutionResolutionReason,
} from "@/modules/execution-contract/schema";
import type { PreflightRefusal } from "./preflight";

/**
 * Why a start attempt stopped, as a value that can cross to the browser.
 *
 * ## Why this is its own module
 *
 * The vocabulary belongs to `website-preflight.ts`, which is `server-only` —
 * and the component that has to *say* the refusal is a client component. A type
 * import would be erased, but a shared enum that a client bundle depends on
 * being erased is a trap waiting for the first person who reaches for the value
 * rather than the type. So the words live here, where nothing server-only can
 * follow them, and `website-preflight.ts` re-exports them.
 *
 * ## Why the detail exists at all
 *
 * `startDogfoodRunAction` used to answer every one of these with the single
 * string `not_eligible`, rendered as *"This step is no longer eligible — the
 * page will show why above."* The page could not: its own render had resolved
 * fine, which is why the button was there to press. The fresh chain inside the
 * action found a different answer — a moved default branch, most often — and
 * threw it away.
 *
 * Everything below is a closed enum. Nothing model-authored and no free text
 * crosses this boundary (Rules 42, 57); the sentences are looked up in
 * `view.ts` from these values alone.
 */

export const DOGFOOD_STEP_REASONS = [
  /** The project is not on the operator-managed allowlist. Checked first (§26, §27). */
  "not_dogfood_eligible",
  /** No completed Action Plan exists for this project yet — a founder action. */
  "no_action_plan",
  /** The step key does not name a step in the project's current plan. */
  "step_not_found",
  /** No repository is connected to this project. */
  "repository_not_connected",
  /** Vibe has never successfully read this repository. */
  "repository_snapshot_missing",
  /** The plan is missing a field a spec cannot be built without. */
  "plan_incomplete",
  /** The step did not resolve to an executable route Vibe controls (see `resolution`). */
  "not_agentic",
  /** Resolved agentic, but the preflight itself refused (see `preflight`). */
  "preflight_refused",
] as const;
export type DogfoodStepReason = (typeof DOGFOOD_STEP_REASONS)[number];

/**
 * One refusal, carried at the finest grain that was actually established.
 *
 * The three fields narrow in the order the chain resolves them, and each is
 * present only when that stage was reached — an absent field is "this was never
 * decided", never "it passed".
 */
export type AgentStartRefusalDetail = {
  reason: DogfoodStepReason;
  /**
   * Why the step classified the way it did, when a resolution exists.
   *
   * The specific answer behind `not_agentic`: a founder decision is owed, an
   * earlier step has to finish, the risk class is not permitted.
   */
  resolutionReason?: ExecutionResolutionReason;
  /**
   * The live-state and money gates, when the step classified far enough to be
   * measured against them. `repository_head_moved` lives here.
   */
  admission?: ExecutionAdmission;
  /** The first preflight refusal, when the preflight itself is what refused. */
  preflight?: PreflightRefusal;
};
