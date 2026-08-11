"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { DeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import {
  analyzeDeepScanAction,
  cancelDeepScanAction,
  getDeepScanLiveViewAction,
  startDeepScanAction,
} from "./deep-scan-actions";

/**
 * Deep Scan panel (Sprint 5 §3, §7, §16, §17).
 *
 * Renders server-derived state and calls Server Actions. It decides nothing:
 * eligibility, entitlement, cooldown and expiry all arrive already resolved in
 * the view model, so this component cannot disagree with the domain (§13).
 *
 * The Live View URL lives in `useState` for the lifetime of the open modal and
 * nowhere else — not in storage, not in the URL, not on the server's rendered
 * HTML. A reload legitimately loses it and re-requests it (§6).
 */

/**
 * Typed failures in the user's language (§17).
 *
 * No stack trace, no provider message, no status body. The lookup has a
 * fallback because the union spans several modules and a missing key must
 * degrade to a sentence, never to a blank state.
 */
const ERROR_MESSAGES: Record<string, string> = {
  production_origin_missing: "Add your production website URL before running a Deep Scan.",
  credits_required: "Your included Deep Scan for this project has been used.",
  scan_already_running: "A Deep Scan is already running for this project.",
  cooldown_active: "Please wait a moment before starting another Deep Scan.",
  start_attempts_exhausted: "Too many Deep Scan attempts recently. Try again later.",
  browser_provider_not_configured: "Deep Scan isn't available right now.",
  browser_session_create_failed: "Deep Scan couldn't start. Try again in a moment.",
  browser_provider_unavailable: "Deep Scan couldn't start. Try again in a moment.",
  browser_session_expired: "This temporary Deep Scan session expired. You can start again.",
  browser_session_not_found: "This Deep Scan session is no longer available.",
  browser_connection_failed: "We lost the connection to the temporary browser. You can start again.",
  session_not_live: "This temporary Deep Scan session is no longer active.",
  session_not_found: "This Deep Scan session is no longer available.",
  authenticated_origin_not_reached:
    "We couldn't find your product after sign-in. Make sure you've finished logging in and are inside your app, then try again.",
  authentication_not_confirmed:
    "We couldn't confirm you were signed in. Finish signing in inside the temporary browser, then try again.",
  navigation_timeout: "Your product took too long to respond. You can try again.",
  page_unreachable: "Some pages of your product couldn't be reached.",
  analysis_budget_reached: "Deep Scan reached its limit before finishing. The result may be partial.",
  analysis_failed: "The Deep Scan couldn't be completed.",
  persist_failed: "We couldn't save the Deep Scan result. Your included scan is still available.",
  included_scan_already_consumed: "Your included Deep Scan for this project has already been used.",
  project_not_found: "This project could not be found.",
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Deep Scan couldn't be completed.";
}

/** "in about 2 minutes" — coarse on purpose; a live countdown would be noise. */
function waitHint(retryAvailableAt: string | null): string | null {
  if (!retryAvailableAt) return null;
  const remainingMs = Date.parse(retryAvailableAt) - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const minutes = Math.ceil(remainingMs / 60_000);
  return minutes <= 1 ? "You can try again in about a minute." : `You can try again in about ${minutes} minutes.`;
}

function Section({ children }: { children: React.ReactNode }) {
  // `id` is the jump target for the audit section's "Run included Deep Scan".
  return (
    <section id="deep-scan" className="space-y-3 rounded-md border border-zinc-800 p-4">
      {children}
    </section>
  );
}

function Heading({ title, status }: { title: string; status?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
      {status && <span className="text-xs text-zinc-500">{status}</span>}
    </div>
  );
}

/**
 * The temporary browser, shown in a modal dialog.
 *
 * Closing it is never cosmetic: ESC and the close control both cancel through
 * the service, because hiding the modal while leaving a remote browser running
 * would keep billing and keep an authenticated session alive (§10, §16).
 */
