"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { CheckIcon, ChevronDownIcon, SettingsIcon } from "@/components/ui/dashboard-icons";
import { cn } from "@/lib/utils/cn";
import { initialsFrom } from "@/modules/auth/initials";

export type ProjectSwitcherItem = {
  id: string;
  name: string;
  href: string;
};

function ProjectTile({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "from-mint/90 to-mint-deep flex size-9 shrink-0 items-center justify-center rounded-inset",
        "bg-gradient-to-br text-caption font-bold tracking-[-0.02em] text-mint-ink shadow-[0_10px_26px_-14px_rgb(0_229_160/0.8)]",
      )}
    >
      {initialsFrom(name)}
    </span>
  );
}

/**
 * The project identity and the context switch are one control.
 *
 * The current repository is shown only here in the project shell. Every page
 * underneath can therefore spend its header on the page itself. The menu is a
 * native disclosure so it remains keyboard reachable without introducing a
 * second overlay system; route changes close it so a persisted App Router
 * layout never leaves the old menu open over the next product.
 */
export function ProjectSwitcher({
  current,
  repositoryFullName,
  connected,
  items,
}: {
  current: ProjectSwitcherItem;
  repositoryFullName: string | null;
  connected: boolean;
  items: ProjectSwitcherItem[];
}) {
  const pathname = usePathname();
  const disclosureRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (disclosureRef.current) disclosureRef.current.open = false;
  }, [pathname]);

  return (
    <details ref={disclosureRef} data-testid="project-switcher" className="group relative">
      <summary
        aria-label={`Switch product, current product ${current.name}`}
        className={cn(
          "border-line-3 bg-surface-3 rounded-panel flex cursor-pointer list-none items-center gap-3 border",
          "px-3 py-3 transition-interactive hover:border-line-strong hover:bg-surface-4",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <ProjectTile name={current.name} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-fg truncate text-body font-semibold">{current.name}</span>
          {repositoryFullName && (
            <span className="text-fg-muted truncate text-meta">{repositoryFullName}</span>
          )}
          <span className={connected ? "text-mint text-meta" : "text-fg-meta text-meta"}>
            <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-current" />
            {connected ? "Connected" : "No repository connected"}
          </span>
        </span>
        <ChevronDownIcon
          size={16}
          className="text-fg-meta shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>

      <div
        className={cn(
          "border-line-3 bg-app absolute top-[calc(100%+0.625rem)] right-0 left-0 z-40",
          "rounded-panel border p-2 shadow-card",
        )}
      >
        <p className="text-fg-meta px-2.5 py-2 text-meta font-semibold">Your products</p>
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const selected = item.id === current.id;
            return (
              <li key={item.id}>
                {selected ? (
                  <div className="bg-mint-tint text-fg rounded-nav flex items-center gap-3 px-2.5 py-2.5">
                    <ProjectTile name={item.name} />
                    <span className="min-w-0 flex-1 truncate text-body font-semibold">
                      {item.name}
                    </span>
                    <CheckIcon size={17} className="text-mint shrink-0" />
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={cn(
                      "text-fg-secondary hover:bg-surface-hover hover:text-fg rounded-nav",
                      "flex items-center gap-3 px-2.5 py-2.5 transition-interactive",
                    )}
                  >
                    <ProjectTile name={item.name} />
                    <span className="min-w-0 flex-1 truncate text-body font-medium">
                      {item.name}
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        {/*
          The one thing you do *to* the project you are in, under the control
          that says which project that is.

          `Project Settings` used to be the last row of the rail, directly
          above the account's own Settings — two rows a founder had to read to
          tell apart, and the one about *this* project was the one further from
          the control that names it. Here it cannot be mistaken for the
          account's: the panel it lives in has the project's name at the top
          and a tick beside it.

          `View all products` stood beside it and is gone. The list of every
          product is what this panel *is* — it is open, the products are in it,
          and a row offering to go and see them somewhere else was offering the
          founder the thing they were already looking at.
        */}
        <div className="border-line-1 mt-2 flex flex-col gap-1 border-t pt-2">
          <Link
            href={`${current.href}/settings`}
            className={cn(
              "text-fg-secondary hover:bg-surface-hover hover:text-fg rounded-nav",
              "flex items-center gap-3 px-3 py-2.5 text-body font-medium transition-interactive",
            )}
          >
            <SettingsIcon size={17} />
            Project Settings
          </Link>
        </div>
      </div>
    </details>
  );
}
