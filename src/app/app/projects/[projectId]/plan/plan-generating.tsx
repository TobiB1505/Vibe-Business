"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  BusinessHealthIcon,
  ChevronRightIcon,
  DocumentIcon,
  LockIcon,
  SparklesIcon,
  TargetIcon,
} from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import { operationProgressSteps, type OperationView } from "@/modules/operations/view";
import { PlanProgressSteps } from "./plan-progress-steps";

function useDocumentVisible() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

function PlanningCore({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const motionEnabled = active && visible && !reduceMotion;

  return (
    <div className="relative flex size-52 items-center justify-center" aria-hidden>
      <motion.span
        className="absolute inset-7 rounded-full bg-mint-tint blur-2xl"
        animate={
          motionEnabled
            ? { opacity: [0.28, 0.72, 0.28], scale: [0.9, 1.08, 0.9] }
            : { opacity: 0.36, scale: 1 }
        }
        transition={
          motionEnabled
            ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0 }
        }
      />
      <motion.svg
        viewBox="0 0 208 208"
        className="absolute inset-0 size-full"
        animate={motionEnabled ? { rotate: 360 } : { rotate: 0 }}
        transition={motionEnabled ? { duration: 24, repeat: Infinity, ease: "linear" } : { duration: 0 }}
      >
        <circle
          cx="104"
          cy="104"
          r="87"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="1 11"
          className="text-mint opacity-45"
        />
        <circle
          cx="104"
          cy="104"
          r="70"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="2 8"
          className="text-mint opacity-25"
        />
      </motion.svg>
      <motion.span
        className="border-mint-line bg-surface-3 text-mint relative flex size-24 items-center justify-center rounded-panel border shadow-card"
        animate={motionEnabled ? { y: [0, -3, 0] } : { y: 0 }}
        transition={
          motionEnabled
            ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0 }
        }
      >
        <DocumentIcon size={42} />
        <motion.span
          className="bg-app border-mint-line absolute -right-2 -bottom-2 flex size-9 items-center justify-center rounded-full border"
          animate={
            motionEnabled
              ? { scale: [1, 1.12, 1], rotate: [0, 8, 0] }
              : { scale: 1, rotate: 0 }
          }
          transition={
            motionEnabled
              ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0 }
          }
        >
          <SparklesIcon size={18} />
        </motion.span>
      </motion.span>
    </div>
  );
}

/**
 * The Action Plan before it has any Moves (ACTION PLAN UI-2).
 *
 * Two situations share one composition, because to a founder they are one
 * situation — there is nothing here yet — and the difference between them is a
 * sentence, not a layout: either a run is working, or nothing has started.
 *
 * The geometry is reserved either way. The list column and the side column
 * exist before the first Move does, so the page does not rearrange itself
 * around the founder when the run lands.
 *
 * What it must not do, and what the reference design does: claim a duration.
 * "This usually takes 1–2 minutes" is a promise about a paid inference call
 * whose length nothing here measures, so the honest line is the one the rest of
 * the product already uses — the work is durable, and leaving does not cancel
 * it.
 */
export function PlanGenerating({
  running,
  children,
}: {
  running: boolean;
  /** The start control, when starting is currently offered. */
  children?: React.ReactNode;
}) {
  return (
    <>
      <Surface
        level="panel"
        padding="none"
        className="action-plan-generation-stage flex flex-col items-center justify-center overflow-hidden px-6 py-12 text-center sm:px-10"
        data-testid="plan-generating"
      >
        <PlanningCore active={running} />
        <div className="relative z-10 mt-4 flex max-w-xl flex-col gap-3">
          <h2 className="text-fg text-headline font-bold">
            {running ? "Generating your Action Plan" : "No moves yet"}
          </h2>
          <p className="text-fg-prose text-lead leading-relaxed">
            {running
              ? "Vibe is analyzing your product, business health, and current context to build a prioritized set of high-impact moves."
              : "Vibe can work out the highest-impact things to do next from your business audit."}
          </p>
        </div>
        <div className="relative z-10 mt-7">{children}</div>

        {running && (
          <div className="relative z-10 mt-10 grid w-full max-w-2xl gap-4 text-left sm:grid-cols-3">
            {[
              {
                icon: BusinessHealthIcon,
                label: "Reading your business health",
              },
              {
                icon: TargetIcon,
                label: "Finding high-impact opportunities",
              },
              {
                icon: SparklesIcon,
                label: "Ordering work by impact and dependencies",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="text-fg-secondary flex items-center gap-3 text-xs leading-relaxed"
                >
                  <span className="border-mint-line bg-mint-tint-soft text-mint flex size-9 shrink-0 items-center justify-center rounded-full border">
                    <Icon size={17} />
                  </span>
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {running && (
          <p className="text-fg-meta relative z-10 mt-8 text-xs">
            You can leave this page. Vibe will continue.
          </p>
        )}
      </Surface>

      <div className="border-line-2 bg-surface-1 rounded-panel flex flex-wrap items-center gap-3 border px-4 py-3">
        <LockIcon size={15} className="text-fg-meta shrink-0" />
        <p className="text-fg-muted text-xs leading-relaxed">
          Your data is private. Vibe uses it only to work out what to recommend for this product.
        </p>
      </div>
    </>
  );
}

/**
 * The side column while there is nothing to select.
 *
 * "What's happening" names the run's real stages (`operationProgressSteps`);
 * "While you wait" links only to places that already exist in this workspace.
 */
export function PlanGeneratingAside({
  running,
  operation,
  waitLinks,
  healthHref,
}: {
  running: boolean;
  operation: OperationView | null;
  waitLinks: { href: string; title: string; detail: string }[];
  healthHref: string;
}) {
  return (
    <>
      {running && (
        <Surface level="panel" padding="lg" className="flex flex-col gap-4">
          <h2 className="text-fg text-title font-bold">What&apos;s happening</h2>
          <PlanProgressSteps
            steps={operationProgressSteps("opportunity_generation", operation)}
            variant="timeline"
          />
        </Surface>
      )}

      <Surface level="panel" padding="lg" className="flex flex-col gap-4">
        <h2 className="text-fg text-title font-bold">
          {running ? "While you wait" : "Where your moves come from"}
        </h2>
        <ul className="flex flex-col gap-1">
          {waitLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  "hover:bg-surface-hover rounded-nav -mx-2 flex items-start gap-3 px-2 py-2.5",
                  "transition-interactive",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-fg-body text-sm font-medium">{link.title}</span>
                  <span className="text-fg-muted text-xs leading-relaxed">{link.detail}</span>
                </div>
                <ChevronRightIcon size={16} className="text-fg-meta mt-0.5 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={healthHref}
          className="text-mint hover:text-mint-hover inline-flex items-center gap-2 self-start rounded-sm text-sm font-medium transition-interactive"
        >
          Go to Business Health
          <ArrowRightIcon size={15} />
        </Link>
      </Surface>
    </>
  );
}
