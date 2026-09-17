import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { BuildChainResolution } from "@/modules/execution-contract/chain";
import {
  BUILD_CHAIN_BOUNDARY_LABELS,
  buildChainOfferLabel,
  runCeilingLabel,
} from "@/modules/coding-agent/view";
import type { CreditUnits } from "@/modules/credits/units";
import { AgentStartAction } from "./agent-start-action";

/**
 * The offer to start a run, with both prices on screen.
 *
 * ## Why this is one place and not two call sites
 *
 * `startAgentRunAction` takes a step key and a `chain` boolean — build this
 * step, or build the run of steps it heads — and those are two different
 * pieces of work at two different prices. `home-view.ts` refused to put the
 * moment in Nova's thread for exactly that reason: *"offering one of them here
 * would be offering half a decision at a price the founder was not shown the
 * alternative to."*
 *
 * That argument is right, and the answer to it is not to override it but to
 * put both prices in the thread. Which means the offer has to be built in one
 * place: two surfaces each composing their own pair of controls is two places
 * where one of them can come to show a figure the other does not, and the
 * figure is money.
 *
 * ## Why it returns two nodes rather than rendering one tree
 *
 * Because of where they go. `AgentStartCta` clips its slot to `rounded-full`
 * and runs a highlight sweep across it, which is correct for the *one* primary
 * action and wrong for everything else — and this offer is a primary button, a
 * decline, and a sentence about where the chain stops. Handing the group to
 * the slot squeezed all three into a single pill and swept a white band
 * through the boundary line, cutting it in half. It rendered that way on the
 * Agent page from the day chains shipped, and looking at the block in a phone
 * viewport is what found it.
 *
 * So the split is the point: `primary` is the thing the sweep may wrap, and
 * `beneath` is everything that must sit outside it. A component could not say
 * that — it would have one return value and the caller would have one slot to
 * put it in.
 *
 * ## The rules it carries
 *
 * Two controls rather than a checkbox: a founder who wanted to stop after this
 * step must be able to. Both figures come from one pricing function with
 * different member sets, so the number on a button is the number that gets
 * charged. And the boundary note says why the chain stops where it does —
 * without it, a chain that ends at a payment step looks like a bug rather than
 * the refusal it is.
 *
 * When no chain resolved there is one control and nothing beneath it, which is
 * this offer exactly as it was before chains existed.
 */
export function agentStartControls({
  projectId,
  step,
  chain,
  chainMaxCredits,
  creditEstimate,
  repositoryReadHref,
}: {
  projectId: string;
  step: ActionPlanStep;
  /** The chain this step heads, or null when none resolved. */
  chain: BuildChainResolution | null;
  /** The chain's ceiling. Null when the chain is this step alone. */
  chainMaxCredits: CreditUnits | null;
  /** The single step's ceiling, already formatted by the domain. */
  creditEstimate: string | null;
  /** Where a stale-code refusal sends the founder. */
  repositoryReadHref: string;
}): { primary: React.ReactNode; beneath: React.ReactNode | null } {
  const offersChain = chain !== null && chainMaxCredits !== null;

  /*
   * Without a chain the single step *is* the primary action, so it takes the
   * sweep. With one, the chain is what is being offered and the single step is
   * the way to decline it — which is why the decline moves out of the slot
   * rather than being styled quieter inside it.
   */
  if (!offersChain) {
    return {
      primary: (
        <AgentStartAction
          projectId={projectId}
          stepKey={step.id}
          repositoryReadHref={repositoryReadHref}
        />
      ),
      beneath: null,
    };
  }

  return {
    primary: (
      <AgentStartAction
        projectId={projectId}
        stepKey={step.id}
        chain
        label={`${buildChainOfferLabel(chain.members.length)} — ${runCeilingLabel(chainMaxCredits)}`}
        repositoryReadHref={repositoryReadHref}
      />
    ),
    beneath: (
      <div className="flex w-full flex-col gap-2">
        <AgentStartAction
          projectId={projectId}
          stepKey={step.id}
          variant="secondary"
          label={creditEstimate ? `Build just this step — ${creditEstimate}` : undefined}
          repositoryReadHref={repositoryReadHref}
        />
        <p className="text-fg-meta text-caption" data-testid="agent-chain-boundary">
          {BUILD_CHAIN_BOUNDARY_LABELS[chain.boundary]}
        </p>
      </div>
    ),
  };
}
