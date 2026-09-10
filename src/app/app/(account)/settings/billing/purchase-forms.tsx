"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import {
  claimWelcomeCreditsAction,
  openBillingPortalAction,
  startCreditPackCheckoutAction,
  startPlanCheckoutAction,
  type BillingActionState,
} from "./actions";

function SubmitButton({
  children,
  variant = "secondary",
  pendingLabel,
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  pendingLabel: string;
  className?: string;
  /**
   * What this particular button says when it is the one pressed.
   *
   * A form's submitter contributes its own name and value, which is how two
   * buttons in one form can mean two different things without any client
   * state. The absent case is the safe one: `parseBillingInterval` reads a
   * missing field as monthly.
   */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending || undefined}
      className={`${buttonClasses({ variant })} ${className ?? ""}`}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent motion-safe:animate-spin"
        />
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}

function ActionError({ state }: { state: BillingActionState }) {
  if (!state?.error) return null;

  return (
    <Notice tone="problem" label="Couldn't continue" className="mt-3">
      {state.error}
    </Notice>
  );
}

export function BuyCreditPackForm({
  packKey,
  credits,
  price,
  disabled,
}: {
  packKey: string;
  credits: string;
  price: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(startCreditPackCheckoutAction, null);

  return (
    <form action={action} noValidate className="px-5 py-4 sm:px-6">
      <input type="hidden" name="pack" value={packKey} />
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-fg font-semibold tabular-nums">{credits} Credits</p>
          {/*
            The price moved into the button (UI-29, treatment B). It was here
            *and* two hundred pixels to the right; a price printed twice is a
            price somebody reads once and presses the other one.
          */}
          <p className="text-fg-muted mt-1 text-body">one time</p>
        </div>
        {disabled ? (
          <button type="button" disabled className={buttonClasses({ variant: "secondary" })}>
            Unavailable
          </button>
        ) : (
          <SubmitButton variant="secondary" pendingLabel="Opening…">
            Buy · <span className="tabular-nums">{price}</span>
          </SubmitButton>
        )}
      </div>
      <ActionError state={state} />
    </form>
  );
}

export function StartPlanForm({
  planKey,
  planName,
  price,
  credits,
  buys,
  annual,
  disabled,
  current,
}: {
  planKey: string;
  planName: string;
  price: string;
  credits: string;
  /**
   * What the monthly grant is worth in units of work, already rounded down.
   *
   * Inside the row rather than in a list underneath it: a customer choosing a
   * plan is choosing how much work they can do, and "1,000 Credits" is a
   * number nobody can price without the table above and a calculator. It sat
   * in a detached `dl` below every plan, which made the reader match names to
   * rows to answer the one question a plan is chosen on.
   *
   * Null when nothing in the card is priced, so a policy with no prices
   * renders no claim rather than "0 audits".
   */
  buys?: string | null;
  /**
   * The same plan by the year, already formatted, or null where there is no
   * annual Price configured for it.
   *
   * A second button rather than a toggle: two buttons in one form need no
   * client state, and the submitter's own value is what says which was
   * pressed. It is also the honest shape for this surface — a chooser where
   * the reader can see both commitments at once rather than one that hides
   * half of the offer behind a switch.
   */
  annual?: { price: string; saving: string } | null;
  disabled: boolean;
  current: boolean;
}) {
  const [state, action] = useActionState(startPlanCheckoutAction, null);

  return (
    <form action={action} noValidate className="px-5 py-4 sm:px-6">
      <input type="hidden" name="plan" value={planKey} />
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-fg font-semibold">{planName}</p>
          <p className="text-fg-muted mt-1 text-body">{price}</p>
          <p className="text-fg-prose mt-1 text-caption tabular-nums">
            {credits} Credits each month
          </p>
          {buys && <p className="text-fg-secondary mt-2 text-body">{buys} each month</p>}
        </div>
        {current ? (
          <StatusPill tone="active" className="shrink-0">
            Current<span className="sr-only"> plan</span>
          </StatusPill>
        ) : disabled ? (
          <button type="button" disabled className={buttonClasses({ variant: "secondary" })}>
            Unavailable
          </button>
        ) : (
          // `whitespace-nowrap`: "Choose Builder" wrapped to two lines in the
          // narrow plans column, giving each plan a two-line button beside a
          // one-line price.
          <div className="flex shrink-0 flex-col items-end gap-2">
            <SubmitButton
              variant="secondary"
              pendingLabel="Opening…"
              className="whitespace-nowrap"
              name="interval"
              value="monthly"
            >
              Choose {planName}
            </SubmitButton>
            {annual && (
              <SubmitButton
                variant="secondary"
                pendingLabel="Opening…"
                className="text-fg-muted hover:text-fg-body border-none bg-transparent px-0 whitespace-nowrap shadow-none"
                name="interval"
                value="annual"
              >
                or {annual.price} a year
              </SubmitButton>
            )}
          </div>
        )}
      </div>
      {annual && !current && !disabled && (
        <p className="text-fg-muted mt-2 text-caption">{annual.saving}</p>
      )}
      <ActionError state={state} />
    </form>
  );
}

export function ManageBillingForm() {
  const [state, action] = useActionState(openBillingPortalAction, null);

  return (
    <form action={action} noValidate className="flex flex-col gap-3">
      <SubmitButton pendingLabel="Opening…" className="w-full justify-center">
        Manage or cancel plan
      </SubmitButton>
      <ActionError state={state} />
    </form>
  );
}

export function ClaimWelcomeCreditsForm() {
  const [state, action] = useActionState(claimWelcomeCreditsAction, null);

  return (
    <form action={action} noValidate className="flex flex-col gap-3">
      <SubmitButton variant="primary" pendingLabel="Adding Credits…">
        Add my 100 Welcome Credits
      </SubmitButton>
      <ActionError state={state} />
    </form>
  );
}
