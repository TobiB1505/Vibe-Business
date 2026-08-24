"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { requireSession } from "@/modules/auth/session";
import { getAuditReadiness } from "@/modules/business-audit/service";
import { inspectLiveProduct, type InspectLiveFailureCode } from "@/modules/live-product-intelligence/service";
import { auditSurface, canCompleteOnboarding } from "@/modules/onboarding/audit-surface";
import {
  completeProjectOnboarding,
  getProjectOnboarding,
  markOnboardingMilestone,
  setLiveSiteStatus,
} from "@/modules/onboarding/store";
import type { OperationFailureCode } from "@/modules/operations/failures";
import {
  startBusinessAuditOperation,
  startOpportunityOperation,
  startProductUnderstandingOperation,
} from "@/modules/operations/service";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import { EDITABLE_FIELDS } from "@/modules/product-understanding/schema";
import {
  confirmProfile,
  getProfileById,
  sanitizeCorrections,
  saveCorrections,
} from "@/modules/product-understanding/store";
import { setProductionUrl, type SetProductionUrlFailure } from "@/modules/projects/production-url";
import { inspectRepository, type InspectFailureCode } from "@/modules/repository-intelligence/service";

const onboardingHref = (projectId: string) => `/app/onboarding/${projectId}`;

export type BeginUnderstandingState =
  /**
   * `alreadyRunning` distinguishes "a new run started" from "the run you were
   * already waiting on is still the one you are waiting on" (UI-S1 §14). Both
   * are successes, but only one of them is worth telling a founder who has just
   * pressed Try again on a run that appeared to have stopped — otherwise the
   * screen redraws identically and the button looks broken.
   */
  | { ok: true; alreadyRunning?: boolean }
  | { ok: false; step: "url"; error: SetProductionUrlFailure }
  | { ok: false; step: "repository"; error: InspectFailureCode }
  | { ok: false; step: "live"; error: InspectLiveFailureCode }
  | { ok: false; step: "understanding"; error: OperationFailureCode }
  | null;

async function startUnderstandingFromStoredSources(
  projectId: string,
): Promise<BeginUnderstandingState> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await startProductUnderstandingOperation(
    supabase,
    new VercelWorkflowExecutor(),
    { projectId, userId: session.userId },
  );
  if (outcome.kind === "failed") {
    return { ok: false, step: "understanding", error: outcome.error };
  }

  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId,
    eventType: "onboarding.product_understanding_started",
    metadata: { projectId, reused: outcome.kind === "reused" },
  });
  revalidatePath(onboardingHref(projectId));
  return { ok: true, alreadyRunning: outcome.kind === "active" };
}

export async function beginUnderstandingAction(
  projectId: string,
  _previous: BeginUnderstandingState,
  formData: FormData,
): Promise<BeginUnderstandingState> {
  const session = await requireSession();
  const supabase = await createClient();
  const choice = formData.get("liveSiteChoice");
  const rawUrl = formData.get("productionUrl");

  if (choice !== "provided" && choice !== "no_live_site_yet") {
    return { ok: false, step: "url", error: "empty" };
  }

  if (choice === "provided") {
    const saved = await setProductionUrl(supabase, {
      projectId,
      userId: session.userId,
      rawUrl: typeof rawUrl === "string" ? rawUrl : "",
    });
    if (!saved.ok) return { ok: false, step: "url", error: saved.error };
    await setLiveSiteStatus(supabase, { projectId, status: "provided" });
    await recordAuditEvent(supabase, {
      userId: session.userId,
      projectId,
      eventType: "onboarding.live_site_added",
      metadata: { projectId },
    });
  } else {
    await setLiveSiteStatus(supabase, { projectId, status: "no_live_site_yet" });
    await recordAuditEvent(supabase, {
      userId: session.userId,
      projectId,
      eventType: "onboarding.live_site_skipped",
      metadata: { projectId, reason: "no_live_site_yet" },
    });
  }

  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId,
    eventType: "onboarding.product_scan_started",
    metadata: { projectId, sourceProvider: "github", includesLiveSite: choice === "provided" },
  });

  const repository = await inspectRepository(supabase, { projectId, userId: session.userId });
  if (!repository.ok) return { ok: false, step: "repository", error: repository.error };

  if (choice === "provided") {
    const live = await inspectLiveProduct(supabase, { projectId, userId: session.userId });
    if (!live.ok) {
      await setLiveSiteStatus(supabase, { projectId, status: "scan_failed" });
      revalidatePath(onboardingHref(projectId));
      return { ok: false, step: "live", error: live.error };
    }
  }

  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId,
    eventType: "onboarding.product_scan_completed",
    metadata: { projectId, sourceProvider: "github", includesLiveSite: choice === "provided" },
  });

  return startUnderstandingFromStoredSources(projectId);
}

