import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { listConnectedRepositories } from "@/modules/projects/account-repositories";

export const metadata = { title: "Repositories" };

/**
 * What code Vibe is attached to (CORE-6).
 *
 * ## Why this is a page and not a line on every product card
 *
 * Because `owner/repo` on every card is the account dashboard borrowing the
 * project workspace's density: three cards, three repository strings, and none
 * of them is what a founder came to that screen to read. The fact is real and
 * occasionally exactly what you need — which is what a page is for.
 *
 * ## What every row states, and what it deliberately does not
 *
 * The repository, the product it belongs to, the branch Vibe treats as
 * default, whether it is private, and when it was connected. All of that was
 * captured at connection time and is stored.
 *
 * It does **not** say whether the installation is still accessible or whether
 * the default branch has since moved. Both are live questions with a network
 * call behind them, and answering them here would put one GitHub round trip
 * per repository on an index page. The workspace asks, freshly, at the point
 * where the answer gates something — which is the only place the answer can be
 * trusted anyway.
 *
 * "Default branch" is named rather than explained: it is the branch a merge
 * would fast-forward, and nothing on this page merges anything.
 */
export default async function RepositoriesPage() {
  const session = await requireSession("/app/repositories");
  const supabase = await createClient();

  const repositories = await listConnectedRepositories(supabase, session.userId);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title="Repositories"
        description="The code behind each product, as Vibe connected it."
        actions={
          <Link
            href="/app/connect/github"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Connect a repository
          </Link>
        }
      />

      {repositories.length === 0 ? (
        <EmptyState
          title="No repositories connected"
          description="Connecting a repository is how Vibe reads a product, scores the business around it, and prepares a change."
          action={
            <Link href="/app/connect/github" className={buttonClasses({ size: "sm" })}>
              Connect GitHub
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {repositories.map((repository) => (
            <li key={repository.projectId}>
              <Surface
                level="panel"
                padding="md"
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Mono: a repository name is machine output, not prose. */}
                    <a
                      href={repository.htmlUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-fg-body hover:text-mint truncate font-mono text-ui transition-interactive"
                    >
                      {repository.fullName}
                    </a>
                    {repository.private && <StatusPill tone="neutral">Private</StatusPill>}
                  </div>
                  <p className="text-fg-meta text-meta">
                    Default branch{" "}
                    <span className="font-mono">{repository.defaultBranch}</span> · connected{" "}
                    {formatTimestamp(repository.connectedAt)}
                  </p>
                </div>

                <Link
                  href={`/app/projects/${repository.projectId}`}
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  {repository.projectName}
                </Link>
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
