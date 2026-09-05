"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One tablist, for every place the product has sections inside a surface.
 *
 * ## Why this is hand-written
 *
 * shadcn's Tabs recipe is a Radix wrapper, and Vibe has no Radix dependency to
 * put it on. What a dependency would buy here is roving tabindex and a handful
 * of ARIA attributes — the WAI-ARIA tabs pattern, which is short enough to own
 * outright. The sourcing specification reaches the same conclusion (P14): port
 * the behaviour, not the package.
 *
 * ## Manual activation, which is the one behaviour change
 *
 * The Business Health detail column had a tablist of its own, and its arrow
 * keys *selected* as they moved. That reads fine with a mouse and badly with a
 * screen reader: every arrow press swaps the panel underneath, so browsing the
 * tabs means listening to four panels announce themselves. Here the arrows move
 * focus and Enter or Space selects, which is what the pattern prescribes for a
 * tablist whose panels are not trivial.
 *
 * ## What this renders, and what it does not
 *
 * The tablist only. Panels stay with the caller, because the caller is the one
 * that knows whether its panel animates, and a primitive that owned the panel
 * would have to own that too. `tabTriggerId` and `tabPanelId` are exported so
 * the two halves can point at each other without agreeing on a string format.
 */

export type TabDefinition<Value extends string> = {
  value: Value;
  label: ReactNode;
  /**
   * Present means unavailable, and the string is the reason.
   *
   * A disabled control that cannot say why is a dead end, so the reason is
   * required rather than optional. It is described rather than named — the tab
   * still answers "which section", and the reason is the second thing said
   * about it, not part of what it is called.
   */
  unavailable?: string;
};

/** The id of a tab's trigger, for the panel's `aria-labelledby`. */
export function tabTriggerId(base: string, value: string): string {
  return `${base}-${value}-tab`;
}

/** The id of the hidden sentence that says why a tab is unavailable. */
function reasonId(base: string, value: string): string {
  return `${base}-${value}-reason`;
}

/** The id of a tab's panel, for the trigger's `aria-controls`. */
export function tabPanelId(base: string, value: string): string {
  return `${base}-${value}-panel`;
}

export function TabList<Value extends string>({
  tabs,
  value,
  onSelect,
  label,
  idBase,
  tone = "mint",
  className,
}: {
  tabs: readonly TabDefinition<Value>[];
  value: Value;
  onSelect: (value: Value) => void;
  /** Names the tablist for assistive technology. Never rendered. */
  label: string;
  /** Shared with the panels through `tabTriggerId` / `tabPanelId`. */
  idBase: string;
  /**
   * The selected tab's colour.
   *
   * Mint is the default and the rule. `coral` exists because the Business
   * Health detail column tints its tabs with the dimension's own health, so a
   * weak dimension does not carry a healthy accent — dropping that here would
   * have been a design change smuggled in as a refactor.
   */
  tone?: "mint" | "coral";
  className?: string;
}) {
  const triggers = useRef<Partial<Record<Value, HTMLButtonElement | null>>>({});

  /** Focus moves; selection does not follow it. */
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, current: Value) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const index = tabs.findIndex((tab) => tab.value === current);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs[tabs.length - 1]
          : tabs[(index + step + tabs.length) % tabs.length];

    triggers.current[next.value]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      /*
       * Scrolls rather than wraps. A tablist on two rows loses the one thing
       * that makes it readable at a glance — that the sections are a single
       * row of peers — and the arrow keys then move in a direction the eye
       * cannot follow.
       */
      className={cn("border-line-1 flex gap-1 overflow-x-auto border-b", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        const disabled = tab.unavailable !== undefined;

        return (
          <button
            key={tab.value}
            ref={(element) => {
              triggers.current[tab.value] = element;
            }}
            type="button"
            role="tab"
            id={tabTriggerId(idBase, tab.value)}
            aria-controls={tabPanelId(idBase, tab.value)}
            aria-selected={selected}
            aria-disabled={disabled || undefined}
            /*
             * `aria-describedby` rather than `aria-description`: the latter is
             * ARIA 1.3, is not in the `tab` role's supported set, and is not
             * carried by the screen readers this has to work in today.
             */
            aria-describedby={disabled ? reasonId(idBase, tab.value) : undefined}
            title={tab.unavailable}
            /*
             * Roving tabindex: one stop for the whole tablist, so Tab reaches
             * the tabs once and then moves on to the panel.
             */
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!disabled) onSelect(tab.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!disabled) onSelect(tab.value);
                return;
              }
              moveFocus(event, tab.value);
            }}
            className={cn(
              "relative min-h-11 shrink-0 px-3 text-ui font-medium transition-interactive",
              "rounded-nav focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none",
              disabled
                ? "text-fg-disabled cursor-not-allowed"
                : selected
                  ? cn("cursor-pointer", tone === "coral" ? "text-coral" : "text-mint")
                  : "text-fg-muted hover:text-fg cursor-pointer",
            )}
          >
            {tab.label}
            {tab.unavailable !== undefined && (
              <span id={reasonId(idBase, tab.value)} className="sr-only">
                {tab.unavailable}
              </span>
            )}
            {selected && (
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-2 -bottom-px h-0.5",
                  tone === "coral" ? "bg-coral" : "bg-mint",
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