export async function continueWithoutLiveSiteAction(
  projectId: string,
  _previous: BeginUnderstandingState,
  _formData: FormData,
): Promise<BeginUnderstandingState> {
  const session = await requireSession();
  const supabase = await createClient();
  await setLiveSiteStatus(supabase, { projectId, status: "no_live_site_yet" });
  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId,
    eventType: "onboarding.live_site_skipped",
    metadata: { projectId, reason: "scan_unavailable" },
  });
  return startUnderstandingFromStoredSources(projectId);
}

/**
 * "I don't have a live product yet", said at the audit step (UI-S1 §10).
 *
 * ## Why this is not `continueWithoutLiveSiteAction`
 *
 * Because that one starts Product Understanding, and by the time a founder
 * reaches the audit step their product is already understood and confirmed.
 * Reusing it would spend an inference call on work that is already done, to
 * answer a question about a *different* step — and Vibe never starts paid work
 * on the user's behalf as a side effect of them saying "not yet".
 *
 * So this writes one canonical fact and nothing else. What it means for the
 * audit is then derived by `auditSurface`, not stored: no second flag, no
 * completion boolean, nothing that can disagree with the record.
 */
export async function parkLiveProductAction(projectId: string): Promise<void> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!project) return;

  await setLiveSiteStatus(supabase, { projectId, status: "no_live_site_yet" });
  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId,
    eventType: "onboarding.live_site_skipped",
    metadata: { projectId, reason: "audit_parked" },
  });
  revalidatePath(onboardingHref(projectId));
}

export async function retryProductScanAction(
  projectId: string,
  _previous: BeginUnderstandingState,
  _formData: FormData,
): Promise<BeginUnderstandingState> {
  const session = await requireSession();
  const supabase = await createClient();
  const repository = await inspectRepository(supabase, { projectId, userId: session.userId });
  if (!repository.ok) return { ok: false, step: "repository", error: repository.error };
  return startUnderstandingFromStoredSources(projectId);
}

export type ConfirmAndAuditState =
  | { ok: true }
  | { ok: false; error: "not_found" | OperationFailureCode }
  | null;

async function startFirstAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: { projectId: string; userId: string },
): Promise<ConfirmAndAuditState> {
  const audit = await startBusinessAuditOperation(supabase, new VercelWorkflowExecutor(), params);
  if (audit.kind === "failed") {
    revalidatePath(onboardingHref(params.projectId));
    return { ok: false, error: audit.error };
  }
  if (audit.kind === "started") {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      projectId: params.projectId,
      eventType: "onboarding.audit_started",
      metadata: { projectId: params.projectId },
    });
  }
  revalidatePath(onboardingHref(params.projectId));
  return { ok: true };
}

export async function confirmProductAndStartAuditAction(
  projectId: string,
  profileId: string,
): Promise<ConfirmAndAuditState> {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!project) return { ok: false, error: "not_found" };

  const profile = await getProfileById(supabase, profileId);
  if (!profile || profile.projectId !== projectId || profile.status !== "completed") {
    return { ok: false, error: "not_found" };
  }
  const changed = await confirmProfile(supabase, { projectId, profileId });
  const firstConfirmation = await markOnboardingMilestone(supabase, {
    projectId,
    milestone: "product_revealed_at",
  });
  if (changed) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      projectId,
      eventType: "product_understanding.confirmed",
      metadata: { projectId, profileId },
    });
  }
  if (firstConfirmation) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      projectId,
      eventType: "onboarding.product_confirmed",
      metadata: { projectId, profileId },
    });
  }

  return startFirstAudit(supabase, { projectId, userId: session.userId });
}

