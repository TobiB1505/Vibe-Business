"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import { measurementFailureMessage } from "@/modules/business-measurement/messages";
import type { MeasurementFailureCode } from "@/modules/business-measurement/schema";
import { NoConnectedMetricSources } from "@/modules/business-measurement/source";
import {
  ensureMeasurementPlan,
  startBusinessMeasurement,
} from "@/modules/business-measurement/service";

/**
 * The business measurement server actions (Sprint 12B §34, §36, §44).
 *
 * ## What the client can say
 *
 * A project id and a prepared change id. That is the entire surface.
 *
 * It cannot name the metric, the direction, the baseline, the windows, the
 * timezone, the sample size, the classification or the source. Not because
 * those are validated and rejected — because there is no parameter to put them
 * in (§44). Every one is resolved on the server from the capability's
 * measurement contract and the project's own recorded context.
 *
 * ## Two actions, because they cost different things
 *
 * `planMeasurement` is deterministic and free: it records what Vibe *would*
 * measure. It is safe to offer for any merged change and needs no analytics
 * connection at all — which is what lets a project with nothing connected still
 * see something true and specific rather than a blank panel.
 *
 * `startMeasurement` is the only path that could ever contact a vendor, and it
 * refuses before creating anything when no compatible source is connected.
 * Today that is every project.
 *
 * ## What neither action does
 *
 * Revert, re-merge, redeploy, re-validate, start an audit, generate
 * opportunities, or call a model. A degraded business outcome triggers no
 * consequential action of any kind — that is a decision for a human and a
 * future sprint (§28, §29, §36).
 */

export type BusinessImpactActionState =
  | { ok: true; kind: "planned" | "started" | "active" }
  | { ok: false; error: MeasurementFailureCode; message: string }
  | null;

export async function planMeasurementAction(
  projectId: string,
  preparedChangeId: string,
): Promise<NonNullable<BusinessImpactActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await ensureMeasurementPlan(supabase, {
    projectId,
    userId: session.userId,
    preparedChangeId,
  });

  if (outcome.kind === "blocked") {
    return {
      ok: false,
      error: outcome.reason,
      message: measurementFailureMessage(outcome.reason),
    };
  }

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, kind: "planned" };
}

export async function startMeasurementAction(
  projectId: string,
  preparedChangeId: string,
): Promise<NonNullable<BusinessImpactActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await startBusinessMeasurement(
    supabase,
    new VercelWorkflowExecutor(),
    // The request boundary picks the real registry; the domain stays testable
    // with doubles. Today this resolves to nothing for every project, so the
    // action refuses with `metric_source_required` before creating a row (§34).
    new NoConnectedMetricSources(),
    { projectId, userId: session.userId, preparedChangeId },
  );

  switch (outcome.kind) {
    case "started":
    case "active":
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: true, kind: outcome.kind === "started" ? "started" : "active" };
    case "blocked":
      return {
        ok: false,
        error: outcome.reason,
        message: measurementFailureMessage(outcome.reason),
      };
  }
}
