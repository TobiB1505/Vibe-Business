import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { buildInstallUrl } from "@/modules/github/oauth";
import { createConnectState } from "@/modules/github/state";
import { listVerifiedInstallations } from "@/modules/github/connections";
import { resolveConnectDestination } from "@/modules/github/connect-routing";
import { getGithubEnv } from "@/lib/env/github";

/**
 * Entry point for "Connect a project". Requires an authenticated Vibe
 * Business session — GitHub integration never operates for anonymous
 * users (Sprint 1 §2).
 *
 * A user who already has a verified installation is sent straight to
 * their repositories rather than back through `/installations/new`,
 * which GitHub renders as its App settings page once the App is
 * installed. Re-installing is only for genuinely new accounts — see
 * src/modules/github/connect-routing.ts.
 *
 * `?new=1` always starts a real installation: used for connecting an
 * additional GitHub account/organization and for reconnecting after
 * revoked access. That path still runs the full ADR 0009 authorization
 * and ownership verification, unchanged.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const supabase = await createClient();
  const { searchParams, origin } = new URL(request.url);

  const installations = await listVerifiedInstallations(supabase, session.userId);
  const destination = resolveConnectDestination(installations, {
    forceNewInstallation: searchParams.get("new") === "1",
  });

  if (destination.kind === "repository_picker") {
    const url = new URL("/app/connect/github/repositories", origin);
    url.searchParams.set("installation", destination.installationRowId);
    return NextResponse.redirect(url);
  }

  if (destination.kind === "choose_installation") {
    return NextResponse.redirect(new URL("/app/connect/github/accounts", origin));
  }

  // Only now is a GitHub authorization actually starting: the App
  // credentials are read and the audit event emitted here, never on the
  // reuse paths above.
  const env = getGithubEnv();
  const state = createConnectState(session.userId, env.GITHUB_APP_CLIENT_SECRET);

  await recordAuditEvent(supabase, {
    userId: session.userId,
    eventType: "github.authorization.started",
  });

  return NextResponse.redirect(buildInstallUrl(state));
}
