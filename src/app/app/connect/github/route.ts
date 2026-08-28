import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { buildInstallUrl } from "@/modules/github/oauth";
import { createConnectState } from "@/modules/github/state";
import {
  listVerifiedInstallations,
  recordInstallationAccess,
} from "@/modules/github/connections";
import { checkInstallationAccess } from "@/modules/github/repositories";
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

  /*
   * Re-verify before reusing (VB-041).
   *
   * `github_installations` describes installations "verified as accessible",
   * and until now nothing ever re-verified one — so removing the App on GitHub
   * left a row that still claimed access, and this route sent the customer
   * straight to a repository picker that could list nothing.
   *
   * This is the right place for the probe and close to the only one: it is a
   * deliberate click about GitHub, it is rare, and it is the moment the answer
   * decides something. Every render path is deliberately kept off it —
   * `workspace-context.test.ts` and `dashboard-contract.test.ts` assert that,
   * and they still do.
   *
   * A probe that cannot reach GitHub records nothing and changes nothing: the
   * customer keeps whatever state they had, which is the safe direction when
   * the failure is ours.
   */
  const probed = await Promise.all(
    installations.map(async (installation) => {
      if (installation.accessRevokedAt) return installation;

      const access = await checkInstallationAccess(installation.installationId);
      await recordInstallationAccess(supabase, {
        installationRowId: installation.id,
        userId: session.userId,
        access,
      });

      return access === "revoked"
        ? { ...installation, accessRevokedAt: new Date().toISOString() }
        : installation;
    }),
  );

  const destination = resolveConnectDestination(probed, {
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
