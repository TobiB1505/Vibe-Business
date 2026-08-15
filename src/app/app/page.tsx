import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/states";
import { SectionHeader } from "@/components/ui/typography";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { listProjectsForUser } from "@/modules/projects/queries";
import { ProjectRow } from "./project-list";

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "GitHub authorization was cancelled or denied.",
  state_invalid: "That connection attempt expired or was invalid. Please try connecting GitHub again.",
  missing_params: "GitHub didn't return the information needed to complete the connection. Please try again.",
  installation_not_accessible:
    "That GitHub installation isn't accessible to your GitHub account. Please try again.",
  github_unavailable: "GitHub is temporarily unavailable. Please try again in a moment.",
};

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string }>;
}) {
  const session = await requireSession();
  const { connect_error: connectError } = await searchParams;

  const supabase = await createClient();
  const projects = await listProjectsForUser(supabase, session.userId);

  return (
    <AppShell email={session.email}>
      <div className="flex flex-col gap-7">
        {connectError && (
          <Notice tone="problem" label="Connection failed">
            {CONNECT_ERROR_MESSAGES[connectError] ?? "GitHub connection failed. Please try again."}
          </Notice>
        )}

        <SectionHeader
          level={1}
          title="Your projects"
          description="One repository per project."
          actions={
            projects.length > 0 ? (
              <Link href="/app/connect/github" className={buttonClasses()}>
                Connect another project
              </Link>
            ) : null
          }
        />

        {projects.length === 0 ? (
          <EmptyState
            title="No projects connected yet"
            description="Connect a repository and Vibe reads it once to work out how business-ready it is. Read-only to start — nothing is written to your code until you approve a change."
            action={
              <>
                <Link href="/app/connect/github" className={buttonClasses()}>
                  Connect your first project
                </Link>
                <span className="text-fg-meta text-xs">Opens GitHub</span>
              </>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3.5">
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
