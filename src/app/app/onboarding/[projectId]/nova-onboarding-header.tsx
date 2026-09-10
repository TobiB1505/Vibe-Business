import { NovaClock } from "@/components/nova/nova-clock";
import { NovaPresence } from "@/components/nova/nova-presence";
import { NovaThreadHeader } from "@/components/nova/nova-thread";
import { novaPresenceState, statusForFocusTier } from "@/components/system/status-vocabulary";
import { NOVA_ONBOARDING_TIER } from "@/modules/nova/onboarding";
import type { OnboardingState } from "@/modules/onboarding/state";
import { OPERATION_STAGE_LABELS, operationPollPhase } from "@/modules/operations/view";
import type { OperationView } from "@/modules/operations/view";

/**
 * The row Nova lives in, during setup.
 *
 * ## Why setup gets the same header as Home
 *
 * Because the opening builds it. The mark assembles alone, travels into this
 * row, and the room is drawn around it — that choreography is Nova assembling
 * the environment she then works in, and it only means anything if the
 * environment is still there afterwards. A founder who watched the mark settle
 * into a status row and then met a page with a logo and a four-step progress
 * list would have watched something be built and immediately thrown away.
 *
 * So it is the same component Home mounts, not a copy: the same glass, the same
 * dot, the same word, the same clock, the same project and connection.
 *
 * ## What is derived rather than passed
 *
 * All of it. The word is `statusForFocusTier(NOVA_ONBOARDING_TIER[state])`
 * where nothing is running and the operation's own stage where something is —
 * the same rule Home's header follows, so this row cannot describe the moment
 * differently from the bubble under it. The mark's state comes from
 * `novaPresenceState`, which is the only function allowed to decide it.
 *
 * ## Why it does not poll
 *
 * Home's header polls because Home is otherwise static. Setup is not: the scan
 * and the audit each mount their own watcher, and both refresh this route when
 * their operation settles. A second timer here would be a third component
 * asking the same question — which is the shape this project keeps removing.
 */
export function NovaOnboardingHeader({
  state,
  projectId,
  projectName,
  /** Whether the repository behind that name is reachable. Null before one is. */
  connected,
  /**
   * The run in flight, when one is.
   *
   * Either the scan's or the audit's — one setup state has at most one, which
   * is why this is a single operation rather than a list to choose from.
   */
  operation,
}: {
  state: OnboardingState;
  projectId: string;
  projectName: string;
  connected: boolean;
  operation: OperationView | null;
}) {
  const phase = operationPollPhase(operation);
  const resting = statusForFocusTier(NOVA_ONBOARDING_TIER[state]);

  return (
    <NovaThreadHeader
      availability={{ state: "online" }}
      /*
        The stage a run actually wrote, or the word for the state. Both come
        from tables the domain owns; neither is a sentence written here.
      */
      status={
        operation && phase === "working"
          ? { word: OPERATION_STAGE_LABELS[operation.stage], tone: "active" }
          : { word: resting.word, tone: resting.tone }
      }
      subject={projectName}
      connected={connected}
      mark={
        <NovaPresence
          state={novaPresenceState({ tier: NOVA_ONBOARDING_TIER[state], phase })}
          /* The project, so one product always draws the same mark — including
             across the seam from setup into Home. */
          seed={projectId}
        />
      }
      now={<NovaClock />}
    />
  );
}
