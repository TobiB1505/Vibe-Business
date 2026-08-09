import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { exchangeUserCode, fetchGithubIdentity } from "@/modules/github/oauth";
import { getUserOctokit } from "@/modules/github/app-client";
import { verifyInstallationAccessibleToUser } from "@/modules/github/installations";
import { verifyConnectState } from "@/modules/github/state";
import { upsertGithubConnection, upsertGithubInstallation } from "@/modules/github/connections";
import { getGithubEnv } from "@/lib/env/github";

type ConnectErrorCode =
  | "oauth_denied"
  | "state_invalid"
  | "missing_params"
  | "installation_not_accessible"
  | "github_unavailable";

function errorRedirect(origin: string, code: ConnectErrorCode): NextResponse {
  const url = new URL("/app", origin);
  url.searchParams.set("connect_error", code);
  return NextResponse.redirect(url);
}

/** Never logs the raw caught error — only a technical status, never headers/body that could carry a token. */
function technicalStatus(error: unknown): number | "unknown" {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return "unknown";
}

/**
 * Step D of the connect flow (Sprint 1 §7 / ADR 0009): GitHub redirects
 * back here with `code`, `installation_id`, and our `state`. Verifies all
 * four things ADR 0009 requires before persisting anything: state
 * validity, the authenticated Supabase user, the GitHub identity behind
 * the code, and that identity's access to the claimed installation.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const { searchParams, origin } = new URL(request.url);
  const supabase = await createClient();

  if (searchParams.get("error")) {
    // User denied authorization, or GitHub reported an OAuth error.
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "github.access.failed",
      metadata: { reason: "oauth_denied" },
    });
    return errorRedirect(origin, "oauth_denied");
  }

  const state = searchParams.get("state");
  const code = searchParams.get("code");
  const installationIdParam = searchParams.get("installation_id");

  if (!state) {
    return errorRedirect(origin, "state_invalid");
  }

  const env = getGithubEnv();
  const stateResult = verifyConnectState(state, env.GITHUB_APP_CLIENT_SECRET, session.userId);
  if (!stateResult.ok) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "github.access.failed",
      metadata: { reason: `state_${stateResult.reason}` },
    });
    return errorRedirect(origin, "state_invalid");
  }

  if (!code || !installationIdParam) {
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "github.access.failed",
      metadata: { reason: "missing_params" },
    });
    return errorRedirect(origin, "missing_params");
  }

  const installationId = Number(installationIdParam);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return errorRedirect(origin, "missing_params");
  }

  let userAccessToken: string;
  try {
    const exchanged = await exchangeUserCode(code);
    userAccessToken = exchanged.userAccessToken;
  } catch (error) {
    console.error("[github.connect] code exchange failed", { status: technicalStatus(error) });
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "github.access.failed",
      metadata: { reason: "code_exchange_failed" },
    });
    return errorRedirect(origin, "github_unavailable");
  }

  try {
    const identity = await fetchGithubIdentity(userAccessToken);

    const userOctokit = getUserOctokit(userAccessToken);
    const verifiedInstallation = await verifyInstallationAccessibleToUser(userOctokit, installationId);

    if (!verifiedInstallation) {
      // The core ADR 0009 rejection: the installation_id from the callback
      // is not actually accessible to the GitHub identity we just
      // verified. Reject — never persist.
      await recordAuditEvent(supabase, {
        userId: session.userId,
        eventType: "github.access.failed",
        metadata: { reason: "installation_not_accessible" },
      });
      return errorRedirect(origin, "installation_not_accessible");
    }

    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "github.identity.verified",
      metadata: { githubLogin: identity.githubLogin },
    });

    await upsertGithubConnection(supabase, session.userId, identity);
    const installationRow = await upsertGithubInstallation(supabase, session.userId, verifiedInstallation);

    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "github.installation.connected",
      metadata: { accountLogin: verifiedInstallation.accountLogin },
    });

    const repositoriesUrl = new URL("/app/connect/github/repositories", origin);
    repositoriesUrl.searchParams.set("installation", installationRow.id);
    return NextResponse.redirect(repositoriesUrl);
  } catch (error) {
    console.error("[github.connect] verification failed", { status: technicalStatus(error) });
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "github.access.failed",
      metadata: { reason: "github_unavailable" },
    });
    return errorRedirect(origin, "github_unavailable");
  }
}
