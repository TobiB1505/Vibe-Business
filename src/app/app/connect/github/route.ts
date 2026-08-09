import { NextResponse } from "next/server";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { buildInstallUrl } from "@/modules/github/oauth";
import { createConnectState } from "@/modules/github/state";
import { getGithubEnv } from "@/lib/env/github";

/**
 * Step A/B of the connect flow (Sprint 1 §7): the "Connect GitHub" link
 * lands here. Requires an authenticated Vibe Business session — GitHub
 * integration never operates for anonymous users (Sprint 1 §2).
 */
export async function GET() {
  const session = await requireSession();
  const env = getGithubEnv();

  const state = createConnectState(session.userId, env.GITHUB_APP_CLIENT_SECRET);

  const supabase = await createClient();
  await recordAuditEvent(supabase, {
    userId: session.userId,
    eventType: "github.authorization.started",
  });

  return NextResponse.redirect(buildInstallUrl(state));
}
