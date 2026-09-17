"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { DashboardIcon } from "@/components/ui/dashboard-icons";
import { Button } from "@/components/ui/button";
import { DismissIcon } from "@/components/ui/icons.generated";
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
 * Nova, the conversations, and the workspace — three tabs, and the account is
 * the avatar in the corner (UI-35). It was four sections and a *More*, which
 * is the phone's own convention and was the right shape for a product with
 * seven equal destinations. This one does not have seven: it has a
 * conversation and the things that conversation is about, and the bar now says
 * so. Three rather than six for the reason four was better than six — a tab is
 * a fraction of 390px, and at that width labels stop being words and become
 * abbreviations of words.
 *
 * ## What the Workspace tab has to carry, and why the dot is not decoration
 *
 * Putting a section behind a disclosure puts its count there too. Agent is
 * behind this one, and Agent is where a prepared change waits. So the tab
 * carries a dot exactly when something behind it does — derived from the same
 * `count` and `status` the sheet's rows render, never set by hand. It is the
 * one case where a control has to say something about content it is not
 * showing, and an honest dot is cheaper than promoting a section nobody asked
 * for.
 *
 * A dot that could appear when nothing is waiting would be a fabricated
 * signal, which is why it reads the items rather than a flag.
 */

export function MobileTabBar({
  items,
  sheetItems,
  newChat,
  context,
}: {
  /**
   * The tabs themselves: Nova and the conversations (ADR 0109 §1).
   *
   * Two rather than four, and the four were the problem. A phone showed Nova,
   * Health, Product and Plan as four equal tabs with the rest behind *More* —
   * which is the seven-equal-doors screen with a scrollbar, and worse, because
   * the split between the four and the rest was decided by array order rather
   * than by anything a founder would recognise.
   */
  items: ProjectNavItem[];
  /**
   * The workspace, behind its own tab.
   *
   * Not *More*. *More* is a place things are put when they did not fit, which
   * is exactly what it was — a founder had to know that the Agent was hiding
   * there. **Workspace** is a name for the set, and it is the same name the
   * rail uses one breakpoint up, so the two navigations describe the product
   * the same way.
   */
  sheetItems: ProjectNavItem[];
  /**
   * Starting a conversation, inside the sheet.
   *
   * A write, so it is a button and not a tab: a tab is a `<Link>` and Next.js
   * prefetches those. It is beside the product switcher rather than on the bar
   * because a bar of three destinations and one action is a bar where one cell
   * behaves differently from the others with nothing to say so.
   */
  newChat?: ReactNode;
  /**
   * Which product this is, and how to change it — the rail's switcher.
   *
   * It has to land somewhere: below `lg` the rail is not drawn, and a founder
   * with three products cannot be left with no way to reach the other two. The
   * sheet is where it goes because it is product context, not account context,
   * and the avatar in the corner is the account.
   */
  context?: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTitleId = useId();

  const visible = items;
  const hidden = sheetItems;

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
  const actionPlanHref = [...items, ...sheetItems].find((item) => item.id === "action-plan")?.href;
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
                  <DashboardIcon
                    name="workspace"
                    size={20}
                    className={moreActive ? "text-mint" : undefined}
                  />
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
                <span className="text-label leading-none">Workspace</span>
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
            {newChat && <div className="px-1 pb-3">{newChat}</div>}
            <h2 id={moreTitleId} className="text-fg-meta px-2 pb-2 font-mono text-label uppercase">
              Workspace
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
