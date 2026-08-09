import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  email: string | null;
};

/** Reads the current Supabase session server-side. Returns null when signed out. */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return { userId: user.id, email: user.email ?? null };
}

/**
 * Sprint 1: the shared auth gate. `/app` itself is protected by
 * src/app/app/layout.tsx, but layouts do not wrap sibling Route Handlers
 * or Server Actions under the same path — those must call this
 * explicitly. Redirects to /login when there is no session; never returns
 * null, so callers don't need their own null-check branch.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
