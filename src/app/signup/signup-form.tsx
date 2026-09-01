"use client";

import { useActionState } from "react";
import {
  signInWithGoogle,
  signUp,
  type OAuthStartResult,
  type SignUpResult,
} from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import { VibeCard } from "@/components/ui/surface";

/**
 * Account creation: one screen, two ways in (UI-S1 §8).
 *
 * ## Why Google is here now
 *
 * It always worked — `signInWithGoogle` creates the account on first use, so
 * Google *was* a way to sign up. It just was not offered on the sign-up screen.
 * A visitor who wanted it had to guess that the button on the other page would
 * also make them an account, and the ones who did not guess were sent to invent
 * a password for a product they had not seen yet.
 *
 * Nothing about the auth architecture changes to fix that: the same action, the
 * same two-form structure, and the same coupled `disabled` handling as
 * `login-form.tsx`, for the same reason — one form's `required` fields must not
 * block the other's submit, and a second click during a redirect must not start
 * a second OAuth flow.
 */
export function SignupForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<SignUpResult | null, FormData>(signUp, null);
  const [googleState, googleAction, googlePending] = useActionState<
    OAuthStartResult | null,
    FormData
  >(signInWithGoogle, null);

  const busy = pending || googlePending;

  if (state?.ok && state.needsConfirmation) {
    return (
      <Notice tone="info" label="Check your email">
        <p>
          Your account is created. Open the link in the email we just sent to confirm your address,
          then sign in.
        </p>
        <p className="text-fg-muted mt-2">
          Nothing arrived? It can take a minute, and it sometimes lands in spam.
        </p>
      </Notice>
    );
  }

  const error =
    (state && !state.ok ? state.error : null) ??
    (googleState && !googleState.ok ? googleState.error : null) ??
    null;

  return (
    <VibeCard padding="md">
      <div className="flex flex-col gap-4">
        <form action={googleAction}>
          <input type="hidden" name="next" value={next} />
          <Button
            type="submit"
            variant="secondary"
            disabled={busy}
            className="w-full"
            data-testid="google-signup"
            busy={googlePending}
          >
            {googlePending ? "Opening Google…" : "Continue with Google"}
          </Button>
        </form>

        <div className="flex items-center gap-3" aria-hidden>
          <span className="bg-line-2 h-px flex-1" />
          <span className="text-fg-meta text-xs">or</span>
          <span className="bg-line-2 h-px flex-1" />
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />

          <Field id="email" label="Email address">
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              disabled={busy}
              aria-invalid={error ? true : undefined}
            />
          </Field>

          <Field id="password" label="Password" hint="At least 8 characters" error={error}>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "password-hint password-error" : "password-hint"}
            />
          </Field>

          <Button
            type="submit"
            disabled={busy}
            className="mt-1"
            data-testid="email-signup"
            busy={pending}
          >
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </div>
    </VibeCard>
  );
}
