import { NextResponse } from "next/server";
import { buildIdentity } from "@/lib/observability/health";

/**
 * Liveness, for an uptime monitor (VB-034).
 *
 * It answers one question — *is this deployment serving requests* — and it is
 * unauthenticated because a monitor has no session and never will. What that
 * costs is that everything in the response is public, so the response is built
 * from a fixed shape rather than assembled from whatever is to hand.
 *
 * ## It does not touch the database, and that is a decision
 *
 * A database ping is the obvious next thing to want, and it is what the finding
 * called optional. It is left out because of who would have to make it. Since
 * [VB-015](../../../../../docs/sprints/0103-wave1-security-before-public-traffic.md)
 * the `anon` role holds no privilege on any table, so a reachability check from
 * here would need the service-role client — and putting one behind an
 * unauthenticated public route is precisely the blast radius
 * [CLAUDE.md](../../../../../CLAUDE.md) rule 53 exists to bound. Monitoring
 * convenience is not the argument that should widen it.
 *
 * So this reports what it can actually see: this process is running, and which
 * build it is. A monitor that needs to know the database is reachable learns it
 * from a signed-in page failing, which is the truth anyway.
 *
 * ## Why the commit is safe to name and nothing else is
 *
 * It identifies the build to us and nothing to a stranger: the repository is
 * private, so the SHA resolves to no readable source. Everything a stranger
 * *could* use — dependency versions, configuration, which providers are
 * configured, whether a variable is set — is deliberately absent. There is no
 * parameter that adds a field, because a field that does not exist cannot be
 * asked for.
 */

/** Never cached: a cached liveness answer is a liveness answer about the past. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", ...buildIdentity() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** An uptime monitor that only needs the status code should not pay for a body. */
export async function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
