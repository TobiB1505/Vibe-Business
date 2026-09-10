import type { ReactNode } from "react";
import { AlertIcon } from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";

/**
 * Where the consequential controls live, and nowhere else (UI-24).
 *
 * ## Why a marked region rather than "last and alone"
 *
 * Sprint 0158 put deleting a product at the foot of its page in a plain panel,
 * on the argument that everything above it is a fact, a destination or a
 * reversible action — so position alone said which one was different. That
 * works exactly once. The moment a second consequential control exists, the
 * page needs somewhere for it that is not "also at the bottom", and the reader
 * needs to know a thing is destructive before they reach the end of the page.
 *
 * So the region is marked. This is the pattern every reference implementation
 * converges on and the founder asked for by name, and its value is that a
 * person can recognise it without reading it.
 *
 * ## What this refuses to copy
 *
 * The reference danger zones — GitHub's included — put "change visibility",
 * "transfer" and "delete for ever" in one box with one border and one colour,
 * which flattens three very different consequences into one warning. Vibe's
 * own General page states the rule those break: *a row that looks the same
 * beside an irreversible one is a trap.*
 *
 * So every row states its own consequence in its own words, and a row that can
 * be undone says so, in the row, beside the control. The region says *these
 * are the sharp ones*; the row says *and this is what this one does*.
 */
export function DangerZone({
  description,
  children,
  className,
  ...rest
}: {
  /** One sentence about the region, not about any single row. */
  description?: string;
  children: ReactNode;
  className?: string;
} & { "data-testid"?: string }) {
  return (
    <Surface
      as="section"
      aria-labelledby="danger-zone-heading"
      level="section"
      tone="coral"
      padding="lg"
      className={cn("flex flex-col gap-5", className)}
      {...rest}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-coral mt-0.5 shrink-0">
          <AlertIcon size={18} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 id="danger-zone-heading" className="text-fg text-title font-semibold">
            Danger zone
          </h2>
          {description && (
            <p className="text-fg-prose max-w-[65ch] text-body">{description}</p>
          )}
        </div>
      </div>

      <ul className="divide-coral-line/40 flex flex-col divide-y">{children}</ul>
    </Surface>
  );
}

/**
 * One row of the zone.
 *
 * `reversible` is required rather than optional on purpose: it is the fact
 * that stops the region flattening its contents, and a default would let a row
 * be added without anybody deciding which kind it is.
 */
export function DangerRow({
  title,
  consequence,
  reversible,
  action,
}: {
  title: string;
  /** What happens, in the founder's terms. Never "this action cannot be undone" alone. */
  consequence: string;
  /** Whether the thing can be had back afterwards. */
  reversible: boolean;
  action: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-fg text-ui font-semibold">{title}</h3>
            {/*
              The one word that decides how alarmed to be, beside the title
              rather than at the end of the sentence — a reader who scans this
              region reads the titles, not the paragraphs.
            */}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-label font-semibold tracking-[0.06em] uppercase",
                reversible
                  ? "border-line-4 bg-surface-hover text-fg-muted"
                  : "border-coral-line bg-coral-tint-soft text-coral",
              )}
            >
              {reversible ? "Reversible" : "Permanent"}
            </span>
          </div>
          <p className="text-fg-muted max-w-[62ch] text-caption leading-relaxed">{consequence}</p>
        </div>
      </div>
      {action}
    </li>
  );
}
