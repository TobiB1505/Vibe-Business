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
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
