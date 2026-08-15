"use client";

import { useActionState } from "react";
import { signUp, type SignUpResult } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { VibeCard } from "@/components/ui/surface";

const initialState: SignUpResult | null = null;

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  if (state?.ok && state.needsConfirmation) {
    return (
      <Notice tone="info" label="Check your email">
        Account created. Confirm the address from the email we sent, then sign in.
      </Notice>
    );
  }

  const error = state && !state.ok ? state.error : null;

  return (
    <VibeCard padding="md">
      {/* Action, state shape and pending handling unchanged from before UI-0. */}
      <form action={formAction} className="flex flex-col gap-4">
        <Field id="email" label="Email address">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={error ? true : undefined}
          />
        </Field>

        <Field id="password" label="Password" hint="At least 6 characters" error={error}>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="••••••••"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "password-hint password-error" : "password-hint"}
          />
        </Field>

        <Button type="submit" disabled={pending} className="mt-1">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </VibeCard>
  );
}
