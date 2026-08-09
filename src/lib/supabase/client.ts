"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env/env";

/**
 * Supabase client for Client Components. Not yet used by any Sprint 0
 * screen (the login flow runs entirely server-side via Server Actions),
 * but kept available as the documented entry point for future
 * client-side Supabase usage.
 */
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
