"use client";

import { motion, useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { MonoLabel } from "@/components/ui/typography";
import type { ExecutionInterrupt } from "@/modules/execution-contract/schema";

/**
 * Vibe has a question (UI-19, artboard 2f).
 *
 * ## Why the whole surface turns amber
 *
 * Because the state is genuinely different, and the design is right to say so
 * loudly. The run has not failed and it is not working: it reached something
 * only the founder can decide and stopped rather than guessing. Mint would
 * claim activity, coral would claim damage, and both would be wrong.
 *
 * This is the one moment on the surface where the founder is the blocker, so
 * the question becomes the only primary object on the screen.
 *
 * ## The sentence is Vibe's, never a model's
 *
 * `question` is Vibe-authored and customer-safe by contract, and
 * `responseSchema` decides what an answer may be. Nothing here composes either;
 * the panel renders what the interrupt already holds.
 */

export function AgentQuestionPanel({
  interrupt,
  waitingSince,
  children,
}: {
  interrupt: ExecutionInterrupt;
  /** Rendered beside the label when the caller can say how long. */
  waitingSince?: string;
  /** The answer control, owned by the route that can submit it. */
  children?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  return (
    <motion.section
      className="rounded-card border-amber-line bg-amber-tint-soft shadow-card relative overflow-hidden border p-8"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
      data-testid="agent-question"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-28 h-[460px] w-[560px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-amber) 11%, transparent), transparent 68%)",
          ...(animate
            ? { animation: "vibe-glow-drift 24s var(--ease-vibe) infinite" }
            : {}),
        }}
      />

      <div className="relative grid items-start gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <MonoLabel as="h2" className="text-amber flex items-center gap-3">
            Vibe has a question
            <span
              aria-hidden="true"
              className="bg-amber shadow-dot-amber size-[7px] rounded-full"
              style={
                animate
                  ? {
                      animation:
                        "vibe-soft-pulse var(--duration-pulse) var(--ease-vibe) infinite",
                    }
                  : undefined
              }
            />
            {waitingSince !== undefined && (
              <span className="text-fg-meta font-normal normal-case">· {waitingSince}</span>
            )}
          </MonoLabel>

          <h3 className="text-fg max-w-[34ch] text-[1.625rem] leading-tight font-bold tracking-[-0.03em] text-pretty">
            {interrupt.question}
          </h3>

          {/*
            No explanatory paragraph is invented here. The interrupt carries a
            question and a schema; anything about *why* Vibe stopped is the
            `whyBlocked` type, and the route renders it in the founder's own
            vocabulary rather than this component inventing prose.
          */}
        </div>

        <div className="min-w-0">{children}</div>
      </div>
    </motion.section>
  );
}
