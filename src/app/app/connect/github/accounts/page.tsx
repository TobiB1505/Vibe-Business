import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { listVerifiedInstallations } from "@/modules/github/connections";

/**
 * Shown only when a user has more than one verified installation — for
 * example a personal account plus one or more organizations. Vibe
 * Business never picks one on the user's behalf.
 *
 * With zero or one installation there is nothing to choose, so the
 * request goes back through the connect route, which resolves the right
 * destination.
 */
export default async function ChooseGithubAccountPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const installations = await listVerifiedInstallations(supabase, session.userId);

  if (installations.length <= 1) {
    redirect("/app/connect/github");
  }

  return (
    <PageShell>
      <header>
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a GitHub account</h1>
          <p className="text-sm text-zinc-400">
            You have connected more than one GitHub account or organization.
          </p>
        </div>

        <ul className="divide-y divide-zinc-800 overflow-hidden rounded-md border border-zinc-800">
          {installations.map((installation) => (
            <li key={installation.id}>
              <Link
                href={`/app/connect/github/repositories?installation=${installation.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-50">
                    {installation.accountLogin}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {installation.accountType === "Organization" ? "Organization" : "Personal account"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-zinc-500">Choose</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-sm text-zinc-500">
          <Link
            href="/app/connect/github?new=1"
            className="text-zinc-300 underline underline-offset-2 hover:text-zinc-50"
          >
            Connect a different GitHub account or organization
          </Link>
        </p>
      </main>
    </PageShell>
  );
}
