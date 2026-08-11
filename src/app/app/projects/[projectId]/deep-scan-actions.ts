"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getBrowserSessionProvider } from "@/modules/authenticated-product-intelligence/browserbase/client";
import {
  analyzeDeepScan,
  cancelDeepScan,
  getDeepScanLiveView,
  startDeepScan,
} from "@/modules/authenticated-product-intelligence/service";

/**
 * Deep Scan Server Actions (Sprint 5 §4, §5).
 *
 * These are a thin, safe boundary and nothing more. Every one of them:
 *
 *  1. resolves the user from the server session — `userId` is never accepted
 *     from the client, so a caller cannot act as someone else;
 *  2. delegates the decision to the existing service, which owns entitlement,
 *     cooldown, ownership, expiry and provider cleanup (§1);
 *  3. returns a typed failure code, never a provider error, response body, or
 *     capability URL (§5, §17).
 *
 * No business rule is re-implemented here. If an action ever needs to decide
 * whether a scan is allowed, that belongs in the entitlement policy instead.
 */

export type DeepScanActionFailure = string;

export type StartDeepScanActionState =
  | { ok: true; sessionId: string; expiresAt: string }
  | { ok: false; error: DeepScanActionFailure };

export type LiveViewActionState =
  | { ok: true; liveViewUrl: string }
  | { ok: false; error: DeepScanActionFailure };

export type SimpleDeepScanActionState = { ok: true } | { ok: false; error: DeepScanActionFailure };

export type AnalyzeDeepScanActionState =
  | { ok: true; pagesInspected: number }
  | { ok: false; error: DeepScanActionFailure };

/**
 * The provider is constructed lazily and only inside an action, so a missing
 * `BROWSERBASE_API_KEY` surfaces as a typed, explainable state rather than an
 * exception during page render.
 */
function provider() {
  return getBrowserSessionProvider();
}

export async function startDeepScanAction(projectId: string): Promise<StartDeepScanActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  let result;
  try {
    result = await startDeepScan(supabase, provider(), { projectId, userId: session.userId });
  } catch {
    // Reaching here means the provider could not even be constructed — a
    // configuration problem, not a user-facing failure of their product.
    return { ok: false, error: "browser_provider_not_configured" };
  }

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, sessionId: result.sessionId, expiresAt: result.expiresAt };
}

/**
 * Fetches a Live View URL for an owned, still-live session.
 *
 * Not a form action: the capability is requested imperatively by the modal and
 * held in component state for the lifetime of the render. It is never
 * persisted, never stored in the DOM beyond the iframe `src`, and never placed
 * in local/session storage (§6).
 */
export async function getDeepScanLiveViewAction(sessionId: string): Promise<LiveViewActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  let result;
  try {
    result = await getDeepScanLiveView(supabase, provider(), { sessionId, userId: session.userId });
  } catch {
    return { ok: false, error: "browser_provider_not_configured" };
  }

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, liveViewUrl: result.liveViewUrl };
}

export async function analyzeDeepScanAction(
  projectId: string,
  sessionId: string,
): Promise<AnalyzeDeepScanActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  let result;
  try {
    // Continues the *existing* session. No second browser is ever created here.
    result = await analyzeDeepScan(supabase, provider(), { sessionId, userId: session.userId });
  } catch {
    return { ok: false, error: "analysis_failed" };
  }

  revalidatePath(`/app/projects/${projectId}`);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, pagesInspected: result.pagesInspected };
}

export async function cancelDeepScanAction(
  projectId: string,
  sessionId: string,
): Promise<SimpleDeepScanActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  let result;
  try {
    result = await cancelDeepScan(supabase, provider(), { sessionId, userId: session.userId });
  } catch {
    return { ok: false, error: "analysis_failed" };
  }

  revalidatePath(`/app/projects/${projectId}`);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
