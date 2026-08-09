import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";
import { buttonClassName } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { listProjectsForUser } from "@/modules/projects/queries";

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
    <PageShell>
      <header>
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-4">
        {connectError && (
          <p className="rounded-md border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {CONNECT_ERROR_MESSAGES[connectError] ?? "GitHub connection failed. Please try again."}
          </p>
        )}

        <h1 className="text-2xl font-semibold tracking-tight">Your projects</h1>

        {projects.length === 0 ? (
          <>
            <p className="text-zinc-400">No projects connected yet.</p>
            <div>
              <Link href="/app/connect/github" className={buttonClassName}>
                Connect your first project
              </Link>
            </div>
          </>
        ) : (
          <>
            <ul className="divide-y divide-zinc-800 overflow-hidden rounded-md border border-zinc-800">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/app/projects/${project.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-900"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-50">{project.name}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {project.repository ? project.repository.fullName : "No repository connected"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-emerald-400">Connected</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div>
              <Link href="/app/connect/github" className={buttonClassName}>
                Connect another project
              </Link>
            </div>
          </>
        )}
      </main>
    </PageShell>
  );
}
