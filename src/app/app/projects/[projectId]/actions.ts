"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { disconnectProject } from "@/modules/projects/disconnect";

/**
 * Sprint 1 §11: removes Vibe Business's local Project/RepositoryConnection
 * relationship after explicit confirmation (see disconnect-button.tsx).
 * Never touches GitHub — no App uninstall, no repository changes.
 */
export async function disconnectProjectAction(projectId: string): Promise<void> {
  const session = await requireSession();
  const supabase = await createClient();

  const result = await disconnectProject(supabase, { projectId, userId: session.userId });

  if (result.ok) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "project.disconnected",
      metadata: { projectId },
    });
  }

  redirect("/app");
}
