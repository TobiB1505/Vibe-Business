"use client";

import { motion, useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { MonoLabel } from "@/components/ui/typography";
import type { StoredExecutionEvent } from "@/modules/coding-agent/observability/events";

/**
 * Vibe activity, as a record (UI-19, build stage).
 *
 * ## Why this differs from the stage-two list
 *
 * The stage rail already shows intent. This record belongs beside the working
 * core because it is the Agent's activity: what Vibe did, when it did it, and
 * the path it touched. Validation owns the independent sandbox checks instead
 * of repeating the Agent run's history.
 *
 * ## Everything Vibe did, not only what it wrote
 *
 * The whole event stream: the files it read and changed, the commands it ran,
 * the milestones it passed. An earlier build filtered to events naming a file
 * and showed four writes as if that were the activity.
 *
 * ## Every line is Vibe's own sentence
 *
 * `summary` is composed by Vibe from a closed vocabulary and never by a model,
 * and the path comes from the event's metadata. Nothing here is generated for
 * the screen, and an event without a path renders without a chip rather than
 * with an invented one.
 */

const FILE_ICON = (
  <>
    <path d="M6 3h7.5L19 8.5V21H6V3Z" />
    <path d="M13.5 3v5.5H19" />
  </>
);

/** Paths live in metadata under the key the writers already use. */
function pathOf(event: StoredExecutionEvent): string | null {
  const value = event.metadata.path ?? event.metadata.file ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clockOf(occurredAt: string): string | null {
  const at = new Date(occurredAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function AgentFileActivity({
  events,
  /** How many to show. The rest stay behind the disclosure. */
  limit = 6,
  title = "Vibe activity",
  live = false,
}: {
  events: readonly StoredExecutionEvent[];
  limit?: number;
  /** Named for what the stage is reporting, not for the component. */
  title?: string;
  /** A pulse means new Agent events may still arrive. Settled records stay still. */
  live?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  const shown = events.slice(-limit).reverse();
  const remaining = Math.max(0, events.length - shown.length);

  return (
    <section
      className="rounded-panel border-line-3 bg-surface-3 flex flex-col gap-4 border p-5"
      data-testid="agent-file-activity"
    >
      <div className="flex items-center justify-between gap-2.5">
        <MonoLabel as="h3" className="text-mint">
          {title}
        </MonoLabel>
        {live && (
          <span
            aria-hidden="true"
            className="bg-mint shadow-dot-mint size-[7px] rounded-full"
            style={
              animate
                ? { animation: "vibe-soft-pulse var(--duration-pulse) var(--ease-vibe) infinite" }
                : undefined
            }
          />
        )}
      </div>

      <ul className="flex flex-col gap-4">
        {shown.map((event, index) => {
          const path = pathOf(event);
          const clock = clockOf(event.occurredAt);

          return (
            <motion.li
              key={event.sequence}
              className="flex gap-3.5"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.2, 0.7, 0.2, 1],
                delay: reduceMotion ? 0 : index * 0.08,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-fg-secondary mt-0.5 flex-none"
                aria-hidden="true"
              >
                {FILE_ICON}
              </svg>

              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-fg-body text-sm font-medium">{event.summary}</span>
                  {clock !== null && (
                    <span className="text-fg-meta flex-none font-mono text-[0.6875rem]">
                      {clock}
                    </span>
                  )}
                </span>
                {path !== null && (
                  <span className="border-line-2 bg-well text-fg-prose self-start rounded-full border px-2.5 py-0.5 font-mono text-[0.6875rem]">
                    {path}
                  </span>
                )}
              </span>
            </motion.li>
          );
        })}
      </ul>

      {remaining > 0 && (
        /*
          A disclosure, not a sentence. "+ 10 more changes" was a count that
          did nothing — a founder reads it as an offer and gets no way to take
          it. Every event is here; the list simply opens.
        */
        <details className="group border-line-2 border-t pt-3.5">
          <summary className="text-fg-muted hover:text-fg-body marker:content-none flex cursor-pointer items-center gap-2 text-[0.8125rem]">
            <span className="text-fg-meta transition-transform group-open:rotate-90">›</span>
            <span className="group-open:hidden">
              Show {remaining} more {remaining === 1 ? "change" : "changes"}
            </span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>

          <ul className="mt-4 flex flex-col gap-4">
            {events
              .slice(0, events.length - shown.length)
              .reverse()
              .map((event) => {
                const path = pathOf(event);
                const clock = clockOf(event.occurredAt);
                return (
                  <li key={event.sequence} className="flex gap-3.5">
                    <span className="w-[18px] flex-none" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-fg-body text-sm font-medium">{event.summary}</span>
                        {clock !== null && (
                          <span className="text-fg-meta flex-none font-mono text-[0.6875rem]">
                            {clock}
                          </span>
                        )}
                      </span>
                      {path !== null && (
                        <span className="border-line-2 bg-well text-fg-prose self-start rounded-full border px-2.5 py-0.5 font-mono text-[0.6875rem]">
                          {path}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        </details>
      )}
    </section>
  );
}
