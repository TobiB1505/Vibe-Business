import type { SupabaseClient } from "@supabase/supabase-js";
import { getActionPlanById } from "@/modules/action-plans/store";
import { getOpportunityById } from "@/modules/opportunities/store";
import type { ExecutionSpec } from "./spec";

/**
 * The Move a spec descends from, in the two ids a prepared change stores.
 *
 * ## Why this exists
 *
 * Because the lineage was known and thrown away, and a founder found out.
 *
 * `prepared_changes` carries `opportunity_set_id` and `opportunity_id`, and
 * the card builder turns them into the block that says *what this change was
 * for*. The deterministic path fills them. The agent's branch step wrote both
 * as null with a reason — *"an agentic change traces to a plan step, not to an
 * opportunity set"* — which is true about the **authority** for an agentic run
 * and was read as though the Move were unknown. It is not: `ExecutionSpec`
 * carries `opportunityId` and its own field comment says why it is there,
 * *"so lineage survives into execution"*.
 *
 * So every change the product makes reached a founder's screen naming nothing
 * it was for — a branch name, a file count, and a bordered empty band where
 * the reason should have been.
 *
 * ## Why the set comes from the plan
 *
 * `getOpportunityById` scopes by set, and the scope is the point rather than a
 * disambiguator: a Move is a uuid, so the set does not make the lookup unique,
 * it makes it **correct** — this Move has to be one the plan's own set holds.
 * The spec does not carry the set; the action plan it names does, on the row.
 * Two reads, and only when a change is actually being claimed.
 *
 * ## Why the Move is read rather than copied
 *
 * Because the two columns are not the same kind of identifier, and writing the
 * spec's value straight through would have taken the agent down.
 *
 * `execution_specs.opportunity_id` is **text**, and a spec may legitimately
 * carry one that names no stored Move at all — an internal benchmark's is a
 * fixture key. `prepared_changes.opportunity_id` is a **uuid with a foreign
 * key** to `business_opportunities`. So an unverified copy either fails the
 * cast or fails the key, and it fails it inside `claimPreparedChange`, which
 * means a run that had already written a branch would end as
 * `change_preparation_failed`.
 *
 * Reading the Move first is what makes the write safe by construction: the row
 * comes back or it does not, and not finding it is an ordinary answer rather
 * than an error. It also checks the thing that actually matters — that the
 * Move belongs to the plan's set — which no cast would have.
 *
 * The spec's id is the one looked up, never the plan's, even though they are
 * equal by construction: `buildExecutionSpec` copies `plan.opportunityId` into
 * the spec, and the spec is what the run was authorized against. If a plan
 * were reworded underneath a running spec the lookup simply misses, and the
 * surface draws nothing rather than a Move this change did not come from.
 *
 * Null for an internal benchmark step, which has no plan row at all and never
 * will — its fixture lives in Vibe's own code.
 */
export type SpecLineage = {
  opportunitySetId: string;
  opportunityId: string;
};

export async function resolveSpecLineage(
  supabase: SupabaseClient,
  spec: ExecutionSpec,
): Promise<SpecLineage | null> {
  /*
   * A missing or unreadable plan is not a failure of the run. The change is
   * still prepared, it simply records no Move — which is exactly the state the
   * columns are nullable for, and the state every change written before this
   * existed is in.
   */
  const plan = await getActionPlanById(supabase, spec.actionPlanId).catch(() => null);
  if (!plan) return null;

  /*
   * Read, never cast. A spec id that is not a uuid makes this throw inside
   * PostgREST rather than return nothing, which is why the catch is here and
   * not a validation regex: either way the answer is "no Move recorded", and
   * that is a state the column and the constraint both allow.
   */
  const move = await getOpportunityById(supabase, {
    setId: plan.opportunitySetId,
    opportunityId: spec.opportunityId,
  }).catch(() => null);
  if (!move) return null;

  return { opportunitySetId: plan.opportunitySetId, opportunityId: move.id };
}
