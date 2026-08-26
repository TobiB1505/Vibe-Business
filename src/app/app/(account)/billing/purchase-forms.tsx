"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ui/button";
import { ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { Notice } from "@/components/ui/states";
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
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "accent";
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`${buttonClasses({ variant, size: "sm" })} ${className ?? ""}`}
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
          <p className="text-fg-muted mt-1 text-sm">
            <span>{price}</span> one time
          </p>
        </div>
        {disabled ? (
          <button type="button" disabled className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Unavailable
          </button>
        ) : (
          <SubmitButton variant="accent" pendingLabel="Opening…">
            Buy
            <ArrowRightIcon size={14} />
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
  disabled,
  current,
}: {
  planKey: string;
  planName: string;
  price: string;
  credits: string;
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
          <p className="text-fg-muted mt-1 text-sm">{price}</p>
          <p className="text-fg-prose mt-1 text-xs tabular-nums">{credits} Credits each month</p>
        </div>
        {current ? (
          <span className="bg-mint-tint text-mint border-mint-line shrink-0 rounded-full border px-3 py-1 text-xs font-semibold">
            Current<span className="sr-only"> plan</span>
          </span>
        ) : disabled ? (
          <button type="button" disabled className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Unavailable
          </button>
        ) : (
          <SubmitButton variant="accent" pendingLabel="Opening…">
            Choose {planName}
          </SubmitButton>
        )}
      </div>
      <ActionError state={state} />
    </form>
  );
}

export function ManageBillingForm() {
  const [state, action] = useActionState(openBillingPortalAction, null);

  return (
    <form action={action} noValidate className="flex flex-col gap-3">
      <SubmitButton pendingLabel="Opening…" className="w-full justify-between">
        Manage or cancel plan
        <ArrowRightIcon size={15} />
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
