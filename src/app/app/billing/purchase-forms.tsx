"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import {
  claimWelcomeCreditsAction,
  openBillingPortalAction,
  startCreditPackCheckoutAction,
  startPlanCheckoutAction,
  type BillingActionState,
} from "./actions";

/**
 * The purchase controls (BILLING CORE-2 §52, §93, §95).
 *
 * ## Accessibility is the reason these are forms
 *
 * Every control here is a real `<button type="submit">` inside a `<form>`, not
 * a div with an onClick. That is what gives keyboard activation, the focus
 * ring the design system already defines, and a working control before
 * hydration — none of which a screen this consequential should be without.
 *
 * Errors are text, never colour alone (§93): the `Notice` carries a label and
 * a sentence, so a customer who cannot distinguish the tint still reads what
 * happened.
 *
 * ## What the browser sends
 *
 * A SKU key in a hidden field, and nothing else. There is no price, no amount
 * and no Credit count in any form on this page — the server resolves all of it
 * from the approved catalog (§23).
 */

/** Disables during submission so a double-click cannot open two Checkouts. */
function SubmitButton({
  children,
  variant = "secondary",
  pendingLabel,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "accent";
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={buttonClasses({ variant, size: "sm" })}>
      {pending ? pendingLabel : children}
    </button>
  );
}

function ActionError({ state }: { state: BillingActionState }) {
  if (!state?.error) return null;

  return (
    <Notice tone="problem" label="Couldn't continue">
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
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="pack" value={packKey} />
      <div className="flex flex-col gap-1">
        <span className="text-fg text-title font-bold">{credits} Credits</span>
        <span className="text-fg-meta text-sm">{price}</span>
      </div>
      {disabled ? (
        <button type="button" disabled className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Unavailable
        </button>
      ) : (
        <SubmitButton pendingLabel="Opening checkout…">Buy Credits</SubmitButton>
      )}
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
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="plan" value={planKey} />
      <div className="flex flex-col gap-1">
        <span className="text-fg text-title font-bold">{planName}</span>
        <span className="text-fg-meta text-sm">{price}</span>
        <span className="text-fg-prose text-sm">{credits} Credits each month</span>
      </div>
      {current ? (
        // Stated as text rather than only as a disabled control, so the reason
        // the button is unavailable is readable (§93).
        <p className="text-mint text-sm font-semibold">Your current plan</p>
      ) : disabled ? (
        <button type="button" disabled className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Unavailable
        </button>
      ) : (
        <SubmitButton variant="accent" pendingLabel="Opening checkout…">
          Choose {planName}
        </SubmitButton>
      )}
      <ActionError state={state} />
    </form>
  );
}

export function ManageBillingForm() {
  const [state, action] = useActionState(openBillingPortalAction, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <SubmitButton pendingLabel="Opening…">Manage payment and invoices</SubmitButton>
      <ActionError state={state} />
    </form>
  );
}

/**
 * The one-time Welcome claim for accounts that predate Billing Core-2 (§6).
 *
 * New accounts never see this — their Credits arrive when they connect their
 * first repository. It is a POST because a page render must not move financial
 * state, and it is idempotent underneath regardless of how many times it is
 * pressed.
 */
export function ClaimWelcomeCreditsForm() {
  const [state, action] = useActionState(claimWelcomeCreditsAction, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <SubmitButton variant="primary" pendingLabel="Adding Credits…">
        Add my 100 Welcome Credits
      </SubmitButton>
      <ActionError state={state} />
    </form>
  );
}
