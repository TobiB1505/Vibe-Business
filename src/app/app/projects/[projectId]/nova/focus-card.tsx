import type { ReactNode } from "react";
import { ActionBlock } from "@/components/system/action-block";
import type { CostBalance } from "@/components/system/cost-disclosure";
import { statusForFocusTier } from "@/components/system/status-vocabulary";
import { StatusPill } from "@/components/ui/status-pill";
import { VibeCard } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import type { NovaHomeEntry } from "@/modules/nova/home-view";

/**
 * The one thing Vibe leads with (UI Sourcing Spec C1; audit E1).
 *
 * ## Why this is the page's only raised surface
 *
 * Surface level 3 is "one primary object per view", and on Home this is it.
 * Everything else — the working strip, the stack, the health reading — is a
 * level-2 panel or quieter, so the hierarchy states which thing the screen is
 * about instead of leaving a founder to work it out from four equal boxes.
 * That was the exact failure the audit found: six equal doors on arrival.
 *
 * ## What it contains, in reading order
 *
 * The tier as a word, Nova's sentence about what needs attention, the
 * subject's own sentence when it has one, an optional body the page supplies
 * for context, then one control with its price beside it.
 *
 * ## What it must never do
 *
 * **Carry a second primary.** There is one `ActionBlock`, and the attention
 * stack below deliberately has no controls at all.
 *
 * **Manufacture work.** `nothing_to_do` renders no button. A founder with
 * nothing to do is told so, and Nova does not invent something to fill the
 * slot — which is why `novaCandidateAction` returns null for it rather than a
 * plausible-looking suggestion.
 *
 * **Restate a price in prose.** The number lives in one place, rendered by
 * `CostDisclosure` from the same resolver the reservation calls.
 */
export function FocusCard({
  entry,
  control,
  operation,
  balance,
  consequence,
  children,
  className,
}: {
  entry: NovaHomeEntry;
  /** The bound control, or nothing when the candidate carries none. */
  control?: ReactNode;
  /** The retail kind the control charges under. Null when it is free. */
  operation?: Parameters<typeof ActionBlock>[0]["operation"];
  balance?: CostBalance | null;
  consequence?: ReactNode;
  /** Context the page supplies: the audit's top blocker, a change summary. */
  children?: ReactNode;
  className?: string;
}) {
  const status = statusForFocusTier(entry.tier);
  const settled = entry.kind === "nothing_to_do";

  return (
    <VibeCard
      as="section"
      aria-labelledby="nova-focus"
      padding="lg"
      /*
       * The mint tint is Vibe's own action framing and is reserved for the
       * card that carries one. A settled Home is neutral: tinting "nothing
       * needs you" would dress an absence of work as an offer.
       */
      tone={settled ? "neutral" : "mint"}
      className={cn("flex flex-col gap-5", className)}
    >
      <div className="flex flex-col gap-3">
        <StatusPill tone={status.tone} className="self-start">
          {status.word}
        </StatusPill>

        <h1
          id="nova-focus"
          className="text-fg max-w-[24ch] text-headline leading-[1.14] font-bold tracking-[-0.035em] text-balance sm:max-w-[28ch]"
        >
          {entry.message}
        </h1>

        {entry.detail && <p className="text-fg-prose max-w-[62ch] text-lead">{entry.detail}</p>}
      </div>

      {children}

      {control && (
        <ActionBlock
          control={control}
          operation={operation ?? null}
          balance={balance}
          consequence={consequence}
          footnote={entry.prompt}
        />
      )}
    </VibeCard>
  );
}
