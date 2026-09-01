"use client";

import { useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";

/**
 * The one primary action (UI-19, artboard 2a).
 *
 * ## Why the sweep is allowed here and nowhere else
 *
 * This is the single moment on the surface where a founder is being asked to
 * do something, and the whole screen is otherwise still. The sweep is a
 * highlight crossing a button every few seconds — it says *this is the thing*,
 * and it carries no claim about speed, progress or outcome, which is what
 * separates it from the animations this product refuses.
 *
 * ## It is a slot, not a button
 *
 * The real control is priced and confirmed, and it belongs to the route that
 * can start a run. This renders the design's treatment around whatever that
 * route passes, so the sweep and the lock line never wrap something that
 * cannot actually start.
 */
export function AgentStartCta({
  children,
  creditEstimate,
  note = "You can stop Vibe at any time",
}: {
  children: React.ReactNode;
  /** Already-resolved run ceiling. Never derived in the client. */
  creditEstimate?: string | null;
  note?: string;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  return (
    <div className="flex w-full max-w-[27rem] flex-col items-center gap-3" data-testid="agent-start">
      {creditEstimate && (
        <div
          className="border-line-2 bg-surface-2 flex w-full items-center justify-between gap-4 rounded-panel border px-4 py-3"
          data-testid="agent-credit-estimate"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-mint flex-none"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M9.2 8.5h4.1a2.2 2.2 0 0 1 0 4.4h-2.6a2.2 2.2 0 0 0 0 4.4h4.1M12 6.6v10.8" />
            </svg>
            <span className="text-fg-muted text-sm">Estimated Credit use</span>
          </span>
          <strong className="text-fg-body shrink-0 text-sm font-semibold tabular-nums">
            Up to {creditEstimate} Credits
          </strong>
        </div>
      )}

      <div className="relative w-full overflow-hidden rounded-full">
        {children}
        {animate && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-[26%]"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.34), transparent)",
              animation: "vibe-sweep 3.6s var(--ease-vibe) infinite",
            }}
          />
        )}
      </div>

      <span className="text-fg-muted flex items-center gap-2 text-[0.8125rem]">
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="10" width="14" height="11" rx="2.5" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        {note}
      </span>
    </div>
  );
}

/**
 * The three facts under a ready agent (UI-19, artboard 2a).
 *
 * The reference draws "Estimated time ~1–2 hours" and "Expected changes 8–15
 * files" beside the safety cell. Neither has anything behind it: no estimator
 * exists, and how many files a run will touch is unknown until it has touched
 * them — which is the same reason this product refuses progress percentages.
 *
 * What *is* true before a run starts is where it happens and what it may
 * reach, so the strip carries the safety facts and the two real inputs Vibe is
 * working from. Once a run has finished, the counts it produced are real and
 * the stages above show them.
 */
export function AgentReadyFacts({
  repository,
  liveUrl,
  className,
}: {
  repository: string | null;
  liveUrl: string | null;
  className?: string;
}) {
  const facts = [
    {
      key: "safety",
      title: "Safe execution",
      detail: "Isolated environment · read-only access",
      icon: (
        <>
          <path d="M12 3.2 5 6v5.6c0 4 2.9 7.6 7 9.2 4.1-1.6 7-5.2 7-9.2V6l-7-2.8Z" />
          <path d="m9 12.2 2.2 2.2 4-4.4" />
        </>
      ),
    },
    {
      key: "code",
      title: "Working from your code",
      detail: repository ?? "No repository connected",
      icon: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14" />,
    },
    {
      key: "product",
      title: "Checked against your product",
      detail: liveUrl ?? "No live product yet",
      icon: (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 12h17M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
        </>
      ),
    },
  ];

  return (
    <div
      className={cn(
        "rounded-panel border-line-2 bg-surface-2 grid min-h-[6.5rem] gap-7 border px-7 py-6 sm:grid-cols-3",
        className,
      )}
      data-testid="agent-ready-facts"
    >
      {facts.map((fact) => (
        <div key={fact.key} className="flex items-center gap-3.5">
          <svg
            viewBox="0 0 24 24"
            width="21"
            height="21"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fg-secondary flex-none"
            aria-hidden="true"
          >
            {fact.icon}
          </svg>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-fg-body text-sm font-semibold">{fact.title}</span>
            <span className="text-fg-muted truncate text-sm">{fact.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
