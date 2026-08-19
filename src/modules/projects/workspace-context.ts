import "server-only";

import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getProjectWithRepository } from "@/modules/projects/queries";

/**
 * The shared project context (Sprint UI-2 Part 2).
 *
 * ## What belongs here, and what must not
 *
 * Every workspace route renders the same frame: the sidebar, the header, the
 * breadcrumb. That frame needs the project's identity and its repository
 * connection — and nothing else.
 *
 * What deliberately does **not** live here: the audit, opportunities, prepared
 * changes, Deep Scan results, outcomes, impact or activity. A layout runs on
 * *every* route beneath it, so anything loaded here is paid for by every route.
 * That is precisely the cost UI-2 Part 1 built read models to escape, and
 * loading a workspace's data in its layout would hand it straight back.
 *
 * ## Ownership
 *
 * `notFound()` is the answer for both "no such project" and "not yours" — the
 * same response, deliberately, so a URL cannot be used to discover which
 * project ids exist. The layout resolves this once and each route re-resolves
 * it for itself, because a layout in the App Router does not gate the routes
 * beneath it: they render independently and must not assume a parent ran.
 *
 * ## Why there is no GitHub probe here (UI-4 §3)
 *
 * There used to be one: every context read also asked GitHub whether the
 * installation was still usable, which mints an installation token and lists
 * the repositories it can reach. Two round trips — and because layout and
 * route each resolve the context independently, four per navigation, before
 * anything could paint.
 *
 * Exactly one place ever used the answer: the "Connected" pill in the project
 * header. Eight route files paid for it and threw it away. So the probe now
 * belongs to the thing that displays it, which streams it in after the page
 * has rendered, and this stays a database read.
 */

export type ProjectWorkspaceContext = {
  id: string;
  name: string;
  userId: string;
  productionUrl: string | null;
  repository: {
    fullName: string;
    defaultBranch: string;
    htmlUrl: string;
    installationId: number;
  } | null;
};

/**
 * Returns null when the project does not exist or does not belong to the
 * caller. Callers turn that into `notFound()`; this function does not redirect,
 * so it stays usable from anywhere.
 */
export async function getProjectWorkspaceContext(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<ProjectWorkspaceContext | null> {
  const project = await getProjectWithRepository(supabase, params.projectId);

  // RLS already scopes this to the caller. The explicit comparison is the
  // second layer, and it is what makes the ownership rule visible at the call
  // site rather than implied by a policy elsewhere.
  if (!project || project.userId !== params.userId) return null;

  const repository = project.repository;

  return {
    id: project.id,
    name: project.name,
    userId: project.userId,
    productionUrl: project.productionUrl,
    repository: repository
      ? {
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          htmlUrl: repository.htmlUrl,
          installationId: repository.installationId,
        }
      : null,
  };
}

/**
 * The gate every workspace route opens with.
 *
 * ## Why each route calls this, rather than trusting the layout
 *
 * An App Router layout does **not** gate the routes beneath it. Layout and page
 * render independently, and a page is reachable by direct URL whether or not
 * its layout would have refused. A route that assumed "the layout already
 * checked" would be an authorization hole that looks correct in the file tree.
 *
 * So this runs per route, and it costs one RLS-scoped project read. It no
 * longer carries a GitHub probe: see the note above.
 *
 * Returns the context or renders 404 — the same answer for "no such project"
 * and "not yours", so a URL cannot enumerate project ids.
 */
export async function requireProjectAccess(projectId: string): Promise<{
  supabase: SupabaseClient;
  userId: string;
  project: ProjectWorkspaceContext;
}> {
  const session = await requireSession();
  const supabase = await createClient();

  const project = await getProjectWorkspaceContext(supabase, {
    projectId,
    userId: session.userId,
  });

  if (!project) notFound();

  return { supabase, userId: session.userId, project };
}
