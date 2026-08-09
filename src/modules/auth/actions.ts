"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const GENERIC_SIGNIN_ERROR = "Invalid email or password.";
const GENERIC_SIGNUP_ERROR = "Could not create an account with those details.";

function parseCredentials(formData: FormData): { email: string; password: string } | null {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || !email.includes("@")) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  return { email, password };
}

/** Never logs the credential values themselves — only Supabase's own error code/status. */
function logAuthFailure(context: string, error: { code?: string; status?: number }): void {
  console.error(`[auth.${context}]`, { code: error.code, status: error.status });
}

export type SignInResult = { ok: true } | { ok: false; error: string };

/**
 * Development/Sprint 1 auth: email + password via Supabase Auth. Chosen
 * over magic link for a deterministic flow that doesn't depend on
 * Supabase's development email rate limits — see
 * src/modules/auth/README.md.
 */
export async function signInWithPassword(
  _prevState: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const credentials = parseCredentials(formData);
  if (!credentials) {
    return { ok: false, error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    logAuthFailure("signin", error);
    return { ok: false, error: GENERIC_SIGNIN_ERROR };
  }

  redirect("/app");
}

export type SignUpResult =
  | { ok: true; needsConfirmation: boolean }
  | { ok: false; error: string };

/**
 * Minimal development account creation. Assumes Supabase's "Confirm
 * email" is disabled in development (see docs/setup — a session is
 * returned immediately and the user lands in /app). If confirmation is
 * enabled later, signUp() returns no session and no error: this reports
 * `needsConfirmation` instead of crashing or redirecting somewhere
 * broken. Completing that flow (a working confirmation link) is out of
 * scope until production/beta auth policy is revisited.
 */
export async function signUp(
  _prevState: SignUpResult | null,
  formData: FormData,
): Promise<SignUpResult> {
  const credentials = parseCredentials(formData);
  if (!credentials) {
    return { ok: false, error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(credentials);

  if (error) {
    logAuthFailure("signup", error);
    return { ok: false, error: GENERIC_SIGNUP_ERROR };
  }

  if (data.session) {
    redirect("/app");
  }

  return { ok: true, needsConfirmation: true };
}

/** Useful for repeatedly testing multiple auth states during development. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
