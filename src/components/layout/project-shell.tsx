import Link from "next/link";
import type { ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  type DashboardIconName,
} from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";
import { ProjectNav } from "./project-nav";
import { ProjectSwitcher, type ProjectSwitcherItem } from "./project-switcher";
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
 * The Command Center: six sections, in navigation order (UI-11).
 *
 * ## What changed, and why the shape did not
 *
 * The workspace used to name its sections after its own machinery — Overview,
 * Business score, Next moves, Prepared, Deep Scan, Impact, Activity. Every one
 * of those is a true description of what the route holds and none of them is
 * how a founder thinks about their own business.
 *
 * Business Health now *is* Home. Diagnosis is the project's opening context,
 * not a second destination beside a summary of the same diagnosis. The
 * remaining sections continue the product's durable model (`PRODUCT.md` §11:
 * Understand → Diagnose → Prioritize → Plan → Execute → Measure).
 *
 * `segment` is the URL segment under `/app/projects/[projectId]`. Home is the
 * index route and therefore has an empty segment — it is the project's own URL,
 * not a child of it.
 *
 * Each maps to the work it owns:
 *
 *   home         — the diagnosis, business map and what to do next
 *   my-product   — the product profile, its sources and what it can do
 *   action-plan  — `opportunities-panel` + `action-plan-panel`
 *   agent        — the five-stage workspace and the gate panels (validation,
 *                  approval and merge all live inside a prepared change)
 *   experiments  — what a merged change made measurable, via the project
 *                  impact model
 *   settings     — production URL, founder intent, the repository connection
 */
