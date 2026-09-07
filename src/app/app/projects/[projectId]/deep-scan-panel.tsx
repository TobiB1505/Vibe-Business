"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LiveBrowserCanvas } from "./live-browser-canvas";
import { Button, TextAction, buttonClasses } from "@/components/ui/button";
import { formatCreditsForDisplay } from "@/modules/credits/units";
import { ProgressSteps } from "@/components/system/operation-progress";
import type { OperationProgressStep } from "@/modules/operations/view";
import type {
  DeepScanNextScan,
  DeepScanViewModel,
} from "@/modules/authenticated-product-intelligence/view";
import {
  analyzeDeepScanAction,
  cancelDeepScanAction,
  getDeepScanLiveViewAction,
  probeDeepScanSignInAction,
  startDeepScanAction,
} from "./deep-scan-actions";
import {
  CONSECUTIVE_SIGNED_IN_PROBES,
  shouldStartUnprompted,
} from "@/modules/authenticated-product-intelligence/login-detection";
import { Disclosure } from "@/components/ui/disclosure";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { useBrowserClock } from "@/lib/client/use-browser-clock";

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
  insufficient_credits: "You don't have enough Credits for another Deep Scan.",
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

/**
 * "in about 2 minutes" — coarse on purpose; a live countdown would be noise.
 *
 * `now` is a parameter rather than a `Date.now()` inside, because this renders
 * in a client component that is also server-rendered: reading the clock during
 * render reads two different clocks a second or so apart, and one minute
 * boundary between them is a hydration mismatch (PERF-021). `useBrowserClock`
 * supplies it, and answers null until there is a browser to ask.
 */
