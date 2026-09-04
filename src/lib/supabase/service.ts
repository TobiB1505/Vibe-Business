import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env/env";
import { getSupabaseServiceEnv } from "@/lib/env/supabase-service";
import { SUPABASE_REQUEST_TIMEOUT_MS, withBoundedFetch } from "@/lib/net/bounded-fetch";

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
 *  3. **The internal operator console** (ADR 0088). The first caller that has a
 *     session and still cannot use it: the console reads *across* tenants, so
 *     RLS would scope it to the operator's own projects and answer a question
 *     nobody asked. It is read-only.
 *
 * The first two are the same situation and carry the same obligation: RLS
 * cannot apply, so ownership has to be re-established in code. The third
 * cannot re-establish ownership at all, and says so below.
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
 *     Nothing else may import this module without an entry in
 *     `REVIEWED_SITES`. The read path the browser uses stays on the
 *     cookie-scoped client in `server.ts`, where RLS still enforces
 *     everything — including every read on the billing page.
 *
 * ## The one caller that cannot obey (1) or (2), and what replaces them
 *
 * The operator console reads every tenant's rows on purpose, so there is no
 * ownership to filter on. What it does instead is remove the thing (1) and (2)
 * protect against: **no query it makes accepts a project id, a user id, or any
 * other selector from its caller**, so there is no argument to forge. The
 * filter is replaced by a prior gate — an operator id from verified claims,
 * checked against an environment allowlist that is unset by default and that
 * the application has no path to write. It reads and never writes, and every
 * query names its columns from a constant. See ADR 0088.
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
    /**
     * A deadline, because this client is the one durable execution uses
     * (VB-031). `fetch` has no default timeout, so a socket that is accepted
     * and then goes quiet holds a workflow step until the platform's own
     * ceiling ends it — turning a slow dependency into a wedged operation.
     *
     * No retry: every write in this application's durable path is either
     * consequential or already idempotent by unique index, and rules 50 and 73
     * are explicit that an ambiguous outcome is resolved by reading rather than
     * by trying again. The helper would only retry `GET`/`HEAD` anyway; not
     * asking for it says so at the call site.
     */
    global: { fetch: withBoundedFetch({ timeoutMs: SUPABASE_REQUEST_TIMEOUT_MS }) },
  });
}
