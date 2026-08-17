"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  signInWithGoogle,
  signInWithPassword,
  type OAuthStartResult,
  type SignInResult,
} from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { VibeCard } from "@/components/ui/surface";

/**
 * The sign-in form: one screen, two ways in.
 *
 * ## Why two forms rather than one with two submit buttons
 *
 * Because they are genuinely different submissions — one posts credentials
 * and stays here on failure, the other hands off to Google and never returns
 * to this render. Sharing a form would mean the email fields' `required`
 * validation blocking the Google button, which is a browser behaviour nobody
 * would guess from reading the code.
 *
 * They are still coupled where it matters: either submission disables both,
 * so a second click during a redirect cannot start a second OAuth flow or
 * post the credentials twice.
 */
export function LoginForm({
  next,
  initialError,
}: {
  /** Already sanitized server-side; carried so a redirect survives sign-in. */
  next: string;
  /** A failure from a previous attempt, e.g. a Google callback that bounced. */
  initialError?: string | null;
}) {
  const [passwordState, passwordAction, passwordPending] = useActionState<
    SignInResult | null,
    FormData
  >(signInWithPassword, null);

  const [googleState, googleAction, googlePending] = useActionState<
    OAuthStartResult | null,
    FormData
  >(signInWithGoogle, null);

  const busy = passwordPending || googlePending;

  // A fresh submission's own error wins over the one carried in on the URL,
  // so the screen never shows a stale Google failure next to a new typo.
  const error =
    (passwordState && !passwordState.ok ? passwordState.error : null) ??
    (googleState && !googleState.ok ? googleState.error : null) ??
    initialError ??
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
            data-testid="google-signin"
          >
            {googlePending ? "Opening Google…" : "Continue with Google"}
          </Button>
        </form>

        <div className="flex items-center gap-3" aria-hidden>
          <span className="bg-line-2 h-px flex-1" />
          <span className="text-fg-meta text-xs">or</span>
          <span className="bg-line-2 h-px flex-1" />
        </div>

        <form action={passwordAction} className="flex flex-col gap-4">
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

          <Field id="password" label="Password" error={error}>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "password-error" : undefined}
            />
          </Field>

          <Button type="submit" disabled={busy} className="mt-1" data-testid="email-signin">
            {passwordPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <Link
          href="/forgot-password"
          className="text-fg-muted hover:text-fg rounded-sm text-sm"
        >
          Forgot password?
        </Link>
      </div>
    </VibeCard>
  );
}