function waitHint(retryAvailableAt: string | null, now: number | null): string | null {
  if (!retryAvailableAt || now === null) return null;
  const remainingMs = Date.parse(retryAvailableAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const minutes = Math.ceil(remainingMs / 60_000);
  return minutes <= 1 ? "You can try again in about a minute." : `You can try again in about ${minutes} minutes.`;
}

/**
 * How far the temporary browser has got, as things that happened.
 *
 * Opening the dialog on the click rather than on the answer is most of what a
 * person asked for — a browser takes twenty seconds when Vibe's image is warm
 * and a couple of minutes when it has to be built, and staring at an unchanged
 * button for either is the same as nothing happening.
 *
 * What fills that wait is deliberately **not** a bar. `OperationProgress` in
 * this repository states the rule it is built on — *a tick is a fact, not an
 * animation that advances on a timer* — and the elapsed-seconds helper below
 * states the other half: the start runs inside one request, so no fraction of
 * it is knowable from here.
 *
 * Three things *are* knowable, because this component watches each of them
 * happen: the server action answered, the view socket opened, and the first
 * frame arrived. Those are the rows.
 */
export type BrowserStartupStage = "starting" | "connecting" | "painting" | "ready";

export function startupSteps(stage: BrowserStartupStage): OperationProgressStep[] {
  const reached = (at: BrowserStartupStage[]) => at.includes(stage);
  const state = (done: boolean, current: boolean): OperationProgressStep["state"] =>
    done ? "done" : current ? "current" : "pending";

  return [
    {
      label: "Starting a temporary browser",
      state: state(!reached(["starting"]), reached(["starting"])),
    },
    {
      label: "Connecting to it",
      state: state(reached(["painting", "ready"]), reached(["connecting"])),
    },
    {
      label: "Showing your product",
      state: state(reached(["ready"]), reached(["painting"])),
    },
  ];
}

function Section({ children }: { children: React.ReactNode }) {
  // `id` is the jump target for the audit section's "Run included Deep Scan".
  return (
    <section id="deep-scan" className="space-y-3 rounded-md border border-line-2 p-4">
      {children}
    </section>
  );
}

function Heading({ title, status }: { title: string; status?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {/* `h3`: the workspace section that wraps this panel owns the `h2`
          (UI-1), so this is a level below it. Two `h2`s with the same text
          inside one section made the outline claim two Deep Scans. */}
      <h3 className="text-fg-body text-sm font-medium">{title}</h3>
      {status && <span className="text-fg-muted text-xs">{status}</span>}
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
/** What the browser will stop on, for the modal's Tab wrap. */
const FOCUSABLE =
  'a[href], button, input, select, textarea, canvas, [tabindex]:not([tabindex="-1"])';

function LiveViewDialog({
  liveViewUrl,
  stage,
  error,
  busy,
  unreachable,
  frame,
  signIn,
  onCancel,
  onAnalyze,
  onConnected,
  onPainted,
  onRetryView,
  onUnavailable,
}: {
  liveViewUrl: string | null;
  stage: BrowserStartupStage;
  error: string | null;
  busy: boolean;
  /** Every attempt at the view socket failed. */
  unreachable: boolean;
  /** The size of the last frame drawn, once one has been. */
  frame: { w: number; h: number } | null;
  signIn: SignInWatch;
  onCancel: () => void;
  onAnalyze: () => void;
  onConnected: () => void;
  onPainted: (frame: { w: number; h: number }) => void;
  onRetryView: () => void;
  onUnavailable: () => void;
}) {
  const elapsedSeconds = useElapsedSeconds(busy);
  // A second clock, and it runs on a different question: how long the browser
  // has been opening, not how long the analysis has been running.
  const startupSeconds = useElapsedSeconds(stage !== "ready" && !unreachable);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /*
     * A real modal, unlike the four inline confirmations (UI-6 §3). This one
     * covers the page with an overlay and holds a live browser the user signs
     * into, so `aria-modal` is honest here — and the behaviour that goes with
     * it has to be too.
     *
     * Two halves were missing. Focus never came back: dismissing this dropped
     * a keyboard user at the top of the document, several sections above the
     * control they pressed. And focus was never held: Tab walked out of the
     * overlay into the page underneath, which is still visually covered, so
     * the ring vanished and the next Enter pressed something invisible.
     */
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    return () => {
      // Still connected, because the overlay is what unmounts, not the page.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ESC cancels for real rather than merely closing the overlay.
      if (event.key === "Escape" && !busy) {
        onCancel();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it has already escaped.
      // The canvas keeps its own keydown handler and swallows Tab so a login
      // form's fields can be moved between, so the wrap here is what catches
      // focus that left through anything else.
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
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
        className="flex max-h-[94vh] w-full max-w-6xl flex-col gap-3 overflow-y-auto rounded-lg border border-line-2 bg-app p-4 focus:outline-none"
      >
        <div className="space-y-1">
          <h3 id="deep-scan-dialog-title" className="text-sm font-medium text-fg">
            Sign in to your product
          </h3>
          <p id="deep-scan-dialog-description" className="text-xs text-fg-secondary">
            Sign in normally inside this temporary browser. Vibe does not store your password or a
            reusable login session.
          </p>
        </div>

        {/*
          The box is the shape of the frame that actually arrived.
          
          It used to be a hardcoded `aspect-[16/10]` matching
          `BROWSER_SANDBOX.viewport` — a constant in another module, restated
          here as a Tailwind class, with nothing keeping the two equal. Any
          disagreement stretches the picture, and stretching is the worst kind
          of wrong: a click computed from this element's own geometry still
          looks correct in code, so the only symptom is a person's tap landing
          somewhere else on their own signed-in product.
          
          The frame's own ratio cannot disagree with the frame. Before one
          arrives the viewport's ratio is the honest guess, and the overlay
          covering the box until then is what a person actually sees.
        */}
        <div
          style={{ aspectRatio: frame ? `${frame.w} / ${frame.h}` : "16 / 10" }}
          className="relative w-full overflow-hidden rounded-md border border-line-2 bg-surface-2"
        >
          {liveViewUrl && !error && (
            // Pixels, not a document. What used to sit here was an iframe
            // running the customer's own signed-in application inside this
            // page; this is a JPEG on a canvas, which executes nothing
            // (ADR 0076). The URL comes only from the authorized server action.
            //
            // Mounted as soon as there is a URL, and *underneath* the waiting
            // panel rather than after it: the socket cannot open until this
            // exists, so a panel that waits for the canvas before mounting it
            // would be waiting for itself.
            <LiveBrowserCanvas
              viewUrl={liveViewUrl}
              onConnected={onConnected}
              onPainted={onPainted}
              onUnavailable={onUnavailable}
            />
          )}
          {error && (
            <p role="alert" className="absolute inset-0 bg-surface-2 p-4 text-sm text-amber">
              {error}
            </p>
          )}
          {!error && unreachable && (
            /*
             * The state this dialog used to have no name for.
             *
             * The socket failed, every retry failed, and what a founder saw
             * was "Connecting to it" spinning until they cancelled — a browser
             * Vibe had created and was paying for, behind a message that said
             * it was still coming. A wait that cannot end is not a wait.
             *
             * The browser is still alive: the session outlives one socket, so
             * the honest offer is another attempt at the picture, not a new
             * browser the founder would pay for twice.
             */
            <div
              role="status"
              className="absolute inset-0 flex flex-col justify-center gap-4 bg-surface-2 p-5 sm:p-8"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-fg-body">
                  Vibe cannot reach the temporary browser
                </p>
                <p className="text-xs text-fg-muted">
                  The browser is running, but its picture is not getting through. This is
                  usually the connection between this device and it. Trying again costs
                  nothing — the browser is already open.
                </p>
              </div>
              <div>
                <Button type="button" onClick={onRetryView}>
                  Try again
                </Button>
              </div>
            </div>
          )}
          {!error && !unreachable && stage !== "ready" && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col justify-center gap-4 bg-surface-2 p-5 sm:p-8"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-fg-body">Opening a temporary browser</p>
                {/*
                  The honest expectation, and the reason for the slow case.
                  Vibe builds its browser image about once a week; a person who
                  is told that waits differently than one who is not.
                */}
                <p className="text-xs text-fg-muted">
                  Usually about twenty seconds. Occasionally a couple of minutes, when Vibe
                  has to build its browser first — that happens roughly once a week.
                </p>
              </div>
              <ProgressSteps steps={startupSteps(stage)} className="max-w-md" />
              <p className="font-mono text-meta text-fg-meta">{startupSeconds}s elapsed</p>
            </div>
          )}
        </div>

        {/*
          Was "Deep Scan works best on a desktop browser", which was true of a
          browser a phone could not type into at all — and read as a preference
          rather than a wall, so it invited somebody to spend Credits on a
          session they could not finish. A phone can drive this now; a larger
          screen is genuinely easier, and that is all this says.
        */}
        <p className="text-xs text-fg-muted">
          Tap or click to interact. A larger screen makes signing in easier.
        </p>

        {busy && (
          /*
           * What a founder is owed while this runs (UI-4 §6): what is
           * happening, roughly how long it takes, and that leaving would lose
           * it. No stage list and no percentage — the analysis reports nothing
           * until it is done, and inventing steps to fill the silence would be
           * the same lie as a progress bar that sits at 60%.
           */
          <div role="status" className="space-y-1 rounded-md border border-line-2 bg-surface-2 p-3">
            <p className="text-sm text-fg-prose">
              Vibe is looking around your signed-in product.
            </p>
            <p className="text-xs text-fg-muted">
              This usually takes up to about 90 seconds. Keep this window open — the scan runs
              while it is here, and closing it stops the browser Vibe is signed in to.
            </p>
            <p className="font-mono text-meta text-fg-meta">
              {elapsedSeconds}s elapsed
            </p>
          </div>
        )}

        {!busy && signIn.startsInSeconds !== null && (
          /*
           * The one moment this dialog speaks first. `role="status"` rather
           * than `alert`: it is not a problem, and interrupting a founder who
           * has just finished typing a password is the wrong way to say so.
           *
           * The countdown is shown because it is running either way — a scan
           * that begins with no warning is indistinguishable from a misclick,
           * and the founder who is not actually finished needs somewhere to
           * say so.
           */
          <div role="status" className="space-y-2 rounded-md border border-line-2 bg-surface-2 p-3">
            <p className="text-sm text-fg-prose">
              You look signed in. Vibe starts looking around in {signIn.startsInSeconds}s.
            </p>
            <TextAction type="button" onClick={signIn.postpone} className="text-sm">
              Not yet — I&apos;ll start it myself
            </TextAction>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={onAnalyze} disabled={busy || !liveViewUrl} busy={busy}>
            {busy
              ? "Looking around…"
              : signIn.signedIn
                ? "Analyze now"
                : "I'm logged in — Analyze"}
          </Button>
          <TextAction type="button" onClick={onCancel} disabled={busy} className="text-sm">
            Cancel
          </TextAction>
        </div>
      </div>
    </div>
  );
}

/**
 * Seconds since the analysis started (UI-4 §6).
 *
 * The only honest progress signal available here. Deep Scan runs inside the
 * request that starts it, and the analyzer reports nothing until it has
 * finished — so there is no stage to name and no fraction to fill. What can be
 * said truthfully is how long the founder has been waiting and how long that
 * is expected to take.
 */
function useElapsedSeconds(running: boolean): number {
  /*
   * Both ends of the measurement live in state and are written together, once
   * per second, from inside the interval. Keeping them as a pair is what makes
   * the elapsed figure a derivation rather than a counter to be reset — and
   * refs are not an option here, because reading one during render is exactly
   * the bug that would make this stop updating.
   */
  const [span, setSpan] = useState<{ startedAt: number; now: number } | null>(null);

  useEffect(() => {
    if (!running) return;

    const startedAt = Date.now();
    const timer = setInterval(() => setSpan({ startedAt, now: Date.now() }), 1_000);

    return () => clearInterval(timer);
  }, [running]);

  if (!running || !span) return 0;

  return Math.max(0, Math.floor((span.now - span.startedAt) / 1000));
}

/** How often the browser is asked whether the founder has finished signing in. */
const SIGN_IN_POLL_MS = 4_000;
/**
 * How long the founder has to stop an unprompted start.
 *
 * Long enough to read the sentence and press the button, short enough that it
 * is not a second thing to wait through. The scan is what they asked for; this
 * window exists for the reading that is wrong, not for the one that is right.
 */
const AUTO_START_GRACE_MS = 6_000;

export type SignInWatch = {
  /** The latest reading. `false` until the browser says otherwise. */
  signedIn: boolean;
  /** Seconds left before the scan starts by itself, or `null` if it will not. */
  startsInSeconds: number | null;
  /** Stops the unprompted start, for the rest of this session. */
  postpone: () => void;
};

/**
 * Watches the live browser for a finished login (founder request, 2026-09-07:
 * "er sollte erkennen wann der user eingeloggt ist und losscannen").
 *
 * Three properties this hook has to have, and each is a line below:
 *
 *  - It asks only while asking is useful — the dialog open, a frame painted,
 *    nothing else running. A poll against a browser that is still booting
 *    learns nothing and costs a round trip.
 *  - It stops asking the moment it has its answer. `shouldStartUnprompted`
 *    wants consecutive readings, so the run is kept here and cleared whenever
 *    a reading interrupts it.
 *  - It never starts anything silently. A positive run opens a grace window
 *    the founder can close, and closing it is permanent for this session —
 *    someone who says "not yet" once should not be asked again every four
 *    seconds.
 */
function useSignInWatch(options: {
  sessionId: string | null;
  active: boolean;
  onStart: () => void;
}): SignInWatch {
  const { sessionId, active, onStart } = options;

  const [signedIn, setSignedIn] = useState(false);
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [postponed, setPostponed] = useState(false);

  /*
   * The run of readings, tagged with the session it belongs to.
   *
   * Tagged rather than cleared: a new browser session must not inherit the
   * previous one's positives, and carrying the id means that is true by
   * construction instead of by remembering to reset something.
   */
  const readings = useRef<{ sessionId: string | null; values: boolean[] }>({
    sessionId: null,
    values: [],
  });

  // Adjusting state when a prop changes, the way React documents it: during
  // render, not from an effect that would render once with the wrong session's
  // answer before correcting itself.
  const [watchedSession, setWatchedSession] = useState(sessionId);
  if (sessionId !== watchedSession) {
    setWatchedSession(sessionId);
    setSignedIn(false);
    setStartsAt(null);
    setRemainingMs(null);
    setPostponed(false);
  }

  const watching = active && sessionId !== null && !postponed && startsAt === null;

  useEffect(() => {
    if (!watching || sessionId === null) return;

    let cancelled = false;

    const ask = async () => {
      const result = await probeDeepScanSignInAction(sessionId);
      if (cancelled) return;

      // A failed probe is a negative reading, not an error the founder has to
      // deal with: a browser that is briefly unreachable is the ordinary shape
      // of a login in progress, and the button is still there.
      const reading = result.ok && result.signedIn;
      setSignedIn(reading);

      const previous = readings.current.sessionId === sessionId ? readings.current.values : [];
      const values = [...previous, reading].slice(-CONSECUTIVE_SIGNED_IN_PROBES);
      readings.current = { sessionId, values };

      if (shouldStartUnprompted(values)) {
        setStartsAt(Date.now() + AUTO_START_GRACE_MS);
        setRemainingMs(AUTO_START_GRACE_MS);
      }
    };

    void ask();
    const timer = setInterval(() => void ask(), SIGN_IN_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watching, sessionId]);

  useEffect(() => {
    if (startsAt === null) return;

    const timer = setInterval(() => {
      const left = startsAt - Date.now();
      if (left > 0) {
        setRemainingMs(left);
        return;
      }
      clearInterval(timer);
      setRemainingMs(null);
      setStartsAt(null);
      onStart();
    }, 250);

    return () => clearInterval(timer);
  }, [startsAt, onStart]);

  const postpone = useCallback(() => {
    readings.current = { sessionId: null, values: [] };
    setStartsAt(null);
    setRemainingMs(null);
    setPostponed(true);
  }, []);

  return {
    signedIn,
    startsInSeconds: remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 1000)),
    postpone,
  };
}

/**
 * The offer to run a scan, rendered from the one derived answer.
 *
 * Every terms decision — free, priced, short, not for sale, blocked — was made
 * in `buildDeepScanViewModel`. This maps each to a control or to a sentence,
 * and it never renders a heading with neither: a state with no action and no
 * reason is indistinguishable from a broken page, which is exactly how the
 * missing re-run was reported.
 */
function NextScan({
  next,
  rerun,
  onStart,
  disabled,
  now,
}: {
  next: DeepScanNextScan;
  /** True when a finished result is already on screen, which changes the verb. */
  rerun?: boolean;
  onStart: () => void;
  disabled: boolean;
  now: number | null;
}) {
  switch (next.kind) {
    case "included":
      return (
        <Button type="button" onClick={onStart} disabled={disabled} busy={disabled}>
          {disabled ? "Starting…" : rerun ? "Run included Deep Scan" : "Run free Deep Scan"}
        </Button>
      );

    case "priced":
      return (
        <div className="space-y-2">
          {/*
            Said before the click, not after it. A Deep Scan that fails, is
            cancelled, or expires costs nothing — the hold is released — and a
            customer deciding whether to spend deserves to know that while they
            are deciding.
          */}
          <p className="text-xs text-fg-muted">
            You&apos;re only charged if Vibe comes back with a result.
          </p>
          <Button type="button" onClick={onStart} disabled={disabled} busy={disabled}>
            {disabled
              ? "Starting…"
              : `${rerun ? "Scan again" : "Run Deep Scan"} · ${formatCreditsForDisplay(next.price)} Credits`}
          </Button>
        </div>
      );

    case "insufficient_credits":
      return (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">
            Another Deep Scan costs {formatCreditsForDisplay(next.price)} Credits, and your
            balance doesn&apos;t cover it yet.
          </p>
          <Link href="/app/billing" className={buttonClasses({ variant: "secondary" })}>
            Top up Credits
          </Link>
        </div>
      );

    case "not_for_sale":
      // No policy prices another scan. The honest terminal answer, and not a
      // route into a checkout that cannot help.
      return (
        <p className="text-xs text-fg-muted">
          Additional Deep Scans aren&apos;t available right now.
        </p>
      );

    case "blocked":
      return (
        <p className="text-xs text-fg-muted">
          {waitHint(next.retryAvailableAt, now) ?? messageFor(next.reason)}
        </p>
      );

    case "unavailable":
      return (
        <p className="text-xs text-fg-muted">
          {next.reason === "provider_not_configured"
            ? "Deep Scan is not switched on here yet. That is a gap on Vibe's side — it says nothing about your product."
            : "Add your production website URL above to run another Deep Scan."}
        </p>
      );
  }
}

function ResultSummary({ result }: { result: NonNullable<DeepScanViewModel["lastResult"]> }) {
  return (
    <div className="space-y-3">
      <dl className="space-y-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-fg-muted">Last checked</dt>
          <dd className="text-fg-prose">
            {formatTimestamp(result.analyzedAt) ?? result.analyzedAt}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-fg-muted">Pages Vibe looked at</dt>
          <dd className="text-fg-prose">{result.pagesInspected}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-fg-muted">Check finished</dt>
          <dd className={result.completeness === "complete" ? "text-mint" : "text-amber"}>
            {result.completeness === "complete" ? "Fully" : "Only partly"}
          </dd>
        </div>
      </dl>

      {result.surfaces.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            Pages Vibe found after signing in
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {result.surfaces.map((surface) => (
              <li
                key={surface.id}
                className="rounded border border-line-2 px-2 py-0.5 text-xs text-fg-prose"
              >
                {surface.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Behind a disclosure, not in the summary. A warning is a caveat on a
        result the founder came here to read, and putting four of them above
        the result would make the caveats the finding. Nothing is hidden — the
        count is in the label, so the disclosure says how much is behind it
        before it is opened.
      */}
      {result.warnings.length > 0 && (
        <Disclosure
          label={
            result.warnings.length === 1
              ? "1 thing Vibe could not check"
              : `${result.warnings.length} things Vibe could not check`
          }
        >
          <ul className="flex flex-col gap-2">
            {result.warnings.map((warning) => (
              <li key={warning} className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">
                {warning}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {result.accessMode === "included_first_scan" && (
        <p className="text-xs text-fg-muted">Included Deep Scan used.</p>
      )}
    </div>
  );
}

export function DeepScanPanel({ projectId, model }: { projectId: string; model: DeepScanViewModel }) {
  // Coarse by design — the hint says "about two minutes", so it need not tick.
  const browserNow = useBrowserClock();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [sessionId, setSessionId] = useState<string | null>(model.activeSession?.id ?? null);
  // Never auto-opened on mount: a page reload must not slam a modal open, and
  // the capability is only requested when the user asks to see the browser.
  const [dialogOpen, setDialogOpen] = useState(false);
  // Held in memory only, for the lifetime of the open dialog (§6).
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  /** How far the temporary browser has got. See `startupSteps`. */
  const [stage, setStage] = useState<BrowserStartupStage>("starting");
  const [error, setError] = useState<string | null>(null);
  /** Every attempt at the view socket failed. Not a stage — a failure. */
  const [unreachable, setUnreachable] = useState(false);
  /** The shape of the picture, so the box can be the shape of the picture. */
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLiveView = useCallback(async (id: string) => {
    setError(null);
    setUnreachable(false);
    const result = await getDeepScanLiveViewAction(id);

    if (!result.ok) {
      setLiveViewUrl(null);
      setError(messageFor(result.error));
      return;
    }
    setLiveViewUrl(result.liveViewUrl);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setUnreachable(false);
    setFrame(null);
    // Dropping the capability is part of closing, not an afterthought.
    setLiveViewUrl(null);
    setStage("starting");
  }, []);

  /** Re-enters an in-progress login: the capability is fetched afresh (§6). */
  const handleReopen = () => {
    if (!sessionId) return;
    setError(null);
    // The browser already exists, so the first row is a fact before the dialog
    // is even on screen.
    setStage("connecting");
    setDialogOpen(true);
    void loadLiveView(sessionId);
  };

  const handleStart = () => {
    setError(null);
    setBusy(true);
    // Opened on the click, not on the answer. Starting a browser takes twenty
    // seconds warm and a couple of minutes cold, and an unchanged button for
    // either is indistinguishable from nothing having happened.
    setStage("starting");
    setDialogOpen(true);
    startTransition(async () => {
      const result = await startDeepScanAction(projectId);
      setBusy(false);
      if (!result.ok) {
        // The dialog closes rather than holding a failure: the panel below is
        // where a refusal belongs, next to the control that caused it.
        closeDialog();
        setError(messageFor(result.error));
        return;
      }
      setSessionId(result.sessionId);
      setStage("connecting");
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

  const handleAnalyze = useCallback(() => {
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
  }, [projectId, sessionId, closeDialog, router]);

  /*
   * Vibe watches for the finished login instead of waiting to be told about
   * it. Only while a frame is actually on screen: before that the browser is
   * still opening, and a probe would be a round trip that cannot learn
   * anything.
   */
  const signIn = useSignInWatch({
    sessionId,
    active: dialogOpen && stage === "ready" && !busy && !pending,
    onStart: handleAnalyze,
  });

  /*
   * Two facts, reported by the only component that can see them. Neither
   * advances on a timer: the socket opened, and a frame arrived.
   */
  const handleConnected = useCallback(() => {
    setStage((current) => (current === "ready" ? current : "painting"));
  }, []);

  const handleUnavailable = useCallback(() => setUnreachable(true), []);

  /*
   * Another attempt at the picture, not another browser.
   *
   * The session is still live and still paid for, so this re-fetches the view
   * capability and remounts the canvas. Re-fetching is what makes it a real
   * retry rather than a re-render: the URL carries a token, and a token that
   * has expired is one of the reasons the socket may have refused.
   */
  const handleRetryView = useCallback(() => {
    if (!sessionId) return;
    setStage("connecting");
    void loadLiveView(sessionId);
  }, [sessionId, loadLiveView]);
  const handlePainted = useCallback((painted: { w: number; h: number }) => {
    setStage("ready");
    // Written only when it changes, because this is on the paint path: a new
    // object every frame would re-render the dialog sixty times a second to
    // say the same two numbers.
    setFrame((current) =>
      current && current.w === painted.w && current.h === painted.h ? current : painted,
    );
  }, []);

  const disabled = busy || pending;

  return (
    <>
      <Section>
        {model.state === "completed" && model.lastResult ? (
          <>
            <Heading title="Look inside your signed-in product" status="Ready" />
            <ResultSummary result={model.lastResult} />
            {/*
              A finished result is not the end of the section. A product changes
              after it is scanned, and this branch used to render a summary and
              nothing else — no button, no price, no reason — because `state`
              ranks `completed` above every purchasable state. One successful
              scan turned the panel into a read-only card permanently. The offer
              is a separate question and is answered by `model.nextScan`.
            */}
            <NextScan next={model.nextScan} rerun onStart={handleStart} disabled={disabled} now={browserNow} />
          </>
        ) : model.state === "additional_available" && model.additionalScanPrice !== null ? (
          <>
            <Heading title="Additional Deep Scan" />
            <p className="text-sm text-fg-secondary">
              Your included Deep Scan for this project has been used. Another one costs{" "}
              {formatCreditsForDisplay(model.additionalScanPrice)} Credits.
            </p>
            {/*
              Said before the click, not after it. A Deep Scan that fails,
              is cancelled, or expires costs nothing — the hold is released —
              and a customer deciding whether to spend deserves to know that
              while they are deciding.
            */}
            <p className="text-xs text-fg-muted">
              You&apos;re only charged if Vibe comes back with a result.
            </p>
            <Button type="button" onClick={handleStart} disabled={disabled} busy={disabled}>
              {disabled
                ? "Starting…"
                : `Run Deep Scan · ${formatCreditsForDisplay(model.additionalScanPrice)} Credits`}
            </Button>
          </>
        ) : model.state === "insufficient_credits" && model.additionalScanPrice !== null ? (
          <>
            <Heading title="Additional Deep Scan" />
            <p className="text-sm text-fg-secondary">
              Another Deep Scan costs {formatCreditsForDisplay(model.additionalScanPrice)}{" "}
              Credits, and your balance doesn&apos;t cover it yet.
            </p>
            <Link href="/app/billing" className={buttonClasses({ variant: "secondary" })}>
              Top up Credits
            </Link>
          </>
        ) : model.state === "credits_required" ? (
          <>
            <Heading title="Additional Deep Scan" />
            {/*
              Reachable only when no policy prices an additional scan. It is
              the honest terminal answer, not a route into a checkout that
              cannot help — the same reason this state has always existed.
            */}
            <p className="text-sm text-fg-secondary">
              Your included Deep Scan for this project has been used. Additional Deep Scans
              aren&apos;t available right now.
            </p>
          </>
        ) : model.state === "unavailable" ? (
          <>
            <Heading title="Deep Scan" status="Unavailable" />
            {model.unavailableReason === "provider_not_configured" ? (
              <p className="text-sm text-fg-muted">
                Deep Scan is not switched on here yet. That is a gap on Vibe&apos;s side — it says
                nothing about your product, and nothing else about your project is affected.
              </p>
            ) : (
              <p className="text-sm text-fg-muted">
                Add your production website URL above to enable Deep Scan.
              </p>
            )}
          </>
        ) : model.state === "analyzing" ? (
          <>
            <Heading title="Look inside your signed-in product" status="Vibe is looking around" />
            <p role="status" className="text-sm text-fg-secondary">
              Analyzing your signed-in product…
            </p>
            <Button type="button" disabled>
              Analyzing…
            </Button>
          </>
        ) : model.state === "waiting_for_login" ? (
          <>
            <Heading title="Look inside your signed-in product" status="Waiting for you to sign in" />
            <p className="text-sm text-fg-secondary">
              A temporary browser is open. Sign in to continue.
            </p>
            <Button type="button" onClick={handleReopen} disabled={disabled}>
              Open temporary browser
            </Button>
          </>
        ) : model.state === "blocked" ? (
          <>
            <Heading title="Deep Scan" />
            <p className="text-sm text-amber">
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
            <p className="text-sm text-fg-secondary">
              {model.lastFailure?.failureCode
                ? messageFor(model.lastFailure.failureCode)
                : model.lastFailure?.status === "expired"
                  ? "This temporary Deep Scan session expired. You can start again."
                  : "The last Deep Scan didn't finish."}
            </p>
            {model.includedScanAvailable && (
              <p className="text-xs text-fg-muted">
                Your included Deep Scan for this project is still available.
              </p>
            )}
            {model.canStart ? (
              <Button type="button" onClick={handleStart} disabled={disabled} busy={disabled}>
                {disabled ? "Starting…" : "Try Deep Scan again"}
              </Button>
            ) : (
              // Retrying is blocked by policy (usually the short cooldown after
              // an abandoned attempt). Saying nothing here reads as "retry is
              // broken", which is exactly how it was reported.
              <p className="text-sm text-fg-muted">
                {waitHint(model.retryAvailableAt, browserNow) ??
                  (model.blockedReason ? messageFor(model.blockedReason) : "Deep Scan can't be started right now.")}
              </p>
            )}
          </>
        ) : model.state === "recommended" ? (
          <>
            <Heading title="Look inside your signed-in product" />
            <div className="space-y-1 text-sm text-fg-secondary">
              <p>
                Vibe can see your code and public website, but some of your product is behind a
                login.
              </p>
              <p>
                Run a Deep Scan so Vibe can understand what users actually experience after signing
                in.
              </p>
              {model.recommendationReason && (
                <p className="text-xs text-fg-muted">{model.recommendationReason}</p>
              )}
              <p className="text-fg-prose">Your first Deep Scan for this project is included.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={handleStart} disabled={disabled} busy={disabled}>
                {disabled ? "Starting…" : "Run free Deep Scan"}
              </Button>
              <span className="text-sm text-fg-muted">Not now</span>
            </div>
          </>
        ) : (
          <>
            <Heading title="Deep Scan" />
            <p className="text-sm text-fg-muted">
              Optional deeper analysis of what users experience after signing in.
            </p>
            {model.canStart ? (
              <Button type="button" onClick={handleStart} disabled={disabled} busy={disabled}>
                {disabled ? "Starting…" : "Run Deep Scan"}
              </Button>
            ) : (
              // Never a heading and a sentence with no action and no reason:
              // that state is indistinguishable from a broken page.
              <p className="text-sm text-fg-muted">
                {model.blockedReason
                  ? messageFor(model.blockedReason)
                  : "Deep Scan isn't available on this deployment yet."}
              </p>
            )}
          </>
        )}

        {error && !dialogOpen && (
          <p role="alert" className="text-sm text-amber">
            {error}
          </p>
        )}
      </Section>

      {dialogOpen && (
        <LiveViewDialog
          liveViewUrl={liveViewUrl}
          stage={stage}
          error={error}
          busy={disabled}
          unreachable={unreachable}
          frame={frame}
          signIn={signIn}
          onCancel={handleCancel}
          onAnalyze={handleAnalyze}
          onConnected={handleConnected}
          onPainted={handlePainted}
          onRetryView={handleRetryView}
          onUnavailable={handleUnavailable}
        />
      )}
    </>
  );
}
