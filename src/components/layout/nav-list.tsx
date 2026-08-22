"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { isNavItemActive } from "./nav-active";

/**
 * The one navigation renderer in the product (Sprint UI-2 Part 2, generalised
 * in UI-8).
 *
 * It began as `ProjectNav`, serving the project workspace rail. The account
 * level now has a rail too, and the choice was a second renderer or one that
 * does not care whose sections it is drawing. Nothing in here was ever
 * project-specific except the name and one hard-coded id — so this is that
 * component with `exact` replacing the id, and both shells feeding it.
 *
 * ## Why this is a client component
 *
 * The active state is derived from `usePathname`, not from a prop the server
 * guessed and not from local state a click has to remember. That means it is
 * correct after a hard refresh, after browser Back, and after a link is opened
 * in a new tab — the three cases a manually-tracked "selected" value gets
 * wrong.
 *
 * It takes only serialisable props, so the rest of the shell stays on the
 * server.
 *
 * ## Matching
 *
 * Decided by `isNavItemActive`, which is a pure module so the rule can be
 * tested — the browser harness renders fixtures, not real routes, and cannot
 * reach it.
 *
 * ## On a phone this is a strip, and it had two problems (UI-7 §6)
 *
 * Eight sections scroll sideways in a container about three of them wide, and
 * nothing said so: no fade, no cut-off item, just a row that appeared to end
 * after "Business score". Half the workspace was undiscoverable unless you
 * happened to swipe a list that did not look like a list.
 *
 * Worse, the active item was not brought into view. Open Impact or Activity on
 * a phone and the strip showed Overview through Business score, with nothing
 * marked current anywhere on screen — so the one job the active state has,
 * telling you where you are, failed exactly where orientation is hardest.
 */

export type NavItem = {
  /** Stable across renders; used as the React key only. */
  id: string;
  label: string;
  href: string;
  /**
   * Match this item's href exactly rather than as a path prefix. Set on an
   * index route, whose path is a prefix of every sibling's.
   */
  exact?: boolean;
  /**
   * A count beside the label — waiting moves, prepared changes. Only pass a
   * number the domain actually produced; an absent count is absent, not zero.
   */
  count?: number | null;
  /** Mint when the count is something Vibe is offering to act on. */
  countTone?: "accent" | "neutral";
};

export function NavList({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const stripRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    // Nothing to do on the desktop rail, which does not scroll sideways.
    if (strip.scrollWidth <= strip.clientWidth) return;

    // `scrollLeft` rather than `scrollIntoView`: the latter can scroll the
    // *page* as well, and moving the whole workspace to reveal a nav item is a
    // worse answer than not revealing it.
    const overshoot = active.offsetLeft + active.offsetWidth - strip.clientWidth;
    strip.scrollLeft = Math.max(0, Math.min(active.offsetLeft - 16, overshoot + 16));
  }, [pathname]);

  return (
    <ul
      ref={stripRef}
      className={cn(
        "flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible",
        // The affordance: the strip visibly runs off its right edge rather
        // than appearing to end. A mask rather than an overlay so it cannot
        // sit on top of a link and swallow a tap, and only below `lg`, where
        // the list is a row at all.
        "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
        "lg:[mask-image:none]",
      )}
    >
      {items.map((item) => {
        const current = isNavItemActive(pathname, item);

        return (
          <li key={item.id} ref={current ? activeRef : undefined} className="lg:w-full">
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-nav flex items-center gap-3 px-3 py-2.5 text-sm",
                "transition-[color,background-color,border-color] duration-150 ease-vibe",
                current
                  ? "bg-mint-tint border-mint-line text-mint border font-semibold"
                  : "text-fg-secondary hover:bg-surface-2 hover:text-fg-body",
              )}
            >
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
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
