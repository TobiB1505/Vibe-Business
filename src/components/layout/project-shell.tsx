import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { StatusDot, type StatusTone } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { ProjectNav } from "./project-nav";
import { cn } from "@/lib/utils/cn";

/**
 * The project workspace shell.
 *
 * UI-0 built it, UI-1 wired it onto one anchored route, UI-2 Part 2 gave each
 * section its own URL, and CORE-5 replaced what those sections are. The frame
 * is the same in all four; what changed is the information architecture it
 * carries.
 */

/**
 * The Command Center: seven sections, in navigation order (CORE-5).
 *
 * ## What changed, and why the shape did not
 *
 * The workspace used to name its sections after its own machinery — Overview,
 * Business score, Next moves, Prepared, Deep Scan, Impact, Activity. Every one
 * of those is a true description of what the route holds and none of them is
 * how a founder thinks about their own business.
 *
 * These seven follow the product's own durable model (`PRODUCT.md` §11:
 * Understand → Diagnose → Prioritize → Plan → Execute → Measure) with a Home
 * above it and a Settings beside it. Nothing behind them moved: the same read
 * models, the same panels, the same gates.
 *
 * `segment` is the URL segment under `/app/projects/[projectId]`. Home is the
 * index route and therefore has an empty segment — it is the project's own URL,
 * not a child of it.
 *
 * Each maps to the work it owns:
 *
 *   home         — what the product is, how it is doing, what to do next
 *   my-product   — the product profile, its sources and what it can do
 *   business-audit — the audit: conclusion, business map, scored dimensions
 *   action-plan  — `opportunities-panel` + `action-plan-panel`
 *   agent        — `prepared-changes-section` (validation, preview, review,
 *                  approval and merge all live inside a prepared change)
 *   experiments  — what a merged change made measurable, via the project
 *                  impact model
 *   settings     — production URL, founder intent, the repository connection
 */
export const PROJECT_SECTIONS = [
  { id: "home", label: "Home", segment: "" },
  {
    // Second, immediately after Home, because every section below reasons
    // *from* this one: the audit, the plan and everything downstream all start
    // from what the product is (CORE-1 §33).
    id: "my-product",
    label: "My Product",
    segment: "product",
  },
  {
    // The section keeps the id `business-audit` because the Opportunity engine
    // publishes `BUSINESS_AUDIT_ANCHOR = "#business-audit"` and links a blocked
    // set at it — that link is the only way out of that state. The route is
    // `/health` (the product's word), and the anchor still resolves *on* that
    // route, so the tested domain constant keeps working untouched.
    // `project-sections.test.ts` fails if the two ever drift apart.
    id: "business-audit",
    label: "Business Health",
    segment: "health",
  },
  { id: "action-plan", label: "Action Plan", segment: "plan" },
  { id: "agent", label: "Agent", segment: "agent" },
  { id: "experiments", label: "Experiments", segment: "experiments" },
  { id: "settings", label: "Settings", segment: "settings" },
] as const;

/**
 * Reachable, anchored, and deliberately not in the rail (CORE-5).
 *
 * Two surfaces that are real routes and real sections but not destinations a
 * founder navigates to as a step in the loop:
 *
 *   deep-scan — a *source* My Product learns from. Keeping it a route of its
 *               own is also what keeps `maxDuration` off My Product: the
 *               browser session it drives needs 120 seconds, and the
 *               workspace-routes contract allows exactly one route to say so.
 *   activity  — the history log. Home shows the most recent entries; the full
 *               record lives under Settings, where a founder looks when they
 *               want it rather than being handed it as a step.
 *
 * They are a separate table rather than a flag on the one above, so
 * "the navigation" and "the routes" stay two different questions with two
 * different answers. Nothing has to remember to filter.
 */
export const PROJECT_SUBSECTIONS = [
  { id: "deep-scan", label: "Deep Scan", segment: "product/deep-scan" },
  { id: "activity", label: "Activity", segment: "settings/activity" },
] as const;

export type ProjectSectionId = (typeof PROJECT_SECTIONS)[number]["id"];
export type ProjectSubsectionId = (typeof PROJECT_SUBSECTIONS)[number]["id"];

/**
 * Anything with a URL and an anchor in this workspace — the seven in the rail
 * and the two beneath them. `WorkspaceSection` takes this rather than
 * `ProjectSectionId` so a child route keeps its heading, its `scroll-mt` and
 * its `aria-labelledby` without being smuggled into the navigation.
 */
