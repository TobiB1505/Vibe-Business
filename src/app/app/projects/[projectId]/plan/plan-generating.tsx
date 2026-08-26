"use client";

import Link from "next/link";
import { ArrowRightIcon, ChevronRightIcon, LockIcon, SparklesIcon } from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import { operationProgressSteps, type OperationView } from "@/modules/operations/view";
import { PlanProgressSteps } from "./plan-progress-steps";

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
        padding="lg"
        className="flex flex-col items-center gap-5 py-12 text-center"
        data-testid="plan-generating"
      >
        <span
          aria-hidden
          className="border-mint-line bg-mint-tint-soft text-mint flex size-20 items-center justify-center rounded-full border border-dashed"
        >
          <SparklesIcon size={30} />
        </span>
        <div className="flex max-w-[46ch] flex-col gap-2">
          <h2 className="text-fg text-title font-bold">
            {running ? "Generating your Action Plan" : "No moves yet"}
          </h2>
          <p className="text-fg-muted text-sm leading-relaxed">
            {running
              ? "Vibe is reading your business health and working out the few highest-impact things to do next."
              : "Vibe can work out the highest-impact things to do next from your business audit."}
          </p>
        </div>
        {children}
        {running && (
          <p className="text-fg-meta text-xs">You can leave this page. Vibe will continue.</p>
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
          <PlanProgressSteps steps={operationProgressSteps("opportunity_generation", operation)} />
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
