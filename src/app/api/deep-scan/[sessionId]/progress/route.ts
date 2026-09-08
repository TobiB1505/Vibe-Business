import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getDeepScanProgress } from "@/modules/authenticated-product-intelligence/service";

/**
 * How far a running Deep Scan has got.
 *
 * ## Why this is a route and not a Server Action
 *
 * It was a Server Action, and it could never have worked. Next.js executes
 * Server Actions from one client **one at a time**, and the analysis is itself
 * a Server Action that runs for ninety seconds. Every progress poll queued
 * behind it: a real run produced roughly thirty of them, and the runtime log
 * shows all thirty arriving in a burst over eight seconds *after* the analysis
 * returned — which is also why the panel then sat blank for twenty to thirty
 * seconds before the new result appeared. One cause, two symptoms.
 *
 * A route handler is an ordinary `fetch`. It is not queued behind anything,
 * and it is not new infrastructure — it is the mechanism Next.js already has
 * for reading something while something else is running.
 *
 * ## What it is allowed to do
 *
 * Read one number for a session the caller owns. No writes, no revalidation,
 * nothing it could start or stop. The session id in the path is not trusted:
 * `getDeepScanProgress` resolves the session, then the project, then checks
 * ownership against the server session — the id names a row, it does not
 * authorize one.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch {
    // Never a redirect: this is polled from a dialog, and a login redirect
    // rendered into a JSON fetch is a confusing 200 nobody can read.
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const supabase = await createClient();
  const progress = await getDeepScanProgress(supabase, { sessionId, userId });

  /*
   * `null` is an answer, not an error: it means no analysis is running for
   * this session — before it starts, and after it ends. The panel shows the
   * animation without a count, which is where it was before this existed.
   */
  return NextResponse.json(progress, {
    // A count that changes every few seconds must never be served from a cache.
    headers: { "Cache-Control": "no-store" },
  });
}
