import type { ReactNode } from "react";
import { creditPriceLabel } from "./credit-price";
import { MonoLabel } from "./typography";
import { Surface } from "./surface";
import type { RetailOperationKind } from "@/modules/credits/retail";
import { cn } from "@/lib/utils/cn";

/**
 * What an action costs, what you have, and what it will do — before you click
 * it (UI-8 §4).
 *
 * `CreditPrice` already puts the number beside the button, which is the rule
 * that matters. What it cannot do is the other half of the sentence: a price
 * with no balance beside it is a number you have to go and check somewhere
 * else, and the project workspace has never shown a balance at all — it lives
 * in `AppShell`, which the project routes do not use.
 *
 * ## Three states, and the difference between the last two is the point
 *
 * **Priced.** The number comes from `creditPriceLabel`, which reads the same
 * policy the reservation will charge against. There is no second copy here to
 * drift out of step with the one actually charged.
 *
 * **Free.** Renders no price line at all, exactly as `CreditPrice` does and for
 * the reason recorded there: a zero beside a button invites the question of
 * when it might stop being zero, and free operations are not part of the Credit
 * conversation.
 *
 * **Unpriced.** Says so, in words. This is *not* free and must never read as
 * free: Deep Scan and agentic execution are deliberately absent from
 * `RETAIL_OPERATION_KINDS` because neither has an approved price, and both are
 * blocked on cost inputs that do not exist yet. They are literally not
 * expressible as a `RetailOperationKind`, which is why `"unpriced"` is a
 * separate value here rather than a null price.
 *
 * Collapsing unpriced into free would be the worst kind of UI bug — one that
 * makes a promise the billing system never made, on the screen where a founder
 * decides whether to spend money.
 */

/** A priced operation, or an action the price policy deliberately does not cover. */
export type CostSubject = RetailOperationKind | "unpriced";

export const UNPRICED_MESSAGE = "No price is currently assigned to this action.";

/**
 * The cost line for a subject, or null when there is nothing to say.
 *
 * Pure and exported so the distinction that matters — unpriced is not free, and
 * neither is zero — is a unit test rather than something only a rendered page
 * would reveal.
 */
export function costLabel(subject: CostSubject): string | null {
  if (subject === "unpriced") return UNPRICED_MESSAGE;

  // Free operations return null here, and that is the whole free case.
  return creditPriceLabel(subject);
}

export function CostDisclosure({
  subject,
  balanceDisplay,
  children,
  className,
}: {
  subject: CostSubject;
  /**
   * The founder's Credit balance, already formatted. Null when it could not be
   * read — the balance line is then absent rather than showing a zero, which
   * would claim "you have none" when the truth is "we could not tell".
   */
  balanceDisplay?: string | null;
  /** The consequence sentence and the control that spends the Credits. */
  children: ReactNode;
  className?: string;
}) {
  const label = costLabel(subject);
  const unpriced = subject === "unpriced";

  return (
    <Surface
      level="panel"
      padding="lg"
      className={cn("flex flex-wrap items-start justify-between gap-5", className)}
    >
      <div className="flex min-w-55 flex-1 flex-col gap-3">{children}</div>

      {label && (
        <div className="flex shrink-0 flex-col gap-1">
          <MonoLabel>{unpriced ? "Price" : "Cost"}</MonoLabel>
          <span
            className={cn(
              unpriced ? "text-fg-secondary max-w-45 text-caption" : "text-fg text-lead font-semibold tabular-nums",
            )}
          >
            {label}
          </span>
          {/*
           * The balance belongs beside the price or nowhere. On its own it is
           * trivia; next to what the click costs it is the only thing a founder
           * needs in order to decide. Hidden for an unpriced action, where
           * there is no arithmetic to do.
           */}
          {!unpriced && balanceDisplay && (
            <span className="text-fg-meta font-mono text-meta">
              {balanceDisplay} Credits available
            </span>
          )}
        </div>
      )}
    </Surface>
  );
}
