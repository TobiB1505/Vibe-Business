"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  SettingsIcon,
  PlusIcon,
} from "@/components/ui/dashboard-icons";
import { RatingChip } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils/cn";
import { initialsFrom } from "@/modules/auth/initials";

export type ProjectSwitcherItem = {
  id: string;
  name: string;
  href: string;
  /**
   * Three values, because there are three facts.
   *
   * A string is the connected repository. `null` is "nothing is connected",
   * which the panel says out loud. `undefined` is "this render does not know"
   * — the sibling read is a bounded two-column query and does not join the
   * connection table — and an unknown renders no line at all. Printing "No
   * repository connected" for a product whose connection was never read would
   * be the product stating something it has not checked.
   */
  repositoryFullName?: string | null;
};

function ProjectTile({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "from-mint/90 to-mint-deep flex shrink-0 items-center justify-center rounded-inset",
        "bg-gradient-to-br font-bold tracking-[-0.02em] text-mint-ink",
        size === "sm"
          ? "size-6 text-[0.5rem] shadow-[0_6px_16px_-10px_rgb(0_229_160/0.8)]"
          : "size-8 text-label shadow-[0_10px_26px_-14px_rgb(0_229_160/0.8)]",
      )}
    >
      {initialsFrom(name)}
    </span>
  );
}

/**
 * The product identity and the context switch, in one row (UI-14).
 *
 * ## Why it shrank
 *
 * It used to be a bordered card three lines tall — name, repository, a
 * connection state — 110px of a 256px rail spent saying which product you are
 * in on a screen that also has the product's name in the breadcrumb and its
 * navigation directly below. Measured on a 900px viewport that left the
 * section list four of its seven rows tall, so more than half the product's
 * own navigation was behind a scroll nobody had reason to try.
 *
 * It is one row now: the mark, the name, the account's plan, and the selector
 * glyph. The repository and the connection state moved into the panel, beside
 * every *other* product's, which is where a fact you compare belongs — with
 * one exception below.
 *
 * ## Why the plan is here
 *
 * Because a founder should be able to see what they are on without going to
 * Billing, and this is the one control on the screen that is about *the
 * account* rather than about the work. It is a real fact — `PLAN_KEYS` is
 * Free, Builder, Pro — resolved from the live subscription, never guessed.
 *
 * ## The one thing that stayed
 *
 * A product with no repository connected keeps its state on the trigger, as a
 * dot and a word in the panel. Everything Vibe can do for a product depends on
 * that connection, so "not connected" is not a detail to be found by opening
 * something — it is the reason nothing is working.
 *
 * The menu is a native disclosure so it stays keyboard reachable without a
 * second overlay system; route changes close it so a persisted rail never
 * leaves the old menu open over the next product.
 */
export function ProjectSwitcher({
  current,
  connected,
  planName,
  items,
}: {
  current: ProjectSwitcherItem;
  connected: boolean;
  /** The account's plan, from the live subscription. Never a guess. */
  planName: string;
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
        aria-label={`Switch product, current product ${current.name}, ${planName} plan`}
        className={cn(
          "rounded-nav flex cursor-pointer list-none items-center gap-2 px-2.5 py-2",
          "border border-transparent transition-interactive",
          "hover:border-line-2 hover:bg-surface-2 group-open:border-line-2 group-open:bg-surface-2",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {/*
          No mark on the trigger. It is the same initials square the panel
          draws, 24px plus its gap, on a 256px rail — and with the plan beside
          it the product's own name was left 74px, which rendered `Vibe-Business`
          as `Vibe-B…`. A control that truncates the one thing it exists to say
          has spent its width on the wrong half. The lockup is directly above,
          the panel keeps the marks where they help you tell products apart,
          and the name gets the room.
        */}
        <span className="text-fg min-w-0 flex-1 truncate text-body font-semibold">
          {current.name}
        </span>
        {!connected && (
          <span
            aria-hidden
            title="No repository connected"
            className="bg-amber size-1.5 shrink-0 rounded-full"
          />
        )}
        <RatingChip className="shrink-0 px-1.5 py-0.5">{planName}</RatingChip>
        <ChevronsUpDownIcon size={14} className="text-fg-meta shrink-0" />
      </summary>

      <div
        className={cn(
          "border-line-3 bg-app absolute top-[calc(100%+0.5rem)] right-0 left-0 z-40",
          "rounded-panel border p-2 shadow-card",
        )}
      >
        <p className="text-fg-meta px-2.5 py-1.5 text-meta font-semibold">Your products</p>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const selected = item.id === current.id;
            const row = (
              <>
                <ProjectTile name={item.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-semibold">{item.name}</span>
                  {item.repositoryFullName !== undefined && (
                    <span
                      className={cn(
                        "truncate text-meta",
                        item.repositoryFullName ? "text-fg-meta" : "text-amber",
                      )}
                    >
                      {item.repositoryFullName ?? "No repository connected"}
                    </span>
                  )}
                </span>
                {selected && <CheckIcon size={16} className="text-mint shrink-0" />}
              </>
            );

            return (
              <li key={item.id}>
                {selected ? (
                  <div className="bg-mint-tint text-fg rounded-nav flex items-center gap-2.5 px-2.5 py-2">
                    {row}
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={cn(
                      "text-fg-secondary hover:bg-surface-hover hover:text-fg rounded-nav",
                      "flex items-center gap-2.5 px-2.5 py-2 transition-interactive",
                    )}
                  >
                    {row}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        {/*
          What you do *to* the product you are in, and the one way to add
          another — under the control that says which product that is.

          `Project Settings` used to be the last row of the rail, directly
          above the account's own Settings, which asked a founder to read two
          nearly identical labels to tell a project apart from an account. Here
          it cannot be mistaken for the account's: the panel it lives in has
          the product's name at the top and a tick beside it.
        */}
        <div className="border-line-1 mt-2 flex flex-col gap-0.5 border-t pt-2">
          <PanelLink href={`${current.href}/settings`} icon={<SettingsIcon size={16} />}>
            Project Settings
          </PanelLink>
          <PanelLink href="/app/connect/github" icon={<PlusIcon size={16} />}>
            Add a product
          </PanelLink>
        </div>
      </div>
    </details>
  );
}

function PanelLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "text-fg-secondary hover:bg-surface-hover hover:text-fg rounded-nav",
        "flex items-center gap-2.5 px-2.5 py-2 text-body font-medium transition-interactive",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
