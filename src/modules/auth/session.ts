import "server-only";

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
