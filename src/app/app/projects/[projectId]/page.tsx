import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { hasNovaIntroduced } from "@/modules/onboarding/store";
import { NovaHome } from "./nova/nova-home";
import { NovaOpeningScreen } from "./nova/nova-opening-screen";
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
 *
 * ## The one thing that comes before the ranking
 *
 * A founder who has never met Nova is not asking *what do I do now?* — they do
 * not yet know who is answering. So the first load of a project plays the
 * opening instead, once, gated on `nova_introduced_at` and dismissed by the
 * action that writes it.
 *
 * `?opening` replays it. That is a review affordance rather than a feature: a
 * choreography that fires once per project cannot otherwise be looked at on a
 * deployment, and the replay writes nothing — it renders the same components
 * around the same project and reloading without it returns to Home.
 */
export default async function ProjectHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const replay = "opening" in (await searchParams);
  const introduced = replay ? false : await hasNovaIntroduced(supabase, projectId);

  if (!introduced) {
    return (
      <NovaOpeningScreen
        projectId={project.id}
        productName={project.name}
        connected={project.repository !== null}
        replay={replay}
      />
    );
  }

  return <NovaHome supabase={supabase} userId={userId} project={project} />;
}
