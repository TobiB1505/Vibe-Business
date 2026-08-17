"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { listInstallationRepositories } from "@/modules/github/repositories";
import { getVerifiedInstallation } from "@/modules/github/connections";
import { createProjectWithRepository } from "@/modules/projects/connect";
import { createProjectOnboarding } from "@/modules/onboarding/store";

export type SelectRepositoryResult = { ok: true } | { ok: false; error: string };

/**
 * Step E of the connect flow (Sprint 1 §9). Never trusts client-submitted
 * repository metadata: `githubRepositoryId` is only an identifier, the
 * actual owner/name/full_name/default_branch/private/html_url stored come
 * from a fresh, server-side re-listing of the installation's repositories
 * — closes the tampering vector of a modified hidden form field claiming
 * a repository the installation doesn't actually have access to.
 */
export async function selectRepository(
  _prevState: SelectRepositoryResult | null,
  formData: FormData,
): Promise<SelectRepositoryResult> {
  const session = await requireSession();

  const installationRowId = formData.get("installationRowId");
  const githubRepositoryIdRaw = formData.get("githubRepositoryId");

  if (typeof installationRowId !== "string" || typeof githubRepositoryIdRaw !== "string") {
    return { ok: false, error: "Select a repository." };
  }

  const githubRepositoryId = Number(githubRepositoryIdRaw);
  if (!Number.isInteger(githubRepositoryId) || githubRepositoryId <= 0) {
    return { ok: false, error: "Select a repository." };
  }

  const supabase = await createClient();

  // Re-verifies ownership server-side: the installation row id came from
  // a form field and is untrusted until this resolves.
  const installationRow = await getVerifiedInstallation(supabase, session.userId, installationRowId);

  if (!installationRow) {
    return {
      ok: false,
      error: "This GitHub installation is no longer available. Reconnect GitHub and try again.",
    };
  }

  let repositories;
  try {
    repositories = await listInstallationRepositories(installationRow.installationId);
  } catch {
    return { ok: false, error: "GitHub access unavailable. Try again in a moment." };
  }

  const repository = repositories.find((repo) => repo.githubRepositoryId === githubRepositoryId);
  if (!repository) {
    return { ok: false, error: "That repository is not accessible through this installation." };
  }

  const result = await createProjectWithRepository(supabase, {
    userId: session.userId,
    installationRowId: installationRow.id,
    repository,
  });

  if (!result.ok) {
    if (result.error === "duplicate_repository") {
      await recordAuditEvent(supabase, {
        userId: session.userId,
        eventType: "github.access.failed",
        metadata: { reason: "duplicate_repository" },
      });
      return { ok: false, error: "This repository is already connected to a project." };
    }
    return { ok: false, error: "Could not connect this repository. Try again." };
  }

  await recordAuditEvent(supabase, {
    userId: session.userId,
    eventType: "repository.selected",
    metadata: { githubRepositoryId: repository.githubRepositoryId },
  });
  await recordAuditEvent(supabase, {
    userId: session.userId,
    eventType: "project.created",
    metadata: { projectId: result.projectId },
  });

  await createProjectOnboarding(supabase, {
    projectId: result.projectId,
    userId: session.userId,
  });
  await recordAuditEvent(supabase, {
    userId: session.userId,
    projectId: result.projectId,
    eventType: "onboarding.repository_selected",
    metadata: { projectId: result.projectId, sourceProvider: "github" },
  });

  redirect(`/app/onboarding/${result.projectId}`);
}
