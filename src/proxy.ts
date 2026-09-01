import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /**
   * `.well-known/workflow/*` is excluded deliberately (Sprint 7 §3).
   *
   * Those routes are the durable execution plane. They are invoked by the
   * Workflow platform with its own OIDC credentials and carry no user
   * cookies, so running them through the Supabase session refresh would
   * attach an anonymous session to every step and, worse, make the
   * orchestration plane depend on our auth layer being healthy.
   *
   * `api/health` is excluded for the same reason stated the other way round
   * (VB-034). A liveness probe answers "is this deployment serving requests",
   * and refreshing a session it does not have would make that answer depend on
   * Supabase Auth — so an auth outage would report the application down when
   * it is up, and every probe would cost a round trip to a third party.
   *
   * The Stripe webhook and the Agent Gateway join them for exactly that
   * argument (PERF-016). Each says in its own docblock that authentication is
   * the signature, or the token, and nothing else; neither reads a cookie.
   * Running them through a session refresh puts Supabase Auth in front of
   * Stripe's delivery timeout and in front of a paid upstream call, and buys
   * a refreshed session nobody holds.
   *
   * ## What is deliberately still matched
   *
   * The marketing and legal pages, which the audit proposed excluding too. The
   * cost it named is not there to save: `getClaims()` returns without network
   * I/O when the request carries no session, so an anonymous visitor to `/`
   * already pays nothing — and for a signed-in one the refresh is doing its
   * job rather than wasting a trip. Routes are enumerated rather than the
   * `api` tree excluded wholesale, so a future route that does need a session
   * is covered by default instead of quietly uncovered.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/billing/stripe/webhook|api/agent-gateway|\\.well-known/workflow|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
