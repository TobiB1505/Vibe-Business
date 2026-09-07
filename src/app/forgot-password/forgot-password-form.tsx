"use client";

import { useActionState } from "react";
import { requestPasswordReset, type PasswordResetRequestResult } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { VibeCard } from "@/components/ui/surface";

/**
 * Requests a password reset link.
 *
 * The success state says "if an account exists" rather than "we sent it",
 * because the screen must not be able to tell anyone which email addresses
 * have accounts here. That wording is not politeness — it is the entire
 * anti-enumeration measure, and it has to survive future copy edits.
 */
export function ForgotPasswordForm({ initialError }: { initialError?: string | null }) {
  const [state, formAction, pending] = useActionState<PasswordResetRequestResult | null, FormData>(
    requestPasswordReset,
    null,
  );

  if (state?.ok) {
    return (
      <Notice tone="info" label="Check your email">
        <p>
          If an account exists for{" "}
          <strong className="text-fg-body font-semibold">{state.email}</strong>, we&apos;ve sent you
          a password reset link.
        </p>
        {/*
          Naming the address leaks nothing — it is the one the person just
          typed, and the sentence above still refuses to say whether it has an
          account. What it does is make a typo visible, which is otherwise
          indistinguishable from an email that has not arrived yet.
        */}
        <p className="text-fg-muted mt-2">
          Nothing arrived? It can take a minute, and it sometimes lands in spam.
        </p>
      </Notice>
    );
  }

  const error = (state && !state.ok ? state.error : null) ?? initialError ?? null;

  return (
    <VibeCard padding="md">
      <form action={formAction} className="flex flex-col gap-4">
        <Field id="email" label="Email address" error={error}>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "email-error" : undefined}
          />
        </Field>

        <Button
          type="submit"
          disabled={pending}
          className="mt-1"
          data-testid="send-reset-link"
          busy={pending}
        >
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </VibeCard>
  );
}
