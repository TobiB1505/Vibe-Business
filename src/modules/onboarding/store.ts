import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getLatestSuccessfulAudit, getPausedAudit } from "@/modules/business-audit/store";
import {
  getActiveBusinessAuditOperation,
  getActiveProductUnderstandingOperation,
} from "@/modules/operations/service";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import {
  deriveOnboardingState,
  type LiveSiteStatus,
  type OnboardingState,
} from "./state";

export type StoredOnboarding = {
  projectId: string;
  state: OnboardingState;
  liveSiteStatus: LiveSiteStatus;
  productRevealedAt: string | null;
  auditRevealedAt: string | null;
  firstMoveViewedAt: string | null;
  completedAt: string | null;
};

export type ProjectOnboarding = StoredOnboarding & {
  projectName: string;
  productionUrl: string | null;
  repository: {
    fullName: string;
    defaultBranch: string;
    htmlUrl: string;
  } | null;
  productProfile: Awaited<ReturnType<typeof getLatestProfile>>;
  audit: Awaited<ReturnType<typeof getLatestSuccessfulAudit>>;
  pausedAudit: Awaited<ReturnType<typeof getPausedAudit>>;
  auditOperation: Awaited<ReturnType<typeof getActiveBusinessAuditOperation>>;
  understandingOperation: Awaited<ReturnType<typeof getActiveProductUnderstandingOperation>>;
  opportunities: Awaited<ReturnType<typeof getLatestOpportunities>>;
};

type OnboardingRow = {
  project_id: string;
  state: OnboardingState;
  live_site_status: LiveSiteStatus;
  product_revealed_at: string | null;
  audit_revealed_at: string | null;
  first_move_viewed_at: string | null;
  completed_at: string | null;
};

const COLUMNS =
  "project_id, state, live_site_status, product_revealed_at, audit_revealed_at, first_move_viewed_at, completed_at";

function mapRow(row: OnboardingRow): StoredOnboarding {
  return {
    projectId: row.project_id,
    state: row.state,
    liveSiteStatus: row.live_site_status,
    productRevealedAt: row.product_revealed_at,
    auditRevealedAt: row.audit_revealed_at,
    firstMoveViewedAt: row.first_move_viewed_at,
    completedAt: row.completed_at,
  };
}

export async function createProjectOnboarding(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<void> {
  const { data, error } = await supabase
    .from("project_onboarding")
    .upsert(
      { project_id: params.projectId, state: "add_live_product" },
      { onConflict: "project_id", ignoreDuplicates: true },
    )
    .select("project_id")
    .maybeSingle();
  if (error) throw error;

  if (data) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      projectId: params.projectId,
      eventType: "onboarding.started",
      metadata: { projectId: params.projectId, sourceProvider: "github" },
    });
  }
}

export async function setLiveSiteStatus(
  supabase: SupabaseClient,
  params: { projectId: string; status: LiveSiteStatus },
): Promise<void> {
  const { error } = await supabase
    .from("project_onboarding")
    .update({ live_site_status: params.status })
    .eq("project_id", params.projectId);
  if (error) throw error;
}

export async function markOnboardingMilestone(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    milestone: "product_revealed_at" | "audit_revealed_at" | "first_move_viewed_at";
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("project_onboarding")
    .update({ [params.milestone]: new Date().toISOString() })
    .eq("project_id", params.projectId)
    .is(params.milestone, null)
    .select("project_id")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function completeProjectOnboarding(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<void> {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("project_onboarding")
    .update({ state: "complete", completed_at: completedAt })
    .eq("project_id", params.projectId)
    .is("completed_at", null)
    .select("project_id")
    .maybeSingle();
  if (error) throw error;

  if (data) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      projectId: params.projectId,
      eventType: "onboarding.completed",
      metadata: { projectId: params.projectId },
    });
  }
}

/**
 * The latest incomplete project is the one a returning founder resumes. A
 * single query keeps first-login routing independent of project count.
 */
export async function getResumableOnboardingProjectId(
  supabase: SupabaseClient,
  projectIds: string[],
): Promise<string | null> {
  if (projectIds.length === 0) return null;
  const { data, error } = await supabase
    .from("project_onboarding")
    .select("project_id")
    .in("project_id", projectIds)
    .neq("state", "complete")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { project_id: string } | null)?.project_id ?? null;
}

/**
 * Rebuilds the route from canonical domain records and persists only the
 * corrected orchestration state. This is the recovery path for reloads,
 * operation callbacks, stale tabs and users returning on another device.
 */
