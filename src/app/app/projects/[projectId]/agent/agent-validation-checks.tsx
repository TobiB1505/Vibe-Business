"use client";

import { motion, useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";

/**
 * The validation checks (UI-19, artboard 2c).
 *
 * ## Four rows, because there are four checks
 *
 * `install`, `typecheck`, `test`, `build` — the steps `planValidationSteps`
 * actually constructs and the sandbox actually runs. The reference composition
 * also drew "Linting" and "Security scan"; neither exists, and a green tick
 * beside a check nobody ran is the one thing a safety screen must never show.
 * The layout is the design's; the rows are the run's.
 *
 * ## Skipped is not passed
 *
 * A step can be skipped for three genuinely different reasons, and the design
 * has one grey state for all of them. The reason is carried in the detail line
 * instead, because "your project has no such script" and "this change did not
 * need it" are different sentences and a founder is entitled to the difference.
 */

export type ValidationCheckState = "passed" | "failed" | "running" | "pending" | "skipped";

export type ValidationCheck = {
  name: string;
  /** What the check is doing, or why it did not run. */
  detail: string;
  state: ValidationCheckState;
};

const SHIELD = (
  <>
    <path d="M12 3.2 5 6v5.6c0 4 2.9 7.6 7 9.2 4.1-1.6 7-5.2 7-9.2V6l-7-2.8Z" />
    <path d="m9 12.2 2.2 2.2 4-4.4" />
  </>
);

const ROW: Record<ValidationCheckState, string> = {
  passed: "border-mint-line bg-mint-tint/40",
  running: "border-mint-line bg-mint-tint",
  failed: "border-coral-line bg-coral-tint",
  pending: "border-line-2 bg-well",
  skipped: "border-line-2 bg-well",
};

const ICON: Record<ValidationCheckState, string> = {
  passed: "border-mint-line bg-mint-tint text-mint",
  running: "border-mint-line bg-mint-tint text-mint",
  failed: "border-coral-line bg-coral-tint text-coral",
  pending: "border-line-2 bg-surface-2 text-fg-meta",
  skipped: "border-line-2 bg-surface-2 text-fg-disabled",
};

const MARK: Record<ValidationCheckState, { glyph: string; ring: string; sr: string }> = {
  passed: { glyph: "✓", ring: "border-mint text-mint", sr: "passed" },
  running: { glyph: "", ring: "border-mint text-mint", sr: "running" },
  failed: { glyph: "!", ring: "border-coral text-coral", sr: "failed" },
  pending: { glyph: "", ring: "border-line-3 text-fg-meta", sr: "pending" },
  skipped: { glyph: "–", ring: "border-line-2 text-fg-disabled", sr: "skipped" },
};

export function AgentValidationChecks({ checks }: { checks: readonly ValidationCheck[] }) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  return (
    <ul className="flex min-w-0 flex-col gap-3" data-testid="agent-validation-checks">
      {checks.map((check, index) => {
        const mark = MARK[check.state];

        return (
          <motion.li
            key={check.name}
            className={cn(
              "rounded-well flex items-center gap-4 border px-5 py-4",
              ROW[check.state],
            )}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.4,
              ease: [0.2, 0.7, 0.2, 1],
              delay: reduceMotion ? 0 : index * 0.08,
            }}
            data-check={check.name}
            data-state={check.state}
          >
            <span
              className={cn(
                "flex size-[34px] flex-none items-center justify-center rounded-[10px] border",
                ICON[check.state],
              )}
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {SHIELD}
              </svg>
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cn(
                  "text-[0.9375rem] font-semibold",
                  check.state === "pending" || check.state === "skipped"
                    ? "text-fg-muted"
                    : "text-fg",
                )}
              >
                {check.name}
              </span>
              <span className="text-fg-muted text-[0.8125rem]">{check.detail}</span>
            </span>

            <span
              aria-hidden="true"
              className={cn(
                "flex size-[22px] flex-none items-center justify-center rounded-full border-[1.5px] text-[11px]",
                mark.ring,
              )}
              style={
                check.state === "running" && animate
                  ? { borderTopColor: "transparent", animation: "vibe-spin-ring 1s linear infinite" }
                  : undefined
              }
            >
              {mark.glyph}
            </span>

            <span className="sr-only">{mark.sr}</span>
          </motion.li>
        );
      })}
    </ul>
  );
}
