"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { DashboardIcon } from "@/components/ui/dashboard-icons";
import { Button } from "@/components/ui/button";
import { DismissIcon, MoreIcon } from "@/components/ui/icons.generated";
import { Sheet } from "@/components/ui/sheet";
import { agentMoveHref, PLAN_OPPORTUNITY_PARAM } from "@/modules/action-plans/source";
import { cn } from "@/lib/utils/cn";
import type { ProjectNavItem } from "./project-shell";

/**
 * The phone's navigation (UI-35).
 *
 * ## Why this exists rather than a narrower rail
 *
 * Because a rail is not a thing that gets smaller. On a wide screen a column
 * down the left is *peripheral* — the eye starts at the content and the
 * navigation waits in the corner of vision. Stacked into a phone's single
 * column it becomes the first thing on the screen, and measurement is what
 * settled it: the strip occupied 476px of an 844px viewport, so the page
 * heading began at y=546 and a founder met the navigation, the balance, the
 * identity and a palette switch before one word about their product.
 *
 * The sections themselves fared no better. They were a horizontal scroller
 * holding 836px of list in a 358px window — less than half of it visible, the
 * fifth item clipped mid-word, and nothing but a fade to say the rest existed.
 * A list you have to swipe to discover is a list most people never discover.
 *
 * ## The shape
 *
 * Four sections in the thumb's reach and the rest behind *More*, which is the
 * phone's own convention and not an invention of this file. Four rather than
 * six because a tab is a fifth of 390px: at six the labels stop being words
 * and become abbreviations of words, and an unlabelled icon row is a quiz.
 *
 * ## What More has to carry, and why the dot is not decoration
 *
 * Hiding a section behind a disclosure hides its count with it. Agent sits
 * there, and Agent is where a prepared change waits. So More carries a dot
 * exactly when something behind it does — derived from the same `count` and
 * `status` the visible tabs render, never set by hand. It is the one case
 * where a control has to say something about content it is not showing, and
 * an honest dot is cheaper than promoting a section nobody asked for.
 *
 * A dot that could appear when nothing is waiting would be a fabricated
 * signal, which is why it reads the items rather than a flag.
 */

/** How many sections reach the bar itself. The rest are behind *More*. */
const VISIBLE_TABS = 4;