function LiveViewDialog({
  liveViewUrl,
  loading,
  error,
  busy,
  onCancel,
  onAnalyze,
}: {
  liveViewUrl: string | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onAnalyze: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ESC cancels for real rather than merely closing the overlay.
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deep-scan-dialog-title"
        aria-describedby="deep-scan-dialog-description"
        tabIndex={-1}
        className="flex max-h-[94vh] w-full max-w-6xl flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 focus:outline-none"
      >
        <div className="space-y-1">
          <h3 id="deep-scan-dialog-title" className="text-sm font-medium text-zinc-100">
            Sign in to your product
          </h3>
          <p id="deep-scan-dialog-description" className="text-xs text-zinc-400">
            Sign in normally inside this temporary browser. Vibe does not store your password or a
            reusable login session.
          </p>
        </div>

        {/* aspect-video matches the 1280x720 viewport requested in the
            Browserbase adapter. Any other ratio makes the provider letterbox
            the browser, which is what made this look broken. */}
        <div className="aspect-video w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
          {loading && (
            <p role="status" className="p-4 text-sm text-zinc-400">
              Opening a temporary browser…
            </p>
          )}
          {error && (
            <p role="alert" className="p-4 text-sm text-amber-400">
              {error}
            </p>
          )}
          {liveViewUrl && !error && (
            <iframe
              // The URL comes only from the authorized server action.
              src={liveViewUrl}
              title="Temporary browser for signing in to your product"
              className="block h-full w-full"
              // Deliberately minimal. No camera, microphone, geolocation, or
              // clipboard — none has been shown necessary for a login (§7).
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          )}
        </div>

        <p className="text-xs text-zinc-500">Deep Scan works best on a desktop browser.</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={onAnalyze} disabled={busy || !liveViewUrl}>
            {busy ? "Working…" : "I'm logged in — Analyze"}
          </Button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-200 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultSummary({ result }: { result: NonNullable<DeepScanViewModel["lastResult"]> }) {
  return (
    <div className="space-y-3">
      <dl className="space-y-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-zinc-500">Last analyzed</dt>
          <dd className="text-zinc-300">{new Date(result.analyzedAt).toLocaleString()}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-zinc-500">Pages inspected</dt>
          <dd className="text-zinc-300">{result.pagesInspected}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-zinc-500">Completeness</dt>
          <dd className={result.completeness === "complete" ? "text-emerald-400" : "text-amber-400"}>
            {result.completeness === "complete" ? "Complete" : "Partial"}
          </dd>
        </div>
      </dl>

      {result.surfaces.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Signed-in product surfaces
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {result.surfaces.map((surface) => (
              <li
                key={surface.id}
                className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
              >
                {surface.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.accessMode === "included_first_scan" && (
        <p className="text-xs text-zinc-500">Included Deep Scan used.</p>
      )}
    </div>
  );
}

export function DeepScanPanel({ projectId, model }: { projectId: string; model: DeepScanViewModel }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [sessionId, setSessionId] = useState<string | null>(model.activeSession?.id ?? null);
  // Never auto-opened on mount: a page reload must not slam a modal open, and
  // the capability is only requested when the user asks to see the browser.
  const [dialogOpen, setDialogOpen] = useState(false);
  // Held in memory only, for the lifetime of the open dialog (§6).
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [liveViewLoading, setLiveViewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLiveView = useCallback(async (id: string) => {
    setLiveViewLoading(true);
    setError(null);
    const result = await getDeepScanLiveViewAction(id);
    setLiveViewLoading(false);

    if (!result.ok) {
      setLiveViewUrl(null);
      setError(messageFor(result.error));
      return;
    }
    setLiveViewUrl(result.liveViewUrl);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    // Dropping the capability is part of closing, not an afterthought.
    setLiveViewUrl(null);
  }, []);

  /** Re-enters an in-progress login: the capability is fetched afresh (§6). */
  const handleReopen = () => {
    if (!sessionId) return;
    setError(null);
    setDialogOpen(true);
    void loadLiveView(sessionId);
  };

  const handleStart = () => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const result = await startDeepScanAction(projectId);
      setBusy(false);
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      setSessionId(result.sessionId);
      setDialogOpen(true);
      void loadLiveView(result.sessionId);
    });
  };

  const handleCancel = useCallback(() => {
    if (!sessionId) {
      closeDialog();
      return;
    }
    setBusy(true);
    startTransition(async () => {
      // The server terminates the browser; the modal closes only afterwards.
      await cancelDeepScanAction(projectId, sessionId);
      setBusy(false);
      setSessionId(null);
      closeDialog();
      router.refresh();
    });
  }, [projectId, sessionId, closeDialog, router]);

  const handleAnalyze = () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await analyzeDeepScanAction(projectId, sessionId);
      setBusy(false);

      if (!result.ok) {
        // Keep the dialog open only while signing in could still fix it.
        const code = result.error;
        const recoverable = code === "authenticated_origin_not_reached" || code === "authentication_not_confirmed";
        setError(messageFor(code));
        if (!recoverable) {
          setSessionId(null);
          closeDialog();
          router.refresh();
        }
        return;
      }

      setSessionId(null);
      closeDialog();
      router.refresh();
    });
  };

  const disabled = busy || pending;

  return (
    <>
      <Section>
        {model.state === "completed" && model.lastResult ? (
          <>
            <Heading title="Deep Scan" status="Ready" />
            <ResultSummary result={model.lastResult} />
            <p className="text-xs text-zinc-500">
              Additional Deep Scans will use Vibe Credits.
            </p>
          </>
        ) : model.state === "credits_required" ? (
          <>
            <Heading title="Additional Deep Scan" />
            <p className="text-sm text-zinc-400">Additional Deep Scans will use Vibe Credits.</p>
            <Button type="button" disabled>
              Coming with Vibe Credits
            </Button>
          </>
        ) : model.state === "unavailable" ? (
          <>
            <Heading title="Deep Scan" status="Unavailable" />
            {model.unavailableReason === "provider_not_configured" ? (
              <p className="text-sm text-zinc-500">
                Deep Scan isn&apos;t available on this deployment yet. It needs a browser provider
                to be configured on the server.
              </p>
            ) : (
              <p className="text-sm text-zinc-500">
                Add your production website URL above to enable Deep Scan.
              </p>
            )}
          </>
        ) : model.state === "analyzing" ? (
          <>
            <Heading title="Deep Scan" status="Analyzing" />
            <p role="status" className="text-sm text-zinc-400">
              Analyzing your signed-in product…
            </p>
            <Button type="button" disabled>
              Analyzing…
            </Button>
          </>
        ) : model.state === "waiting_for_login" ? (
          <>
            <Heading title="Deep Scan" status="Waiting for sign-in" />
            <p className="text-sm text-zinc-400">
              A temporary browser is open. Sign in to continue.
            </p>
            <Button type="button" onClick={handleReopen} disabled={disabled}>
              Open temporary browser
            </Button>
          </>
        ) : model.state === "blocked" ? (
          <>
            <Heading title="Deep Scan" />
            <p className="text-sm text-amber-400">
              {messageFor(model.blockedReason ?? "analysis_failed")}
            </p>
          </>
        ) : model.state === "last_attempt_failed" ? (
          <>
            <Heading
              title="Deep Scan"
              status={
                model.lastFailure?.status === "cancelled"
                  ? "Cancelled"
                  : model.lastFailure?.status === "expired"
                    ? "Expired"
                    : "Didn't finish"
              }
            />
            <p className="text-sm text-zinc-400">
              {model.lastFailure?.failureCode
                ? messageFor(model.lastFailure.failureCode)
                : model.lastFailure?.status === "expired"
                  ? "This temporary Deep Scan session expired. You can start again."
                  : "The last Deep Scan didn't finish."}
            </p>
            {model.includedScanAvailable && (
              <p className="text-xs text-zinc-500">
                Your included Deep Scan for this project is still available.
              </p>
            )}
            {model.canStart ? (
              <Button type="button" onClick={handleStart} disabled={disabled}>
                {disabled ? "Starting…" : "Try Deep Scan again"}
              </Button>
            ) : (
              // Retrying is blocked by policy (usually the short cooldown after
              // an abandoned attempt). Saying nothing here reads as "retry is
              // broken", which is exactly how it was reported.
              <p className="text-sm text-zinc-500">
                {waitHint(model.retryAvailableAt) ??
                  (model.blockedReason ? messageFor(model.blockedReason) : "Deep Scan can't be started right now.")}
              </p>
            )}
          </>
        ) : model.state === "recommended" ? (
          <>
            <Heading title="Deep Scan recommended" />
            <div className="space-y-1 text-sm text-zinc-400">
              <p>
                Vibe can see your code and public website, but some of your product is behind a
                login.
              </p>
              <p>
                Run a Deep Scan so Vibe can understand what users actually experience after signing
                in.
              </p>
              {model.recommendationReason && (
                <p className="text-xs text-zinc-500">{model.recommendationReason}</p>
              )}
              <p className="text-zinc-300">Your first Deep Scan for this project is included.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={handleStart} disabled={disabled}>
                {disabled ? "Starting…" : "Run free Deep Scan"}
              </Button>
              <span className="text-sm text-zinc-500">Not now</span>
            </div>
          </>
        ) : (
          <>
            <Heading title="Deep Scan" />
            <p className="text-sm text-zinc-500">
              Optional deeper analysis of what users experience after signing in.
            </p>
            {model.canStart ? (
              <Button type="button" onClick={handleStart} disabled={disabled}>
                {disabled ? "Starting…" : "Run Deep Scan"}
              </Button>
            ) : (
              // Never a heading and a sentence with no action and no reason:
              // that state is indistinguishable from a broken page.
              <p className="text-sm text-zinc-500">
                {model.blockedReason
                  ? messageFor(model.blockedReason)
                  : "Deep Scan isn't available on this deployment yet."}
              </p>
            )}
          </>
        )}

        {error && !dialogOpen && (
          <p role="alert" className="text-sm text-amber-400">
            {error}
          </p>
        )}
      </Section>

      {dialogOpen && (
        <LiveViewDialog
          liveViewUrl={liveViewUrl}
          loading={liveViewLoading}
          error={error}
          busy={disabled}
          onCancel={handleCancel}
          onAnalyze={handleAnalyze}
        />
      )}
    </>
  );
}
