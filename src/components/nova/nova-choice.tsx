"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmPanel } from "@/components/ui/confirm-panel";
import { CreditPrice } from "@/components/ui/credit-price";
import { Surface } from "@/components/ui/surface";
import type { NovaChoiceOption, NovaEntry } from "@/modules/nova/feed";

/**
 * The one thing Nova offers to do next.
 *
 * ## What this component decides, which is nothing
 *
 * The label, the price, the consequence and whether a person confirms all
 * arrive on the option, from the catalog. This chooses a button or a link
 * according to `control`, discloses the price beside the control rather than
 * inside its words (rule 60), and asks again before the two controls that
 * write to a customer's repository.
 *
 * ## Why it does not call the action itself
 *
 * Because the action's arguments belong to the domain that owns it, and the
 * signatures genuinely differ — two positional identifiers here, a `FormData`
 * there, a required `confirmed` on the merge. A component that tried to call
 * all of them would need a lowest common denominator, and the product already
 * has the right answer for that: the domain panel owns its own action, and
 * this hands off to it rather than growing a second set of lookalike buttons
 * beside the real ones.
 */
export function NovaChoice({
  entry,
  onSelect,
  hrefFor,
  pending = false,
}: {
  entry: Extract<NovaEntry, { kind: "nova.choice" }>;
  /** Runs a `server_action` option. The caller binds the arguments. */
  onSelect: (option: NovaChoiceOption) => void;
  /** Where a `navigation` option goes. */
  hrefFor: (option: NovaChoiceOption) => string;
  pending?: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <Surface
      level="panel"
      tone="mint"
      padding="lg"
      className="flex flex-col gap-4"
      data-testid="nova-choice"
    >
      {entry.prompt ? <p className="text-fg text-ui-lg font-medium">{entry.prompt}</p> : null}

      {entry.options.map((option) => {
        if (confirming === option.actionId) {
          return (
            <ConfirmPanel
              key={option.actionId}
              title={option.label}
              confirmLabel={option.label}
              pending={pending}
              onConfirm={() => {
                setConfirming(null);
                onSelect(option);
              }}
              onCancel={() => setConfirming(null)}
            >
              {/*
               * From the catalog, because the two confirmed controls agree
               * about nothing: one moves a branch and one spends Credits to
               * write a different branch. A sentence written here would have
               * been correct for whichever was implemented first and quietly
               * wrong for the other.
               */}
              <p className="text-fg-meta text-ui">{option.confirmationNote}</p>
            </ConfirmPanel>
          );
        }

        return (
          <div key={option.actionId} className="flex flex-wrap items-center gap-3">
            {option.control === "navigation" ? (
              <Link
                href={hrefFor(option)}
                className={buttonClasses({ variant: "secondary" })}
                data-testid={`nova-option-${option.actionId}`}
              >
                {option.label}
              </Link>
            ) : (
              <Button
                type="button"
                busy={pending}
                data-testid={`nova-option-${option.actionId}`}
                onClick={() =>
                  option.requiresConfirmation ? setConfirming(option.actionId) : onSelect(option)
                }
              >
                {option.label}
              </Button>
            )}

            {/*
             * Beside the control, never inside its label: the price is
             * effective-dated and `CreditPrice` renders today's, while a free
             * operation renders nothing at all rather than a zero.
             */}
            {option.price !== null ? <CreditPrice operation={option.price} /> : null}
          </div>
        );
      })}
    </Surface>
  );
}