export function MobileTabBar({
  items,
  context,
}: {
  items: ProjectNavItem[];
  /**
   * Which product this is, and how to change it — the rail's switcher.
   *
   * It has to land somewhere: below `lg` the rail is not drawn, and a founder
   * with three products cannot be left with no way to reach the other two. The
   * sheet behind *More* is where it goes because it is product context, not
   * account context, and the avatar in the corner is the account.
   */
  context?: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTitleId = useId();

  const visible = items.slice(0, VISIBLE_TABS);
  const hidden = items.slice(VISIBLE_TABS);

  function isActive(href: string): boolean {
    if (pathname === href) return true;
    /*
     * Same rule as the desktop rail: the index route matches exactly, or it
     * lights up on every child route beneath it. Kept in both because the two
     * bars are two presentations of one list and a shared helper would have to
     * be told which item is the index anyway.
     */
    const homeHref = items.find((item) => item.id === "home")?.href;
    if (href === homeHref) return false;
    return pathname.startsWith(`${href}/`);
  }

  /* The Move being read, carried onward to Agent — the rail's rule (UI-S3 §5). */
  const actionPlanHref = items.find((item) => item.id === "action-plan")?.href;
  const selectedMove =
    actionPlanHref && pathname === actionPlanHref ? searchParams.get(PLAN_OPPORTUNITY_PARAM) : null;

  function hrefFor(item: ProjectNavItem): string {
    if (item.id !== "agent" || !selectedMove) return item.href;
    return agentMoveHref(item.href, selectedMove);
  }

  /*
   * Something behind More is waiting. Read from the items rather than passed
   * in, so a dot cannot outlive the thing it is about.
   */
  const moreWaiting = hidden.some(
    (item) => typeof item.status === "string" || (typeof item.count === "number" && item.count > 0),
  );
  const moreActive = hidden.some((item) => isActive(item.href));

  return (
    <>
      <nav
        aria-label="Sections"
        data-testid="mobile-tab-bar"
        /*
          The hook anything fixed to the bottom of the screen needs, so it can
          clear this bar rather than land on it. `globals.css` carries the one
          rule; see the consent banner, which was covering the whole navigation.
        */
        data-tabbar=""
        className={cn(
          "pointer-events-auto fixed inset-x-0 bottom-0 z-40 lg:hidden",
          "vibe-chrome border-line-1 border-t",
          /*
           * The home indicator is added to the bar rather than reserved by the
           * frame: a phone without one gets no dead band, and the bar's own
           * height stays the number `--tabbar-h` says it is.
           */
          "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <ul className="flex h-[var(--tabbar-h)] items-stretch">
          {visible.map((item) => {
            const current = isActive(item.href);
            return (
              <li key={item.id} className="flex-1">
                <Link
                  href={hrefFor(item)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative flex h-full flex-col items-center justify-center gap-1 px-1",
                    "transition-[color] duration-150 ease-vibe",
                    current ? "text-fg font-semibold" : "text-fg-muted",
                  )}
                >
                  {/*
                    The current tab is marked on the bar's own edge rather than
                    by a filled pill. A pill at this size is a coloured block
                    with a word in it, and five of them read as five buttons
                    rather than as one place you are.
                  */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-x-3 top-0 h-0.5 rounded-full",
                      current ? "bg-mint" : "bg-transparent",
                    )}
                  />
                  <span className="relative">
                    <DashboardIcon
                      name={item.icon}
                      size={20}
                      className={current ? "text-mint" : undefined}
                    />
                    <TabBadge count={item.count} status={item.status} />
                  </span>
                  <span className="text-label leading-none">{item.short}</span>
                </Link>
              </li>
            );
          })}

          {hidden.length > 0 && (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={cn(
                  "relative flex h-full w-full flex-col items-center justify-center gap-1 px-1",
                  "transition-[color] duration-150 ease-vibe",
                  moreActive ? "text-fg font-semibold" : "text-fg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-3 top-0 h-0.5 rounded-full",
                    moreActive ? "bg-mint" : "bg-transparent",
                  )}
                />
                <span className="relative">
                  <MoreIcon size={20} className={moreActive ? "text-mint" : undefined} />
                  {moreWaiting && (
                    <span
                      data-testid="more-waiting"
                      /*
                        Named for a screen reader, because the dot is the only
                        thing saying a hidden section has something in it.
                      */
                      aria-label="Something is waiting"
                      role="img"
                      className="bg-mint shadow-dot-mint absolute -top-0.5 -right-0.5 size-2 rounded-full"
                    />
                  )}
                </span>
                <span className="text-label leading-none">More</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Sheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        side="bottom"
        labelledBy={moreTitleId}
      >
        {moreOpen && (
          <div className="flex flex-col gap-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {/* Mounted only while open — the switcher inside is the rail's, and
              two of it in one document is two of everything it contains. */}
            {/*
              Its own row at the top, not beside the heading below it (UI-39).
              Next to `More sections` the mark read as belonging to that label
              rather than to the sheet, and the product context above it made
              that reading worse — a control has to sit where the thing it acts
              on begins. Same row and same mark as the account sheet's, because
              two sheets on one phone that close differently are two things to
              learn.
            */}
            <div className="flex justify-end">
              <Button
                variant="ghost"
                icon={<DismissIcon size={16} />}
                label="Close"
                onClick={() => setMoreOpen(false)}
                className="-me-1"
              />
            </div>
            {context && <div className="pb-3">{context}</div>}
            {/*
              The way out, said rather than implied (UI-39). A tap outside
              dismisses and Escape does too, but a phone has no Escape key and
              a scrim is not a control anybody has been told about — measured,
              the only exit a founder could see here was the browser's back
              button.

              It joins the heading's row rather than floating: the same mark
              and the same label as the evidence drawer's, which is the one
              sheet in this product that already had one.
            */}
            <h2 id={moreTitleId} className="text-fg-meta px-2 pb-2 font-mono text-label uppercase">
              More sections
            </h2>
            {hidden.map((item) => {
              const current = isActive(item.href);
              return (
                <Link
                  key={item.id}
                  href={hrefFor(item)}
                  aria-current={current ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    /* 48px: a row in a sheet is a touch target, not a menu line. */
                    "rounded-nav flex min-h-12 items-center gap-3 px-3 text-body",
                    current
                      ? "bg-mint-tint border-mint-line text-fg border font-semibold"
                      : "text-fg-secondary",
                  )}
                >
                  <DashboardIcon
                    name={item.icon}
                    size={19}
                    className={cn("shrink-0", current && "text-mint")}
                  />
                  <span>{item.label}</span>
                  <span className="ml-auto">
                    <TabBadge count={item.count} status={item.status} inline />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Sheet>
    </>
  );
}

/**
 * A count, or a live status word, or nothing.
 *
 * Nothing is the third state and it is the common one: a section with no
 * waiting work renders no badge at all rather than a zero. `null` is not zero
 * anywhere in this product, and a tab bar is not where that starts being
 * negotiable.
 */
function TabBadge({
  count,
  status,
  inline = false,
}: {
  count?: number | null;
  status?: string | null;
  inline?: boolean;
}) {
  if (typeof status === "string") {
    return inline ? (
      <span className="text-mint font-mono text-label tracking-[0.1em] uppercase">{status}</span>
    ) : (
      <span
        aria-label={status}
        role="img"
        className="bg-mint shadow-dot-mint absolute -top-0.5 -right-0.5 size-2 rounded-full"
      />
    );
  }

  if (typeof count !== "number" || count <= 0) return null;

  return inline ? (
    <span className="bg-surface-hover text-fg-prose rounded-full px-2 py-0.5 font-mono text-label">
      {count}
    </span>
  ) : (
    <span className="bg-mint text-ground absolute -top-1.5 -right-2.5 min-w-4 rounded-full px-1 text-center font-mono text-[0.5625rem] leading-4 font-semibold">
      {count}
    </span>
  );
}