export async function correctProductAndStartAuditAction(
  projectId: string,
  profileId: string,
  _previous: ConfirmAndAuditState,
  formData: FormData,
): Promise<ConfirmAndAuditState> {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!project) return { ok: false, error: "not_found" };

  const profile = await getProfileById(supabase, profileId);
  if (!profile || profile.projectId !== projectId || profile.status !== "completed") {
    return { ok: false, error: "not_found" };
  }

  const raw: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") raw[field] = value;
  }
  const corrections = sanitizeCorrections(raw);
  await saveCorrections(supabase, { projectId, corrections });
  await confirmProfile(supabase, { projectId, profileId });
  const firstConfirmation = await markOnboardingMilestone(supabase, {
    projectId,
    milestone: "product_revealed_at",
  });
  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId,
    eventType: "product_understanding.corrected",
    metadata: { projectId, profileId, fields: Object.keys(corrections) },
  });
  if (firstConfirmation) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      projectId,
      eventType: "onboarding.product_confirmed",
      metadata: { projectId, profileId, corrected: true },
    });
  }
  return startFirstAudit(supabase, { projectId, userId: session.userId });
}

export async function revealAuditAndFindFirstMoveAction(projectId: string): Promise<void> {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!project) return;
  const { data: audit } = await supabase
    .from("business_readiness_audits")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!audit) return;
  const firstReveal = await markOnboardingMilestone(supabase, {
    projectId,
    milestone: "audit_revealed_at",
  });

  const outcome = await startOpportunityOperation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    // Part of the flow that delivers the free first audit, so it is free
    // (BILLING CORE-2 §40, CREDIT_ECONOMICS.md §Free usage). Charging a
    // brand-new user here would spend Credits they have not met yet, inside a
    // flow they did not choose to pay for.
    requestedBy: "bundled_with_free_audit",
  });
  // Opportunity generation is deliberately not a completion blocker. A real
  // result will be shown if it exists; otherwise the honest fallback remains.
  if (outcome.kind !== "failed" && firstReveal) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      projectId,
      eventType: "onboarding.first_move_started",
      metadata: { projectId, reused: outcome.kind === "reused" },
    });
  }
  revalidatePath(onboardingHref(projectId));
}

/**
 * Finishing setup (UI-S1 §12).
 *
 * ## Two terminal paths, not one
 *
 * The original guard allowed exactly one: the founder saw their first Move.
 * That made a founder with no live product permanently ineligible to finish,
 * because the audit their first Move comes from cannot run without a live
 * product to compare against — so the guard, not the screen, was the trap.
 *
 * The second path is a parked audit, and it is re-derived here from the
 * canonical records rather than trusted from the page. A button is a request;
 * whether it is allowed is decided on the server, against the same predicate
 * that decided whether to draw it.
 */
export async function completeOnboardingAction(projectId: string): Promise<void> {
  const session = await requireSession();
  const supabase = await createClient();
  const onboarding = await getProjectOnboarding(supabase, {
    projectId,
    userId: session.userId,
  });
  if (!onboarding) redirect(onboardingHref(projectId));

  const surface =
    onboarding.state === "audit_preparing"
      ? auditSurface({
          auditOperationActive: onboarding.auditOperation !== null,
          liveSiteStatus: onboarding.liveSiteStatus,
          hasLiveProductIntelligence: (await getAuditReadiness(supabase, projectId))
            .hasLiveProductIntelligence,
        })
      : null;

  const allowed = canCompleteOnboarding({
    state: onboarding.state,
    firstMoveViewed: onboarding.firstMoveViewedAt !== null,
    surface,
  });
  if (!allowed) redirect(onboardingHref(projectId));

  await completeProjectOnboarding(supabase, {
    projectId,
    userId: session.userId,
    // Recorded so the activity trail distinguishes "finished with an audit"
    // from "finished with the audit parked". They are different outcomes and
    // the log should not flatten them into one.
    auditParked: surface === "parked_no_live_product",
  });
  /*
   * The account dashboard, not the product workspace.
   *
   * Onboarding used to hand a founder straight into `/app/projects/{id}`,
   * which meant nobody had ever seen `/app` after finishing setup — the screen
   * that exists to say where everything stands was reachable only by typing
   * the URL or by clicking the logo. Landing here is also what makes a second
   * product discoverable: the workspace has no route to the level above it
   * except the rail's own exit.
   */
  redirect("/app");
}
