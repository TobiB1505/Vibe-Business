"use client";

import { useActionState } from "react";
import { updatePassword, type PasswordUpdateResult } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { VibeCard } from "@/components/ui/surface";

/**
 * Sets the new password.
 *
 * No token field: by the time this renders, `/auth/confirm` has already
 * exchanged the emailed one-time token for a real session, so this is an
 * ordinary authenticated update. That is also why the recovery token never
 * appears in the URL of this page — it was spent one redirect ago.
 */
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<PasswordUpdateResult | null, FormData>(
    updatePassword,
    null,
  );

  const error = state && !state.ok ? state.error : null;

  return (
    <VibeCard padding="md">
      <form action={formAction} className="flex flex-col gap-4">
        <Field id="password" label="New password" hint="At least 6 characters">
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="••••••••"
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby="password-hint"
          />
        </Field>

        <Field id="password_confirmation" label="Confirm new password" error={error}>
          <Input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="••••••••"
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "password_confirmation-error" : undefined}
          />
        </Field>

        <Button
          type="submit"
          disabled={pending}
          className="mt-1"
          data-testid="set-password"
          busy={pending}
        >
          {pending ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </VibeCard>
  );
}