export async function getProjectOnboarding(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<ProjectOnboarding | null> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, production_url")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) return null;

  const [{ data: row, error: rowError }, { data: repository, error: repositoryError }, profile, snapshot, audit, pausedAudit, auditOperation, understandingOperation, opportunities] =
    await Promise.all([
      supabase.from("project_onboarding").select(COLUMNS).eq("project_id", params.projectId).maybeSingle(),
      supabase
        .from("repository_connections")
        .select("full_name, default_branch, html_url")
        .eq("project_id", params.projectId)
        .maybeSingle(),
      getLatestProfile(supabase, params.projectId),
      getLatestSuccessfulSnapshot(supabase, params.projectId),
      getLatestSuccessfulAudit(supabase, params.projectId),
      getPausedAudit(supabase, params.projectId),
      getActiveBusinessAuditOperation(supabase, params.projectId),
      getActiveProductUnderstandingOperation(supabase, params.projectId),
      getLatestOpportunities(supabase, params.projectId),
    ]);
  if (rowError) throw rowError;
  if (repositoryError) throw repositoryError;

  let stored: StoredOnboarding;
  if (row) {
    stored = mapRow(row as OnboardingRow);
  } else {
    // Migration-safe fallback for a project created by an older application
    // instance during a rolling deploy. An existing completed audit is mature.
    const mature = Boolean(audit?.result);
    const completedAt = mature ? (audit?.completedAt ?? audit?.createdAt ?? new Date().toISOString()) : null;
    const initialState: OnboardingState = mature ? "complete" : repository ? "add_live_product" : "connect_source";
    const liveSiteStatus: LiveSiteStatus = project.production_url ? "provided" : mature ? "no_live_site_yet" : "undecided";
    const initial = {
      project_id: params.projectId,
      state: initialState,
      live_site_status: liveSiteStatus,
      product_revealed_at: mature ? completedAt : null,
      audit_revealed_at: mature ? completedAt : null,
      first_move_viewed_at: mature ? completedAt : null,
      completed_at: completedAt,
    };
    const { data: inserted, error: insertError } = await supabase
      .from("project_onboarding")
      .upsert(initial, { onConflict: "project_id", ignoreDuplicates: true })
      .select(COLUMNS)
      .maybeSingle();
    if (insertError) throw insertError;
    if (inserted) {
      stored = mapRow(inserted as OnboardingRow);
    } else {
      // Another request won the lazy-create race. Read its row; never replace
      // milestones it may already have advanced.
      const { data: concurrent, error: concurrentError } = await supabase
        .from("project_onboarding")
        .select(COLUMNS)
        .eq("project_id", params.projectId)
        .single();
      if (concurrentError) throw concurrentError;
      stored = mapRow(concurrent as OnboardingRow);
    }
  }

  // A canonical URL fills an undecided onboarding choice. An explicit
  // no-live/scan-failed choice remains meaningful until a URL update goes
  // through the normal action, which updates both records together.
  const liveSiteStatus: LiveSiteStatus =
    project.production_url && stored.liveSiteStatus === "undecided"
      ? "provided"
      : stored.liveSiteStatus;
  const nextState = deriveOnboardingState({
    hasProductSource: Boolean(repository),
    liveSiteStatus,
    hasRepositorySnapshot: Boolean(snapshot?.result),
    understandingRunning: Boolean(understandingOperation),
    hasProductProfile: Boolean(profile),
    productConfirmed: Boolean(profile?.stored.confirmedAt),
    auditNeedsUser: Boolean(pausedAudit),
    auditRunning: Boolean(auditOperation),
    auditAnalyzing: auditOperation?.stage === "running_ai",
    hasAudit: Boolean(audit?.result),
    auditRevealed: stored.auditRevealedAt !== null,
    completed: stored.completedAt !== null,
  });

  if (nextState !== stored.state || liveSiteStatus !== stored.liveSiteStatus) {
    const { error } = await supabase
      .from("project_onboarding")
      .update({ state: nextState, live_site_status: liveSiteStatus })
      .eq("project_id", params.projectId);
    if (error) throw error;

    const eventType =
      nextState === "product_reveal"
        ? "onboarding.product_understanding_completed"
        : nextState === "audit_needs_user"
        ? "onboarding.audit_needs_user"
        : nextState === "audit_reveal"
          ? "onboarding.audit_completed"
          : null;
    if (eventType) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        projectId: params.projectId,
        eventType,
        metadata: { projectId: params.projectId },
      });
    }
    stored = { ...stored, state: nextState, liveSiteStatus };
  }

  return {
    ...stored,
    projectName: project.name,
    productionUrl: project.production_url,
    repository: repository
      ? {
          fullName: repository.full_name,
          defaultBranch: repository.default_branch,
          htmlUrl: repository.html_url,
        }
      : null,
    productProfile: profile,
    audit,
    pausedAudit,
    auditOperation,
    understandingOperation,
    opportunities,
  };
}
