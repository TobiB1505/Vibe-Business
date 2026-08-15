import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { StatusDot, type StatusTone } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";

/**
 * The project workspace shell (UI-0 — foundation, not yet wired).
 *
 * ## Status
 *
 * This component is **built and unused**, deliberately. The project screen is
 * today a single 569-line route that assembles roughly twenty services into one
 * page, and splitting it into seven routes is a data-dependency and server-
 * boundary exercise, not a styling one. Doing that in the same change as the
 * design system would make a visual migration indistinguishable from a
 * behavioural one if anything broke.
 *
 * So the shell exists, and the route split is UI-1. When that happens, the
 * caller supplies `href` per section and this file should not need to change.
 *
 * Nothing here links anywhere on its own: a section without an `href` renders
 * as plain text rather than a link, so this component cannot produce a 404 for
 * a route that has not been built.
 */

/**
 * The seven sections of a project, in navigation order.
 *
 * Each maps to work that already exists in the current single-page route — the
 * ids are the mapping, and they are what UI-1 should route on:
 *
 *   overview   — connection, intelligence summaries, business context
 *   score      — `business-audit-summary`
 *   moves      — `opportunities-panel`
 *   prepared   — `prepared-changes-section` (validation, preview, review,
 *                approval and merge all live inside a prepared change)
 *   deep-scan  — `deep-scan-panel`
 *   impact     — `outcome-panel` + `business-impact-panel`
 *   activity   — the audit log, which has no UI yet
 */
export const PROJECT_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "score", label: "Business score" },
  { id: "moves", label: "Next moves" },
  { id: "prepared", label: "Prepared" },
  { id: "deep-scan", label: "Deep Scan" },
  { id: "impact", label: "Impact" },
  { id: "activity", label: "Activity" },
] as const;

export type ProjectSectionId = (typeof PROJECT_SECTIONS)[number]["id"];

export type ProjectNavItem = {
  id: ProjectSectionId;
  label: string;
  /** Omitted until the section has a route. Renders as text, never a dead link. */
  href?: string;
  /**
   * A count beside the label — waiting moves, prepared changes. Only pass a
   * number the domain actually produced; an absent count is absent, not zero.
   */
  count?: number | null;
  /** Mint when the count is something Vibe is offering to act on. */
  countTone?: "accent" | "neutral";
};

export function ProjectSidebar({
  projectName,
  repositoryFullName,
  /** State of the project itself, mirrored by the text under the name. */
  tone = "neutral",
  items,
  currentId,
}: {
  projectName: string;
  repositoryFullName: string | null;
  tone?: StatusTone;
  items: ProjectNavItem[];
  currentId?: ProjectSectionId;
}) {
  return (
    <nav
      aria-label="Project sections"
      className="border-line-1 bg-surface-1 flex shrink-0 flex-col gap-7 border-b p-4 lg:w-62 lg:border-r lg:border-b-0 lg:p-5"
    >
      <div className="hidden px-1 lg:block">
        <Link href="/app" className="rounded-nav" aria-label="Vibe Business — your projects">
          <VibeLockup />
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <MonoLabel className="px-1 tracking-[0.18em]">Project</MonoLabel>
        <div className="rounded-nav bg-surface-4 border-line-4 flex items-center gap-3 border px-3 py-2.5">
          <StatusDot tone={tone} className="size-2" />
          <span className="flex min-w-0 flex-col">
            <span className="text-fg truncate text-sm font-semibold">{projectName}</span>
            {repositoryFullName && (
              <span className="text-fg-muted truncate font-mono text-[0.65625rem]">
                {repositoryFullName}
              </span>
            )}
          </span>
        </div>
      </div>

      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {items.map((item) => {
          const current = item.id === currentId;
          const content = (
            <>
              <span className="whitespace-nowrap">{item.label}</span>
              {typeof item.count === "number" && (
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 font-mono text-[0.65625rem]",
                    item.countTone === "accent"
                      ? "bg-mint-tint text-mint"
                      : "bg-surface-hover text-fg-prose",
                  )}
                >
                  {item.count}
                </span>
              )}
            </>
          );

          const className = cn(
            "rounded-nav flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-150 ease-vibe",
            current
              ? "bg-mint-tint border-mint-line text-mint border font-semibold"
              : "text-fg-secondary hover:bg-surface-2 hover:text-fg-body",
          );

          return (
            <li key={item.id} className="lg:w-full">
              {item.href ? (
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={className}
                >
                  {content}
                </Link>
              ) : (
                // No route yet. Rendered as text so the section is visible in
                // the map of the product without pretending to be reachable.
                <span aria-current={current ? "page" : undefined} className={className}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The bar above a project section: where you are, what the section is, and the
 * controls that belong to it.
 */
export function ProjectHeader({
  title,
  projectName,
  description,
  actions,
}: {
  title: ReactNode;
  /** Rendered as the breadcrumb parent, so the project is always named. */
  projectName: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-line-1 flex flex-wrap items-end justify-between gap-4 border-b px-5 py-5 sm:px-8">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-fg-meta flex items-center gap-2 font-mono text-[0.6875rem]">
          <Link href="/app" className="hover:text-fg-muted rounded-sm transition-colors">
            Projects
          </Link>
          <span aria-hidden className="text-fg-faint">
            /
          </span>
          <span className="text-fg-muted truncate">{projectName}</span>
        </p>
        <h1 className="text-fg text-headline font-bold">{title}</h1>
        {description && <p className="text-fg-muted max-w-[70ch] text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/** Sidebar + content column. The header belongs to the content, not the frame. */
export function ProjectShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-app text-fg-body flex min-h-dvh flex-col lg:flex-row">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
