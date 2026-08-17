"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { requireSession } from "@/modules/auth/session";
import { inspectLiveProduct, type InspectLiveFailureCode } from "@/modules/live-product-intelligence/service";
import {
  completeProjectOnboarding,
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
  | { ok: true }
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
  return { ok: true };
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

export async function completeOnboardingAction(projectId: string): Promise<void> {
  const session = await requireSession();
  const supabase = await createClient();
  const { getProjectOnboarding } = await import("@/modules/onboarding/store");
  const onboarding = await getProjectOnboarding(supabase, {
    projectId,
    userId: session.userId,
  });
  if (
    !onboarding ||
    (onboarding.state !== "first_move" && onboarding.state !== "complete") ||
    (onboarding.state === "first_move" && onboarding.firstMoveViewedAt === null)
  ) {
    redirect(onboardingHref(projectId));
  }
  await completeProjectOnboarding(supabase, { projectId, userId: session.userId });
  redirect(`/app/projects/${projectId}`);
}