export type WorkspaceSectionId = ProjectSectionId | ProjectSubsectionId;

/** The canonical URL of one workspace section. One place builds these. */
export function projectSectionHref(projectId: string, sectionId: WorkspaceSectionId): string {
  const section = [...PROJECT_SECTIONS, ...PROJECT_SUBSECTIONS].find(
    (candidate) => candidate.id === sectionId,
  );
  const base = `/app/projects/${projectId}`;
  return section && section.segment ? `${base}/${section.segment}` : base;
}

/**
 * One prepared change, addressed within the Agent page (UI-S2 §27).
 *
 * A fragment rather than a route, because a prepared change is not a page — it
 * is one card in a list whose whole point is that every artifact stays
 * reachable. The fragment is enough for the browser to scroll to it and for the
 * page to say which one was just prepared, and it costs no new route, no new
 * read model and no change to the card itself.
 *
 * Built here so the link and the anchor cannot drift: one function produces the
 * id, one produces the URL that targets it.
 */
export function preparedChangeAnchorId(preparedChangeId: string): string {
  return `prepared-change-${preparedChangeId}`;
}

export function preparedChangeHref(preparedHref: string, preparedChangeId: string): string {
  return `${preparedHref}#${preparedChangeAnchorId(preparedChangeId)}`;
}

export type ProjectNavItem = {
  id: ProjectSectionId;
  label: string;
  href: string;
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
  // No `currentId`: the active section is derived from the URL inside
  // `ProjectNav`, so it cannot disagree with the address bar after a refresh,
  // a Back navigation, or a link opened in a new tab.
}: {
  projectName: string;
  repositoryFullName: string | null;
  tone?: StatusTone;
  items: ProjectNavItem[];
}) {
  return (
    <nav
      aria-label="Project sections"
      className={cn(
        "border-line-1 bg-surface-1 flex shrink-0 flex-col gap-7 border-b p-4",
        // Desktop: a full-height rail that stays put while the workspace
        // scrolls. Below `lg` it becomes a horizontal strip at the top, which
        // is why the list below switches from a column to a scrollable row —
        // a 248px rail on a 375px screen would eat the content.
        "lg:sticky lg:top-0 lg:h-dvh lg:w-62 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-5",
      )}
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

      <ProjectNav items={items} />

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
  meta,
  actions,
}: {
  title: ReactNode;
  /** Rendered as the breadcrumb parent, so the project is always named. */
  projectName: string;
  description?: ReactNode;
  /**
   * The repository line — owner, branch, connection state. Only facts the
   * project actually has; an absent repository renders nothing here rather
   * than a placeholder.
   */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-line-1 bg-app/80 sticky top-0 z-20 border-b backdrop-blur-xl">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-5 sm:px-8">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-fg-meta flex items-center gap-2 font-mono text-meta">
            <Link href="/app" className="hover:text-fg-muted rounded-sm transition-interactive">
              Projects
            </Link>
            <span aria-hidden className="text-fg-faint">
              /
            </span>
            <span className="text-fg-muted truncate">{projectName}</span>
          </p>
          <h1 className="text-fg text-headline font-bold">{title}</h1>
          {description && <p className="text-fg-muted max-w-[70ch] text-sm">{description}</p>}
          {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * One section of the workspace.
 *
 * The `id` is the anchor the sidebar links to. `scroll-mt` clears the sticky
 * header, so a jump lands on the heading rather than under it — without that,
 * anchor navigation looks broken in exactly the way that makes people stop
 * using it.
 *
 * A `<section>` with an `aria-labelledby` pointing at its own heading, so the
 * document outline matches the navigation a sighted user sees.
 */
export function WorkspaceSection({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: WorkspaceSectionId;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    // `scroll-mt` has to clear the sticky header, which is taller than it
    // looks: breadcrumb, title and the repository meta row measure ~135px on a
    // 375px screen, where a long project name can also wrap. Measured, then
    // given headroom — too little and an anchor jump lands *behind* the header,
    // which reads as a broken link rather than a tight margin.
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-40 lg:scroll-mt-32">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id={`${id}-heading`} className="text-fg text-title font-bold">
              {title}
            </h2>
            {description && <p className="text-fg-muted max-w-[70ch] text-sm">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
        </div>
        {children}
      </div>
    </section>
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
