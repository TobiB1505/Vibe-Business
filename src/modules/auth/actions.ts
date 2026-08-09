"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type SignInResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a Supabase magic-link sign-in email. Runs entirely server-side —
 * no browser Supabase client is needed for this flow. See
 * src/modules/auth/README.md for why magic link was chosen over
 * email+password for Sprint 0.
 */
export async function signInWithMagicLink(
  _prevState: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const email = formData.get("email");

  if (typeof email !== "string" || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${await getRequestOrigin()}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/** Derives the current request's origin from headers so no extra site-url env var is needed. */
async function getRequestOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host");
  const proto =
    headersList.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "development" ? "http" : "https");
  return `${proto}://${host}`;
}
