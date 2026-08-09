"use client";

import { useActionState } from "react";
import { signUp, type SignUpResult } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";

const initialState: SignUpResult | null = null;

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  if (state?.ok && state.needsConfirmation) {
    return (
      <p className="text-zinc-300">
        Account created. Check your email to confirm it, then sign in.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm text-zinc-400">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />
      <label htmlFor="password" className="text-sm text-zinc-400">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        minLength={6}
        autoComplete="new-password"
        placeholder="At least 6 characters"
        className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />
      {state && !state.ok && <p className="text-sm text-red-400">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
