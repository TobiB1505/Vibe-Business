"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { listInstallationRepositories } from "@/modules/github/repositories";
import { getVerifiedInstallation } from "@/modules/github/connections";
import { createProjectWithRepository } from "@/modules/projects/connect";
import { ensureWelcomeGrant } from "@/modules/credits/grants";
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

  /*
   * Welcome Credits, at the one real provisioning moment (BILLING CORE-2 §5,
   * §6, §57).
   *
   * Here rather than on the billing page because this is a POST that already
   * creates account state — a page render must never move financial state
   * (§99), and "grant on every page load" is exactly what §6 forbids.
   *
   * The grant is **account-scoped**, so connecting a second, third or tenth
   * repository issues nothing further: every call computes the same identity,
   * `welcome-credit-v1:<userId>`, and the ledger's unique index admits one.
   * That is what makes creating projects useless as a way to farm Credits.
   *
   * Deliberately not allowed to fail the connect flow. A customer who
   * connected their repository successfully has connected it; a billing hiccup
   * must not undo that, and the billing page can reconcile the grant later.
   *
   * Its own service-role client, separate from `supabase` above: billing
   * tables have no write policy for any authenticated client, by design
   * (§64), so the cookie-scoped client used for the rest of this action could
   * never succeed here. Ownership stays session-derived — `session.userId`,
   * never a value this client could be tricked into writing on someone
   * else's behalf.
   */
  try {
    await ensureWelcomeGrant(createServiceClient(), { userId: session.userId });
  } catch (error) {
    console.error("[billing] welcome grant failed during project connect", {
      userId: session.userId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }

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
