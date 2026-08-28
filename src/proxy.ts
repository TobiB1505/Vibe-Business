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
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|\\.well-known/workflow|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
