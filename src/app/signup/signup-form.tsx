"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  signInWithGithub,
  signInWithGoogle,
  signUp,
  type OAuthStartResult,
  type SignUpResult,
} from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Notice } from "@/components/ui/states";
import { proseLinkClasses } from "@/components/ui/text-link";
import { MINIMUM_PASSWORD_LENGTH, PASSWORD_HINT } from "@/modules/auth/password";
import { ProviderRow } from "@/app/login/provider-row";

/**
 * Account creation: one screen, several ways in (UI-S1 §8; redesigned UI-19).
 *
 * ## Why Google was here before GitHub
 *
 * It always worked — `signInWithGoogle` creates the account on first use, so
 * Google *was* a way to sign up. It just was not offered on the sign-up
 * screen. A visitor who wanted it had to guess that the button on the other
 * page would also make them an account, and the ones who did not guess were
 * sent to invent a password for a product they had not seen yet.
 *
 * GitHub is the newer one and the more obvious in hindsight: this is a
 * GitHub-native product and every founder connects a repository, so the one
 * provider every user certainly has was the one not offered. It appears only
 * where the deployment has configured it — see `modules/auth/providers.ts`.
 */
export function SignupForm({ next, github }: { next: string; github: boolean }) {
  const [state, formAction, pending] = useActionState<SignUpResult | null, FormData>(signUp, null);
  const [googleState, googleAction, googlePending] = useActionState<
    OAuthStartResult | null,
    FormData
  >(signInWithGoogle, null);
  const [githubState, githubAction, githubPending] = useActionState<
    OAuthStartResult | null,
    FormData
  >(signInWithGithub, null);

  const busy = pending || googlePending || githubPending;

  if (state?.ok && state.needsConfirmation) {
    return (
      <Notice tone="info" label="Check your email">
        <p>
          Your account is created. Open the link we just sent to{" "}
          {/*
            The address, named.

            "Check your email" is not checkable: the field it was typed into is
            gone by the time this renders, so somebody who mistyped their own
            address has no way to see that they did — they wait for an email
            that was never going to arrive.
          */}
          <strong className="text-fg-body font-semibold">{state.email}</strong> to confirm your
          address, then sign in.
        </p>
        <p className="text-fg-muted mt-2">
          Nothing arrived? It can take a minute, and it sometimes lands in spam. If that address is
          wrong,{" "}
          <Link href="/signup" className={proseLinkClasses()}>
            start again
          </Link>
          .
        </p>
      </Notice>
    );
  }

  const error =
    (state && !state.ok ? state.error : null) ??
    (googleState && !googleState.ok ? googleState.error : null) ??
    (githubState && !githubState.ok ? githubState.error : null) ??
    null;

  const describedBy = error ? "signup-error" : undefined;

  return (
    <div className="flex flex-col gap-5">
      <ProviderRow
        next={next}
        busy={busy}
        verb="Sign up"
        google={{ action: googleAction, pending: googlePending, testId: "google-signup" }}
        github={
          github
            ? { action: githubAction, pending: githubPending, testId: "github-signup" }
            : null
        }
      />

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
            aria-describedby={describedBy}
          />
        </Field>

        <Field id="password" label="Password" hint={PASSWORD_HINT}>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={MINIMUM_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder="••••••••"
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              describedBy ? `password-hint ${describedBy}` : "password-hint"
            }
          />
        </Field>

        {error && <FormError id="signup-error">{error}</FormError>}

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
  );
}
