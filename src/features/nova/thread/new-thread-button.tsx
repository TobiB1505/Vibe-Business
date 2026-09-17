"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons.generated";
import { cn } from "@/lib/utils/cn";
import { startNewThreadAction } from "./commands/new-thread";

/**
 * *New chat*.
 *
 * ## Why a button and not a link
 *
 * Because opening a conversation is a write, and a link is a read. A `<Link>`
 * to a route that created a thread would mean a prefetch created one —
 * Next.js prefetches links in the viewport — so a founder who scrolled past the
 * rail would collect empty threads without pressing anything. The same rule
 * `/threads` follows for the opposite reason: looking at a screen never writes
 * a row.
 *
 * It costs nothing and starts nothing, so there is no price and no
 * confirmation: a conversation is free (ADR 0110) and an empty thread has no
 * consequence to disclose.
 */
export function NewThreadButton({
  projectId,
  /**
   * `row` is the rail: a button wearing a navigation row's shape, because it
   * sits in that list and a control with its own spacing costs the rail half a
   * section it does not have on a laptop. `button` is everywhere else.
   */
  appearance = "button",
  className,
}: {
  projectId: string;
  appearance?: "button" | "row";
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const start = () => startTransition(() => startNewThreadAction(projectId));

  if (appearance === "row") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={start}
        className={cn(
          "rounded-nav text-fg-secondary hover:bg-surface-2 hover:text-fg-body flex w-full",
          "items-center gap-3 px-3 py-2.5 text-body transition-interactive",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
          "disabled:opacity-60",
          className,
        )}
      >
        <PlusIcon size={19} className="shrink-0" />
        <span className="whitespace-nowrap">{pending ? "Starting" : "New chat"}</span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className={className}
      disabled={pending}
      onClick={start}
    >
      {pending ? "Starting" : "New chat"}
    </Button>
  );
}
