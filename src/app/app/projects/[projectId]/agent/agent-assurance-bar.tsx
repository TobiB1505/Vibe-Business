"use client";

import { useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";

/**
 * The assurance strip under a running agent (UI-19, artboard 2b).
 *
 * ## Why it is on screen during a run and not in a help page
 *
 * Because this is the minute a founder is most likely to worry. Software they
 * did not write is changing their product, and the three facts that make that
 * bearable — it is isolated, it is read-only, nothing is live — are worth
 * repeating exactly where the worry happens.
 *
 * All three are true by construction, not by promise: the sandbox holds no
 * credential, the source is read-only, and nothing reaches the default branch
 * without a human approving one exact commit.
 *
 * ## The guidance field
 *
 * The design's fourth cell. It is rendered as the design draws it and is
 * **not wired to anything**: steering a live run means putting customer text
 * into a running agent's prompt, which is a capability this product does not
 * have and cannot grow in a UI sprint. `onGuide` is the seam for it. Until
 * something is passed, the field is presentational and says so to assistive
 * technology rather than pretending to accept input.
 */

const LOCK = (
  <>
    <rect x="5" y="10" width="14" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </>
);

const ASSURANCES = [
  {
    key: "secure",
    title: "Working in a secure environment",
    detail: "All changes are isolated and prepared for your review. Nothing is live yet.",
    accent: true,
    icon: LOCK,
  },
  {
    key: "isolated",
    title: "Isolated environment",
    detail: "Read-only access",
    accent: false,
    icon: LOCK,
  },
  {
    key: "review",
    title: "Changes prepared for review",
    detail: "You're always in control",
    accent: false,
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.4 12.3 2.6 2.6 4.6-5.2" />
      </>
    ),
  },
] as const;

export function AgentAssuranceBar({ showGuidance = true }: { showGuidance?: boolean }) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  return (
    <div
      className="rounded-panel border-line-2 bg-surface-2 grid items-center gap-6 border px-6 py-5 lg:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_minmax(0,25rem)]"
      data-testid="agent-assurance"
    >
      {ASSURANCES.map((item) => (
        <div key={item.key} className="flex items-start gap-3.5">
          <span
            className={cn(
              "flex flex-none items-center justify-center",
              item.accent
                ? "border-mint-line bg-mint-tint text-mint size-9 rounded-[10px] border"
                : "text-fg-secondary mt-0.5",
            )}
          >
            <svg
              viewBox="0 0 24 24"
              width={item.accent ? 17 : 19}
              height={item.accent ? 17 : 19}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {item.icon}
            </svg>
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-fg-body text-[0.8125rem] font-semibold">{item.title}</span>
            <span className="text-fg-muted max-w-[30ch] text-xs leading-relaxed">
              {item.detail}
            </span>
          </span>
        </div>
      ))}

      {showGuidance && (
        <div className="flex flex-col gap-2">
          {/*
            Presentational. Marked `aria-hidden` because an input a screen
            reader can reach but nothing can receive is worse than one it is
            never offered.
          */}
          <div
            aria-hidden="true"
            className="rounded-full border-line-3 bg-field flex items-center gap-3 border px-4.5 py-3"
          >
            <span className="text-fg-meta flex-1 text-sm">Ask or guide Vibe&hellip;</span>
            <span
              className="bg-mint h-[15px] w-0.5"
              style={animate ? { animation: "vibe-caret 1s steps(1) infinite" } : undefined}
            />
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-mint flex-none"
            >
              <path d="M4 12h16m-6-6 6 6-6 6" />
            </svg>
          </div>
          <span className="text-fg-meta text-center text-xs">
            Tip: Ask for adjustments or give direction
          </span>
        </div>
      )}
    </div>
  );
}
