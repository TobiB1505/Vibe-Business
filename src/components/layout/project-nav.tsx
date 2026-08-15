"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ProjectNavItem } from "./project-shell";
import { cn } from "@/lib/utils/cn";

/**
 * Workspace navigation (Sprint UI-2 Part 2).
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
 * Overview is the index route, so it is active only on an exact match —
 * `startsWith` would light it up on every child route. Every other section is
 * matched exactly too, with the boundary check reserved for future child routes
 * (a prepared-change detail page would keep "Prepared" active).
 */
export function ProjectNav({ items }: { items: ProjectNavItem[] }) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (pathname === href) return true;
    // A child route keeps its parent section active — but only at a real path
    // boundary, so `/prepared` never matches `/prepared-something-else`.
    const overviewHref = items.find((item) => item.id === "overview")?.href;
    if (href === overviewHref) return false;
    return pathname.startsWith(`${href}/`);
  }

  return (
    <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const current = isActive(item.href);

        return (
          <li key={item.id} className="lg:w-full">
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
