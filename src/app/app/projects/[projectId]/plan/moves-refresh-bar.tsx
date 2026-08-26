"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CreditPrice } from "@/components/ui/credit-price";
import { RefreshIcon } from "@/components/ui/dashboard-icons";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import {
  startOpportunitiesAction,
  type StartOpportunitiesActionState,
} from "../opportunities-action";

/**
 * When this plan was worked out, and how to work it out again (ACTION PLAN UI-2).
 *
 * Two things sit together here because they answer the same question: *is this
 * still current?* The timestamp is the set's own `generatedAt`, rendered in UTC
 * so a machine time never claims to be the reader's local one, and the control
 * beside it is the existing refresh — which spends Credits, and therefore
 * states its price before the click rather than after it.
 *
 * A started run is not merged into this component's own state: the body of the
 * page owns the operation, so a successful start refreshes the route and lets
 * the server hand the whole page one answer. Two components polling two copies
 * of the same run is how a screen ends up disagreeing with itself.
 */
export function MovesRefreshBar({
  projectId,
  generatedAt,
  hasOpportunities,
  blocked,
}: {
  projectId: string;
  /** The set's own generation time, or null before one exists. */
  generatedAt: string | null;
  hasOpportunities: boolean;
  /**
   * Generation cannot run right now — no audit, or one that has been
   * superseded. The control is absent rather than disabled: the page already
   * explains why and offers the one thing that unblocks it, and a dead button
   * beside that explanation is a second, worse answer to the same question.
   */
  blocked: boolean;
}) {
  const router = useRouter();
  const action = startOpportunitiesAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<StartOpportunitiesActionState, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {generatedAt && (
        <p className="text-fg-muted text-ui">
          Last updated{" "}
          <span className="text-fg-secondary tabular-nums">{formatGeneratedAt(generatedAt)}</span>
        </p>
      )}
      {!blocked && (
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="force" value={hasOpportunities ? "true" : "false"} />
        <Button type="submit" variant="secondary" size="sm" disabled={pending} busy={pending}>
          {!pending && <RefreshIcon size={15} />}
          {pending ? "Starting…" : hasOpportunities ? "Re-scan business" : "Find my next moves"}
        </Button>
        <CreditPrice operation="opportunity_generation" />
      </form>
      )}
      {state && !state.ok && (
        <p role="alert" className="text-amber text-ui">
          {OPERATION_FAILURE_MESSAGES[state.error]}
        </p>
      )}
    </div>
  );
}

/**
 * A machine timestamp, rendered in UTC.
 *
 * The product's own rule: deterministic machine timestamps render in UTC
 * (`UX-CONTRACT.md`). No "2 days ago" — a relative time computed in the browser
 * disagrees with the server-rendered one for a frame, and the exact date is
 * what a founder needs in order to judge whether a plan predates a change they
 * made.
 */
function formatGeneratedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
