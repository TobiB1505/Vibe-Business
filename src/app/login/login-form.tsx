"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  signInWithGithub,
  signInWithGoogle,
  signInWithPassword,
  type OAuthStartResult,
  type SignInResult,
} from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ProviderRow } from "./provider-row";

/**
 * The sign-in form: one screen, several ways in (UI-19).
 *
 * ## Why the provider forms are separate from the credentials form
 *
 * Because they are genuinely different submissions — one posts credentials and
 * stays here on failure, the others hand off and never return to this render.
 * Sharing a form would mean the email field's `required` validation blocking
 * the Google button, which is a browser behaviour nobody would guess from
 * reading the code.
 *
 * They are still coupled where it matters: any submission disables all of
 * them, so a second click during a redirect cannot start a second OAuth flow
 * or post the credentials twice.
 *
 * ## Where the error goes
 *
 * Under the fields and above the submit, as a `FormError` bound to both
 * inputs. It used to be a `Field` error on *password* — so "Enter your email
 * and password" and "We couldn't reach the server" both rendered under one of
 * the two fields they were not specifically about, telling a reader the other
 * one was fine.
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

  const [githubState, githubAction, githubPending] = useActionState<
    OAuthStartResult | null,
    FormData
  >(signInWithGithub, null);

  const busy = passwordPending || googlePending || githubPending;

  // A fresh submission's own error wins over the one carried in on the URL,
  // so the screen never shows a stale Google failure next to a new typo.
  const error =
    (passwordState && !passwordState.ok ? passwordState.error : null) ??
    (googleState && !googleState.ok ? googleState.error : null) ??
    (githubState && !githubState.ok ? githubState.error : null) ??
    initialError ??
    null;

  const describedBy = error ? "signin-error" : undefined;

  return (
    <div className="flex flex-col gap-5">
      <ProviderRow
        next={next}
        busy={busy}
        verb="Continue"
        google={{ action: googleAction, pending: googlePending, testId: "google-signin" }}
        github={{ action: githubAction, pending: githubPending, testId: "github-signin" }}
      />

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
            aria-describedby={describedBy}
          />
        </Field>

        <Field
          id="password"
          label="Password"
          /*
            Beside the label rather than under the form. Somebody who cannot
            remember their password knows it at the moment they look at the
            field, not after they have tried and failed.
          */
          action={
            <Link
              href="/forgot-password"
              className="text-fg-muted hover:text-fg-body rounded-inline text-caption transition-interactive"
            >
              Forgot it?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        </Field>

        {error && <FormError id="signin-error">{error}</FormError>}

        <Button
          type="submit"
          disabled={busy}
          className="mt-1"
          data-testid="email-signin"
          busy={passwordPending}
        >
          {passwordPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
