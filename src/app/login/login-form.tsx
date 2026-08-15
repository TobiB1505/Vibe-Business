"use client";

import { useActionState } from "react";
import { signInWithPassword, type SignInResult } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { VibeCard } from "@/components/ui/surface";

const initialState: SignInResult | null = null;

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInWithPassword, initialState);
  const error = state && !state.ok ? state.error : null;

  return (
    <VibeCard padding="md">
      {/* The action, the state shape and the pending handling are unchanged
          from before UI-0 — only the presentation moved onto the design
          system. */}
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

        <Field id="password" label="Password" error={error}>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "password-error" : undefined}
          />
        </Field>

        <Button type="submit" disabled={pending} className="mt-1">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </VibeCard>
  );
}