export const PROJECT_SECTIONS = [
  { id: "home", label: "Home", icon: "home", segment: "" },
  {
    // Second, immediately after Home, because every section below reasons
    // *from* this one: the audit, the plan and everything downstream all start
    // from what the product is (CORE-1 §33).
    id: "my-product",
    label: "My Product",
    icon: "products",
    segment: "product",
  },
  { id: "action-plan", label: "Action Plan", icon: "action-plan", segment: "plan" },
  { id: "agent", label: "Agent", icon: "agent", segment: "agent" },
  { id: "experiments", label: "Experiments", icon: "experiments", segment: "experiments" },
  { id: "settings", label: "Project Settings", icon: "settings", segment: "settings" },
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
 * Anything with a URL and an anchor in this workspace — the six in the rail,
 * the two beneath them and the stable audit recovery anchor.
 * `WorkspaceSection` takes this rather than `ProjectSectionId` so a child route
 * keeps its heading, its `scroll-mt` and its `aria-labelledby` without being
 * smuggled into the navigation.
 */
export type WorkspaceSectionId = ProjectSectionId | ProjectSubsectionId | "business-audit";

/** The canonical URL of one workspace section. One place builds these. */
export function projectSectionHref(projectId: string, sectionId: WorkspaceSectionId): string {
  const base = `/app/projects/${projectId}`;
  // Opportunity blocked states already publish this id as their only recovery
  // path. It now lands on the canonical Home anchor rather than disappearing.
  if (sectionId === "business-audit") return `${base}#business-audit`;

  const section = [...PROJECT_SECTIONS, ...PROJECT_SUBSECTIONS].find(
    (candidate) => candidate.id === sectionId,
  );
  return section && section.segment ? `${base}/${section.segment}` : base;
}

/**
 * What the current URL's project section is called, for the breadcrumb trail.
 *
 * Home returns null: the project's own index is already named by the product
 * name beside it, and "Acme / Home" says the same thing twice. Subsections
 * resolve too, so `/product/deep-scan` names Deep Scan rather than falling back
 * to the product it belongs to.
 *
 * Matched longest-segment-first, because `product` is a prefix of
 * `product/deep-scan` and the more specific answer is the true one.
 */
export function projectSectionLabel(projectId: string, pathname: string): string | null {
  const base = `/app/projects/${projectId}`;
  if (!pathname.startsWith(base)) return null;

  const rest = pathname.slice(base.length).replace(/^\/+|\/+$/g, "");
  if (rest === "") return null;

  const candidates = [...PROJECT_SECTIONS, ...PROJECT_SUBSECTIONS]
    .filter((section) => section.segment !== "")
    .sort((a, b) => b.segment.length - a.segment.length);

  return candidates.find((section) => rest === section.segment)?.label ?? null;
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
  icon: DashboardIconName;
  href: string;
  /**
   * A count beside the label — waiting moves, prepared changes. Only pass a
   * number the domain actually produced; an absent count is absent, not zero.
   */
  count?: number | null;
  /** Mint when the count is something Vibe is offering to act on. */
  countTone?: "accent" | "neutral";
  /**
   * A live state word instead of a count, with a pulsing dot beside it.
   *
   * For the Agent, whose interesting fact is what it is doing rather than how
   * many artifacts it has produced — "13" was the number of prepared changes,
   * which is not what a founder glancing at the rail wants to know. Replaces
   * the count when both are set.
   */
  status?: string | null;
};

export function ProjectSidebar({
  projectId,
  projectName,
  repositoryFullName,
  connected,
  switcherItems,
  items,
  footer,
  // No `currentId`: the active section is derived from the URL inside
  // `ProjectNav`, so it cannot disagree with the address bar after a refresh,
  // a Back navigation, or a link opened in a new tab.
}: {
  projectId: string;
  projectName: string;
  repositoryFullName: string | null;
  connected: boolean;
  switcherItems: ProjectSwitcherItem[];
  items: ProjectNavItem[];
  footer: ReactNode;
}) {
  const current = {
    id: projectId,
    name: projectName,
    href: `/app/projects/${projectId}`,
  };

  return (
    <aside
      className={cn(
        "border-line-1 bg-surface-1 flex shrink-0 flex-col border-b px-4 py-5",
        "lg:h-full lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-5 lg:py-6",
      )}
    >
      <div className="px-1">
        <Link href="/app" className="rounded-nav" aria-label="Vibe Business — your projects">
          <VibeLockup />
        </Link>
      </div>

      <nav aria-label="Project sections" className="mt-8 flex min-w-0 flex-col">
        <div className="flex flex-col gap-2">
          <MonoLabel className="px-1 tracking-[0.18em]">Project</MonoLabel>
          <ProjectSwitcher
            current={current}
            repositoryFullName={repositoryFullName}
            connected={connected}
            items={switcherItems}
          />
        </div>

        <Link
          href="/app/products"
          className={cn(
            "text-fg-secondary hover:bg-surface-2 hover:text-fg-body rounded-nav mt-3",
            "flex items-center gap-2.5 px-3 py-2.5 text-sm transition-interactive",
          )}
        >
          <ArrowLeftIcon size={17} className="shrink-0" />
          All products
        </Link>

        <div className="border-line-1 my-4 border-t" />
        <ProjectNav items={items.filter((item) => item.id !== "settings")} />

        <div className="border-line-1 my-4 border-t" />
        <ProjectNav items={items.filter((item) => item.id === "settings")} />
      </nav>

      <div className="mt-6 lg:mt-auto lg:pt-8">{footer}</div>
    </aside>
  );
}

/**
 * Quiet account-to-project orientation. The page title belongs to the route
 * below; this line never repeats repository, branch or connection metadata.
 *
 * `section` adds the current route as a third step. It is optional because most
 * project routes are answered by the rail's own active item, and a crumb that
 * repeats the highlighted rail entry is furniture. A route passes it where the
 * page is a place a founder navigates *within* — the Action Plan, whose
 * selection lives in the URL — so the trail says where a back button goes.
 */
export function ProjectBreadcrumb({
  projectName,
  section,
}: {
  projectName: string;
  /**
   * The current route's own name, when the route is not the project index.
   * Resolved from the URL by `ProjectBreadcrumbTrail` rather than passed by
   * each page, so the trail cannot disagree with the address bar.
   */
  section?: string;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="text-fg-muted flex min-w-0 items-center gap-2.5 text-sm">
        <li>
          <Link
            href="/app/products"
            className="text-fg-body hover:text-fg rounded-sm font-medium transition-interactive"
          >
            My Products
          </Link>
        </li>
        <li aria-hidden>
          <ChevronRightIcon size={14} className="text-fg-meta" />
        </li>
        <li aria-current={section ? undefined : "page"} className="truncate">
          {projectName}
        </li>
        {section && (
          <>
            <li aria-hidden>
              <ChevronRightIcon size={14} className="text-fg-meta" />
            </li>
            <li aria-current="page" className="text-fg-body truncate">
              {section}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

/**
 * One section of the workspace.
 *
 * A `<section>` with an `aria-labelledby` pointing at its own heading, so the
 * document outline matches the navigation a sighted user sees.
 */
export function WorkspaceSection({
  id,
  title,
  description,
  actions,
  eyebrow,
  variant = "default",
  children,
}: {
  id: WorkspaceSectionId;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  variant?: "default" | "intelligence";
  children: ReactNode;
}) {
  const intelligence = variant === "intelligence";

  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6">
      <div className={cn("flex flex-col", intelligence ? "gap-4" : "gap-7")}>
        <div
          className={cn(
            "flex flex-wrap items-end justify-between gap-5",
            intelligence &&
              "business-brain-stage relative items-center overflow-hidden rounded-[1.25rem] border border-line-2 px-5 py-5 sm:px-6 sm:py-6",
          )}
          data-workspace-header={variant}
        >
          {intelligence && (
            <span aria-hidden="true" className="business-brain-grid pointer-events-none absolute inset-0" />
          )}
          <div className="relative z-10 flex min-w-0 flex-col gap-2">
            {eyebrow && (
              <span className="text-mint text-[0.68rem] font-semibold tracking-[0.15em] uppercase">
                {eyebrow}
              </span>
            )}
            <h1
              id={`${id}-heading`}
              className={cn(
                "text-fg font-bold",
                intelligence ? "text-headline sm:text-[2rem]" : "text-headline sm:text-display",
              )}
            >
              {title}
            </h1>
            {description && (
              <p className={cn("max-w-[70ch] text-[0.9375rem]", intelligence ? "text-fg-secondary" : "text-fg-muted")}>
                {description}
              </p>
            )}
          </div>
          {actions && <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Fixed desktop rail + one independently scrolling project document. */
export function ProjectShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-app text-fg-body flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:flex-row lg:overflow-hidden">
      {sidebar}
      <main className="min-w-0 flex-1 lg:h-full lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
        <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-7 px-5 py-7 sm:px-8 sm:py-9 xl:px-10 xl:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
