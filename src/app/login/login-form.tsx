"use client";

import { useActionState } from "react";
import { signInWithMagicLink, type SignInResult } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";

const initialState: SignInResult | null = null;

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInWithMagicLink, initialState);

  if (state?.ok) {
    return (
      <p className="text-zinc-300">Check your inbox — we sent a sign-in link to your email address.</p>
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
      {state && !state.ok && <p className="text-sm text-red-400">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send magic link"}
      </Button>
    </form>
  );
}
