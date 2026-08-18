import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env/env";
import { getSupabaseServiceEnv } from "@/lib/env/supabase-service";

/**
 * The service-role Supabase client. **RLS does not apply to this client.**
 *
 * It exists for callers that genuinely have no session to act under:
 *
 *  1. **Durable operation execution** (ADR 0013). A workflow step runs outside
 *     any HTTP request, so there is no cookie and no `auth.uid()`.
 *  2. **The Stripe webhook** (ADR 0025). Stripe authenticates by signing the
 *     request body, not by presenting a Vibe session — there is no user agent
 *     and no cookie, by design. The endpoint is nonetheless the only funding
 *     path into the Credit ledger, so it needs to write.
 *
 * Both are the same situation and carry the same obligation: RLS cannot apply,
 * so ownership has to be re-established in code.
 *
 * ## The rules that replace RLS
 *
 * RLS was not a nice-to-have here — it was the single mechanism preventing one
 * user's data reaching another. Removing it means the guarantee has to be
 * re-established in code, so every query made with this client MUST:
 *
 *  1. **Filter on ownership explicitly.** `project_id` and `user_id` come from
 *     the persisted operation row, never from a function argument that
 *     originated outside the server.
 *  2. **Take its identifiers from one trusted source.** A workflow step is
 *     handed an operation id and nothing else; it re-reads the row and uses
 *     that row's ids. A step must never accept a `projectId` or `userId`
 *     parameter, because then a caller could name someone else's.
 *  3. **Stay inside `src/modules/operations/` or `src/modules/billing/`.**
 *     Nothing else may import this module. The read path the browser uses
 *     stays on the cookie-scoped client in `server.ts`, where RLS still
 *     enforces everything — including every read on the billing page.
 *
 * The billing webhook satisfies (1) and (2) the same way a workflow step does:
 * it never accepts a `userId` from its caller. The owner is resolved from
 * `billing_stripe_customers`, a mapping Vibe wrote itself when it created the
 * Stripe customer — so a payload claiming to belong to somebody else resolves
 * to nothing, not to that somebody else.
 *
 * Sessions are disabled: this client must never pick up, persist or refresh a
 * user session, and it has no storage to put one in.
 */
export function createServiceClient(): SupabaseClient {
  const env = getPublicEnv();
  const service = getSupabaseServiceEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, service.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
