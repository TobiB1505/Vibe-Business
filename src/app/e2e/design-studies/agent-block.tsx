"use client";

import {
  AgentFileActivity,
} from "@/app/app/projects/[projectId]/agent/agent-file-activity";
import {
  AgentValidationChecks,
  type ValidationCheck,
} from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import type { StoredExecutionEvent } from "@/modules/coding-agent/observability/events";

/**
 * The Agent, inside a render block.
 *
 * ## Two records, and only one of them is kept
 *
 * This is the block where the distinction the dissolving lines rest on becomes
 * visible, because both halves are on screen at once.
 *
 * The **stages** above are transient. `OPERATION_STAGE_LABELS[stage]` is a
 * column on the operation row that is overwritten as the run moves, and the
 * log records that a run started and that it finished — nothing in between. So
 * those lines fade and go, and a surface that kept them would be inventing a
 * history the product does not have.
 *
 * The **file events** below are not transient. `StoredExecutionEvent` rows are
 * written as the agent works and they stay — which is why they are rendered by
 * the shipped component that already knows how to show them, with its own
 * ordering, its own disclosure past the limit, and its own pulse.
 *
 * Same block, same moment, two kinds of truth. One dissolves because it was
 * never written down; the other does not, because it was.
 *
 * ## How each is composed
 *
 * `AgentValidationChecks` has no frame of its own, so it needed no variant —
 * it drops straight into a block. `AgentFileActivity` did, and got the same
 * `block` variant the Product Scan has, for the same reason: the render block
 * already is a panel, and two frames around one object is the tell that
 * something was pasted rather than composed.
 */
export function AgentWorking({ events }: { events: readonly StoredExecutionEvent[] }) {
  return (
    <AgentFileActivity
      events={events}
      /* Four, not six. A thread block is a glance; the workspace is where a
         founder reads the whole run, and the disclosure still says how many
         more there are. */
      limit={4}
      title="Files touched"
      live
      variant="block"
    />
  );
}

export function AgentChecks({ checks }: { checks: readonly ValidationCheck[] }) {
  return <AgentValidationChecks checks={checks} />;
}
