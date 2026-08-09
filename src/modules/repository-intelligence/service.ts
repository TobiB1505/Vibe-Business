import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createGithubRepositoryReader } from "@/modules/github/repository-reader";
import { GithubDomainError } from "@/modules/github/errors";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { analyzeRepository } from "./analyzer";
import { ANALYZER_VERSION, REPOSITORY_INTELLIGENCE_SCHEMA_VERSION } from "./schema";
import {
  completeAnalysisRun,
  createAnalysisRun,
  failAnalysisRun,
  findReusableSnapshot,
  type StoredSnapshot,
} from "./store";

/**
 * Application service tying ownership, reuse, analysis and persistence
 * together. This is the only entry point the UI calls.
 *
 * Ownership is verified from persisted data before any GitHub call: the
 * caller supplies a project id, never an `owner/repo` pair, so a user
 * cannot direct Vibe Business at a repository they have not connected
 * (Sprint 2 §26).
 */

export type InspectFailureCode =
  | "project_not_found"
  | "repository_not_connected"
  | "already_running"
  | "repository_not_found"
  | "github_access_revoked"
  | "github_contents_permission_required"
  | "repository_empty"
  | "github_rate_limited"
  | "github_api_error"
  | "analysis_failed";

export type InspectResult =
  | { ok: true; snapshot: StoredSnapshot; reused: boolean }
  | { ok: false; error: InspectFailureCode };

type ProjectRepositoryRow = {
  id: string;
  project_id: string;
  owner: string;
  name: string;
  full_name: string;
  private: boolean;
  github_installation_id: string;
};

/** Loads the connection for a project the caller owns. RLS enforces ownership; the explicit filter documents it. */
async function loadOwnedRepository(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<{ connection: ProjectRepositoryRow; installationId: number } | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!project) return null;

  const { data: connection } = await supabase
    .from("repository_connections")
    .select("id, project_id, owner, name, full_name, private, github_installation_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!connection) return null;

  const { data: installation } = await supabase
    .from("github_installations")
    .select("installation_id")
    .eq("id", connection.github_installation_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!installation) return null;

  return { connection: connection as ProjectRepositoryRow, installationId: installation.installation_id };
}

function toFailureCode(error: unknown): InspectFailureCode {
  if (error instanceof GithubDomainError) return error.code;
  return "analysis_failed";
}

export type InspectOptions = {
  /** Skips snapshot reuse and forces a fresh read of the repository. */
  force?: boolean;
};

export async function inspectRepository(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
  options: InspectOptions = {},
): Promise<InspectResult> {
  const owned = await loadOwnedRepository(supabase, params.projectId, params.userId);
  if (!owned) return { ok: false, error: "repository_not_connected" };

  const { connection, installationId } = owned;
  const reader = createGithubRepositoryReader(installationId, connection.owner, connection.name);

  // Resolving the head commit first is what makes reuse possible: it is
  // one cheap call, and it decides whether any further reading is needed
  // at all.
  let head;
  try {
    head = await reader.getHead();
  } catch (error) {
    const code = toFailureCode(error);
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "repository.intelligence.failed",
      metadata: { projectId: params.projectId, reason: code },
    });
    return { ok: false, error: code };
  }

  if (!options.force) {
    const reusable = await findReusableSnapshot(supabase, {
      projectId: params.projectId,
      commitSha: head.commitSha,
      analyzerVersion: ANALYZER_VERSION,
    });

    if (reusable) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "repository.intelligence.reused",
        metadata: {
          projectId: params.projectId,
          commitSha: head.commitSha,
          analyzerVersion: ANALYZER_VERSION,
        },
      });
      return { ok: true, snapshot: reusable, reused: true };
    }
  }

  const run = await createAnalysisRun(supabase, {
    projectId: params.projectId,
    repositoryConnectionId: connection.id,
    commitSha: head.commitSha,
    branch: head.defaultBranch,
    analyzerVersion: ANALYZER_VERSION,
    schemaVersion: REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
  });

  if (!run.ok) {
    if (run.error === "already_running") return { ok: false, error: "already_running" };
    return { ok: false, error: "analysis_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "repository.intelligence.started",
    metadata: {
      projectId: params.projectId,
      commitSha: head.commitSha,
      analyzerVersion: ANALYZER_VERSION,
    },
  });

  try {
    const { snapshot } = await analyzeRepository({
      reader,
      repository: {
        fullName: connection.full_name,
        defaultBranch: head.defaultBranch,
        private: connection.private,
      },
    });

    await completeAnalysisRun(supabase, run.snapshotId, snapshot);

    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "repository.intelligence.completed",
      metadata: {
        projectId: params.projectId,
        commitSha: head.commitSha,
        analyzerVersion: ANALYZER_VERSION,
        completeness: snapshot.completeness.status,
        filesFetched: snapshot.metrics.filesFetched,
        bytesFetched: snapshot.metrics.bytesFetched,
        durationMs: snapshot.metrics.durationMs,
      },
    });

    return {
      ok: true,
      reused: false,
      snapshot: {
        id: run.snapshotId,
        projectId: params.projectId,
        status: "completed",
        commitSha: head.commitSha,
        branch: head.defaultBranch,
        analyzerVersion: ANALYZER_VERSION,
        completeness: snapshot.completeness.status,
        completenessReasons: snapshot.completeness.reasons,
        failureCode: null,
        result: snapshot,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const code = toFailureCode(error);
    await failAnalysisRun(supabase, run.snapshotId, code);
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "repository.intelligence.failed",
      metadata: { projectId: params.projectId, commitSha: head.commitSha, reason: code },
    });
    return { ok: false, error: code };
  }
}
