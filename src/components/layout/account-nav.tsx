"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AccountSection } from "./account-shell";
import { accountSectionHref } from "./account-shell";
import { DashboardIcon, type DashboardIconName } from "@/components/ui/dashboard-icons";
import { cn } from "@/lib/utils/cn";

/**
 * Account navigation (CORE-6).
 *
 * A client component for one reason, the same one `ProjectNav` gives: the
 * active item is derived from `usePathname`, not from a prop the server
 * guessed. That is what makes it correct after a hard refresh, after Back, and
 * in a tab opened from a link — the three cases a remembered "selected" value
 * gets wrong.
 *
 * ## Matching
 *
 * Home is the index route, so it is active only on an exact match; a
 * `startsWith` would light it on every account page. Everything else matches at
 * a real path boundary, so `/products` never matches `/products-archive`.
 *
 * ## The "Soon" rows
 *
 * Rendered as plain list items with a badge — no `<Link>`, no `<button>`, no
 * `href`, nothing focusable. A disabled control still occupies a tab stop and
 * still invites a click; a label does neither. The badge is the whole
 * affordance, and it says the true thing.
 */
export function AccountNav({
  items,
  soon,
}: {
  items: AccountSection[];
  soon: { id: string; label: string; icon: DashboardIconName }[];
}) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (pathname === href) return true;
    if (href === "/app") return false;
    return pathname.startsWith(`${href}/`);
  }

  return (
    <ul
      className={cn(
        "flex items-center gap-1 overflow-x-auto lg:flex-col lg:items-stretch lg:overflow-visible",
        // The strip below `lg` runs off its right edge rather than appearing to
        // end. A mask rather than an overlay, so it cannot sit on a link and
        // swallow a tap.
        "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
        "lg:[mask-image:none]",
      )}
    >
      {items.map((item) => {
        const href = accountSectionHref(item.id);
        const current = isActive(href);

        return (
          <li key={item.id} className="lg:w-full">
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-nav flex items-center gap-3 px-3 py-3 text-sm font-medium",
                "transition-[color,background-color,border-color] duration-150 ease-vibe",
                current
                  ? "bg-mint-tint border-mint-line text-mint border font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
                  : "text-fg-secondary hover:bg-surface-2 hover:text-fg-body",
              )}
            >
              <DashboardIcon name={item.icon} size={19} className="shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          </li>
        );
      })}

      <li aria-hidden className="border-line-1 my-3 hidden border-t lg:block" />

      {soon.map((item) => (
        <li
          key={item.id}
          className="text-fg-disabled flex items-center gap-3 px-3 py-3 text-sm font-medium lg:w-full"
        >
          <DashboardIcon name={item.icon} size={19} className="shrink-0" />
          <span className="whitespace-nowrap">{item.label}</span>
          <span
            className={cn(
              "bg-surface-hover text-fg-meta ml-auto rounded-full px-2 py-0.5",
              "text-[0.625rem] font-semibold tracking-[0.04em] uppercase",
            )}
          >
            Soon
          </span>
        </li>
      ))}
    </ul>
  );
}
