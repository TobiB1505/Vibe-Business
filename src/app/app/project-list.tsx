import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { StatusDot } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import type { ProjectListItem } from "@/modules/projects/queries";

/**
 * The project list row (UI-0 reference migration).
 *
 * ## What this row does and does not show
 *
 * The mockup's row carries four columns: score, next moves, last audit, and an
 * action. Three of those have no data behind them — `listProjectsForUser`
 * returns a project's name and its repository connection and nothing else, and
 * there is no per-project audit summary query.
 *
 * They are therefore **not rendered**. Not as a placeholder, not as a dash in a
 * column headed SCORE, not as a zero. A score column showing `—` for every
 * project would be a worse lie than an absent column, because it implies the
 * product looked and found nothing.
 *
 * Adding them is a data change (a new aggregate query per project), which is
 * UI-1 work with its own tests — not something a styling pass should invent.
 *
 * ## The two states that are real
 *
 * A project either has a repository connection or does not, and that
 * difference already changes what the user can do next. That is the state the
 * row reports, and it is derived from the data, not from a fixture.
 */
export function ProjectRow({ project }: { project: ProjectListItem }) {
  const connected = project.repository !== null;

  return (
    <li>
      <Surface
        as="article"
        level={connected ? "panel" : "section"}
        padding="none"
        className="hover:border-line-4 transition-colors duration-150"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:p-6">
          <div className="flex min-w-0 flex-[2] items-center gap-3.5">
            <StatusDot tone={connected ? "active" : "neutral"} />
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-fg truncate text-base font-semibold tracking-[-0.02em]">
                {project.name}
              </h2>
              {/* A repository is machine-owned identity — mono, and never
                  truncated in the middle where an owner would become
                  ambiguous. */}
              <p className="text-fg-muted truncate font-mono text-xs">
                {project.repository?.fullName ?? "No repository connected"}
              </p>
            </div>
          </div>

          {connected && (
            <Metric
              label="Default branch"
              value={project.repository?.defaultBranch}
              mono
              className="hidden w-40 flex-none sm:flex"
            />
          )}

          <div className="ml-auto flex-none">
            <Link
              href={`/app/projects/${project.id}`}
              className={buttonClasses({ variant: connected ? "secondary" : "accent", size: "sm" })}
            >
              {connected ? "Open" : "Finish setup"}
              <span className="sr-only"> — {project.name}</span>
            </Link>
          </div>
        </div>
      </Surface>
    </li>
  );
}
