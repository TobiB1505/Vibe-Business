"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import {
  beginUnderstandingAction,
  completeOnboardingAction,
  parkLiveProductAction,
  type BeginUnderstandingState,
} from "./actions";

/**
 * The audit's live-product prerequisite, in both of its honest shapes
 * (UI-S1 §9, §10, §12).
 *
 * ## The defect this replaces
 *
 * One shape: a form demanding a public https:// address, with no other control
 * on the screen. A founder who had already told Vibe "I don't have a live site
 * yet" arrived here anyway and found their own answer unavailable — the flow
 * had quietly stopped believing them, and there was no way forward, back, or
 * out.
 *
 * ## Two shapes, because there are two situations
 *
 * `awaiting` — the founder said they have a live product and Vibe has not read
 * it. Asking for the address is the right thing to do, and "I don't have one
 * yet" is offered beside it so the answer stays theirs to change.
 *
 * `parked` — the founder has said there is no live product. The audit is set
 * aside, which is said plainly and without alarm, and the way on to the
 * workspace is the primary control. The address form is still here, one
 * disclosure away, for the founder who deployed something this morning.
 *
 * ## What neither shape does
 *
 * Invent a URL, substitute localhost, run an audit against evidence that does
 * not exist, or record a parked audit as one that ran (§10, §26). Parking
 * writes one canonical fact — "no live site yet" — and nothing about the audit
 * at all.
 */

/**
 * A submit button that reports its own form's pending state.
 *
 * Plain forms rather than `useTransition` on purpose: both of these are
 * navigations away from this screen, and a form works before hydration.
 */
function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function AuditLivePrerequisite({
  projectId,
  mode,
}: {
  projectId: string;
  mode: "awaiting" | "parked";
}) {
  const router = useRouter();
  const begin = beginUnderstandingAction.bind(null, projectId);
  const [state, action, pending] = useActionState<BeginUnderstandingState, FormData>(begin, null);
  const [addressOpen, setAddressOpen] = useState(false);

  const error = state && !state.ok ? state : null;

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [router, state]);

  const addressForm = (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="liveSiteChoice" value="provided" />
      <Field
        id="auditProductionUrl"
        label="Live product address"
        hint="The public https:// address. Vibe never needs a login."
        error={error?.step === "url" ? "Check that this is a public https:// address." : undefined}
      >
        <Input
          id="auditProductionUrl"
          name="productionUrl"
          type="url"
          placeholder="https://your-product.com"
          required
        />
      </Field>
      {error?.step === "live" && (
        <p className="text-amber text-sm">
          Vibe could not reach that address. Check it and try again, or carry on without it.
        </p>
      )}
      <div>
        <Button
          type="submit"
          variant={mode === "parked" ? "secondary" : "primary"}
          disabled={pending}
          busy={pending}
        >
          {pending ? "Checking your live product…" : "Check my live product"}
        </Button>
      </div>
    </form>
  );

  if (mode === "parked") {
    return (
      <Surface level="card" padding="lg" className="flex max-w-[46rem] flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 className="text-fg text-title font-semibold">
            No live product yet? That&apos;s fine.
          </h2>
          <p className="text-fg-prose text-sm leading-relaxed">
            Vibe already understands what you built from your project. The business audit also
            compares that with what a customer can actually reach, so it stays set aside until your
            product is live — it has not run, and nothing has been scored against you for it.
          </p>
          <p className="text-fg-muted text-sm leading-relaxed">
            You can go to your workspace now. When you launch, add the address there and the audit
            becomes available.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form action={completeOnboardingAction.bind(null, projectId)}>
            <SubmitButton pendingLabel="Opening your workspace…">
              Continue to your workspace
            </SubmitButton>
          </form>
          <Button
            type="button"
            variant="secondary"
            aria-expanded={addressOpen}
            aria-controls="audit-live-address"
            onClick={() => setAddressOpen((open) => !open)}
          >
            My product is live now
          </Button>
        </div>

        {addressOpen && (
          <div id="audit-live-address" className="border-line-2 border-t pt-5">
            {addressForm}
          </div>
        )}
      </Surface>
    );
  }

  return (
    <Notice tone="waiting" label="The business audit still needs one thing">
      <div className="flex flex-col gap-4">
        <p>
          Vibe understands your product from its code. The audit also looks at what customers can
          reach, so it needs the address your product is live at.
        </p>
        {addressForm}
        <div className="border-line-2 border-t pt-4">
          <p className="text-fg-muted mb-3 text-sm">Not live yet?</p>
          <form action={parkLiveProductAction.bind(null, projectId)}>
            <SubmitButton variant="secondary" pendingLabel="Saving…">
              I don&apos;t have a live product yet
            </SubmitButton>
          </form>
        </div>
      </div>
    </Notice>
  );
}
