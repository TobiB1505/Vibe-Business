import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { NovaHome } from "./nova/nova-home";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nova",
  description: "What needs your attention right now.",
};

/**
 * The project index is Nova (ADR 0085).
 *
 * It answers one question — *what do I do now?* — from the ranking
 * `deriveNovaFocus` has always produced and nothing has ever rendered. The
 * diagnosis it replaces is not gone: Business Health is its own rail item at
 * `/health`, which was already a live address, and `#business-audit` still
 * resolves there for the opportunity engine's recovery fragment.
 */
export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  return <NovaHome supabase={supabase} userId={userId} project={project} />;
}
