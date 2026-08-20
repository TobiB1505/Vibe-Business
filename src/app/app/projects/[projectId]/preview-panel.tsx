"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { shouldRefreshForState } from "@/modules/operations/view";
import { PREVIEW_STAGE_LABELS, type PreviewCard } from "@/modules/change-preview/view";
import type { PreviewStage } from "@/modules/change-preview/schema";
import { validateChangeAction } from "./validate-change-action";
import {
  getPreviewStatusAction,
  startPreviewAction,
  stopPreviewAction,
  type StartPreviewActionState,
  type StopPreviewActionState,
} from "./preview-actions";
import { formatTime } from "@/lib/utils/format-datetime";

/**
 * Temporary preview, as the user sees it (Sprint 10B-3 §2, §4, §8, §10, §17).
 *
 * ## The vocabulary is the product guarantee
 *
 * A running preview means one thing: the exact validated artifact started and
 * answered inside an isolated environment. It is never rendered as *approved*,
 * *reviewed*, *merged* or *deployed*, and the panel keeps saying so at the
 * moment a user is most likely to assume otherwise — when they are looking at
 * their own application working.
 *
 * ```
 * sandbox_validation_passed → preview_available → human review → merge → deploy
 *                                    ↑ we are here
 * ```
 *
 * ## The preview URL is untrusted, and stays outside Vibe
 *
 * `Open preview` is a plain link with `target="_blank"`. Deliberately:
 *
 *  - **no iframe.** Embedding untrusted customer code inside Vibe's origin is
 *    the whole class of problem this codebase exists not to have.
 *  - **no proxy.** Serving it through Vibe would make Vibe's runtime fetch
 *    arbitrary responses from an application it did not write.
 *  - **no screenshot, no DOM import, no HTML fetch.** Nothing from the preview
 *    is ever rendered anywhere inside Vibe (§17).
 *
 * `rel="noreferrer"` matters here beyond habit: without it the preview would
 * receive Vibe's project URL — which contains the project id — in a `Referer`
 * header, handing an internal identifier to code we did not write.
 *
 * ## State is given, never inferred
 *
 * The card comes from the server. The one thing this component computes is the
 * countdown, and it is presentation only — the server refuses to return an
 * origin past the deadline whatever the browser believes (§13).
 */

const POLL_INTERVAL_MS = 2000;

type Live = {
  /** The server's own status for this session, ahead of the next server render. */
  status: string;
  origin: string | null;
  expiresAt: string;
  verdict: string | null;
};

function remaining(expiresAt: string, now: number): string | null {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return null;

  const seconds = Math.floor((deadline - now) / 1000);
  if (seconds <= 0) return null;

  const minutes = Math.floor(seconds / 60);
  return minutes >= 1 ? `${minutes} min left` : `${seconds}s left`;
}

function localTime(iso: string): string {
  // Clock only: the surrounding copy already establishes the day. Deterministic
  // across server and client — see format-datetime.ts.
  return formatTime(iso) ?? iso;
}

/**
 * The public-exposure confirmation (§4).
 *
 * Every sentence is load-bearing and none of them is reassurance. It says what
 * will exist (a public, unlisted URL), who can reach it (anyone with the link),
 * what will not be there (production secrets and data), how long it lasts, and
 * what is not being changed.
 *
 * It deliberately never says *private*, *secure link* or *authenticated
 * preview*. There is no access control on the origin, and describing one that
 * does not exist would be the single most dangerous sentence in this product.
 */
function ConfirmDialog({
  onCancel,
  onConfirm,
  pending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-confirm-title"
      className="space-y-3 rounded-md border border-amber-line/60 bg-amber-tint-soft p-4"
    >
      <h5 id="preview-confirm-title" className="text-sm font-medium text-fg">
        Start temporary preview?
      </h5>

      <div className="space-y-2 text-sm text-fg-prose">
        <p>
          Vibe will start the validated application in an isolated environment and make it
          temporarily available through a public, unlisted URL.
        </p>
        <p className="text-amber">
          Anyone who has the URL may be able to open it until the preview expires.
        </p>
        <p>Vibe will not add production secrets or production data.</p>
        <p>The preview expires automatically after 15 minutes.</p>
        <p>Your production site and default branch will not be changed.</p>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {/* The amber stays where it carries meaning — the panel's tint and the
            sentence about the unlisted URL — rather than on the button. Amber
            reports a state; a button reports what happens when you press it. */}
        <Button type="button" variant="primary" size="sm" onClick={onConfirm} disabled={pending}>
          Start temporary preview
        </Button>
      </div>
    </div>
  );
}

/**
 * Repeated wherever a preview looks like success. That is exactly when it is
 * needed — and only while it is true (UI-5 §4).
 */
function NotApproved({ approved, merged }: { approved: boolean; merged: boolean }) {
  return (
    <p className="text-xs text-fg-muted">
      {merged ? "Merged · Deployment not verified by Vibe" : "Not merged · Not deployed"}
      {approved ? "" : " · Not reviewed by a human"}
    </p>
  );
}

export function PreviewPanel({
  projectId,
  preparedChangeId,
  card,
  /** The passing validation whose artifact would be previewed, if there is one. */
  validatedArtifactId,
  /** The origin this render already resolved, before the first poll returns. */
  serverOrigin,
  approved,
  merged,
}: {
  projectId: string;
  preparedChangeId: string;
  card: PreviewCard;
  validatedArtifactId: string | null;
  serverOrigin: string | null;
  /** A human approved this exact commit, and that still stands (UI-5 §4). */
  approved: boolean;
  /** The default branch carries this change, verified by reading it back. */
  merged: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  /**
   * The last action's answer, start or stop.
   *
   * One slot for both, because the panel shows one action's outcome at a time
   * and a stop that was refused deserves a message exactly as much as a start
   * that was.
   */
  const [state, setState] = useState<StartPreviewActionState | StopPreviewActionState>(null);
  const [, startTransition] = useTransition();
  /**
   * Which action is in flight, if any.
   *
   * `useTransition`'s `pending` cannot answer this: one transition serves start,
   * stop and re-validate, so keying the "Starting…" block off it meant clicking
   * **Stop** rendered "Starting temporary preview… / Preview ready". Both lines
   * were technically produced by the code and neither was true.
   */
  const [intent, setIntent] = useState<"start" | "stop" | "validate" | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [stage, setStage] = useState<PreviewStage | null>(card.stage);
  const [now, setNow] = useState(() => Date.now());

  const startedSessionId = state?.ok
    ? "previewSessionId" in state
      ? state.previewSessionId
      : null
    : null;
  const sessionId = startedSessionId ?? card.previewSessionId;

  /**
   * The session's state, preferring what the poll just learned.
   *
   * The card is a server render, and between the poll seeing `running` and
   * `router.refresh()` landing there is a window where the panel knows the
   * preview is ready and renders "Starting…" anyway. The first real preview
   * spent that window showing a user a working preview they could not open.
   *
   * So the poll's answer wins while it is fresher. It is the same server
   * authority either way — this read went through `getPreviewStatus`, which
   * checks ownership and expiry — just newer than the last render.
   */
  const previewState =
    live?.status === "running" && card.state === "starting" ? "running" : card.state;

  // `starting` and `running` are the two states with something to poll for.
  // Anything else is settled, and polling it would be a request every two
  // seconds forever for an answer that is not coming.
  const shouldPoll =
    previewState === "starting" ||
    previewState === "running" ||
    previewState === "stopping" ||
    intent === "start";

  useOperationPoll<{
    status: string;
    stage: PreviewStage;
    origin: string | null;
    expiresAt: string;
    verdict: "preview_available" | null;
  }>({
    key: sessionId,
    enabled: shouldPoll,
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      if (!sessionId) return { kind: "unavailable" };

      const result = await getPreviewStatusAction(projectId, sessionId);
      if (!result.ok) return { kind: "unavailable" };

      return {
        kind: "value",
        value: {
          status: result.status,
          stage: result.stage as PreviewStage,
          origin: result.origin,
          expiresAt: result.expiresAt,
          verdict: result.verdict,
        },
      };
    },
    onReading: (next) => {
      setLive({
        status: next.status,
        origin: next.origin,
        expiresAt: next.expiresAt,
        verdict: next.verdict,
      });
      setStage(next.stage);

      /**
       * Refresh only when the server render is genuinely behind (§7).
       *
       * Refreshing on every tick looked harmless and was not. This page render
       * costs a provider call and several reads, so a refresh can outlast the
       * two seconds until the next one — and the next `router.refresh()`
       * supersedes the one still in flight. At two-second intervals for a
       * fifteen-minute preview, that is ~450 re-renders of which one may never
       * land.
       *
       * The preview panel hid this from itself: `previewState` prefers the
       * poll, so it rendered a running preview correctly while the page around
       * it kept the state from *before* the preview existed. The Review
       * section, reading that same stale render, said "Preview required"
       * beside a running preview.
       *
       * So compare against what the card already shows and refresh on the
       * transition only. Once the card agrees, there is nothing to fetch until
       * the status changes again.
       */
      if (shouldRefreshForState(next.status, card.state)) router.refresh();
    },
  });

  // Drives the countdown only. The server is what refuses an expired origin.
  useEffect(() => {
    if (previewState !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [previewState]);

  function confirmStart() {
    if (!validatedArtifactId) return;

    setIntent("start");
    startTransition(async () => {
      setConfirming(false);
      // The confirmation travels to the server as an explicit argument. The
      // dialog closing is not what authorizes this; the boolean is (§5).
      setState(await startPreviewAction(projectId, validatedArtifactId, true));
      router.refresh();
      setIntent(null);
    });
  }

  /**
   * Starts a fresh validation, because the artifact this preview needed is gone.
   *
   * Called only from an explicit click, never on render, never on poll, never
   * as a "helpful" recovery from a failed preview. A new ValidationRun
   * provisions a paid sandbox, and spending on a user's behalf is exactly what
   * CLAUDE.md rule 60 forbids (§15, §22).
   */
  function validateAgain() {
    setIntent("validate");
    startTransition(async () => {
      await validateChangeAction(projectId, preparedChangeId);
      router.refresh();
      setIntent(null);
    });
  }

  function stop() {
    if (!sessionId) return;

    setIntent("stop");
    startTransition(async () => {
      // The result was previously discarded, so a refused stop produced no
      // message, no state change and no clue — the button simply went back to
      // "Stop preview" as though nothing had been asked.
      setState(await stopPreviewAction(projectId, sessionId));
      // Never a faked "stopped" before the backend confirms: the sandbox and
      // the snapshot are the backend's to account for (§12).
      router.refresh();
      setIntent(null);
    });
  }

  const expiresAt = live?.expiresAt ?? card.expiresAt;
  const countdown = expiresAt ? remaining(expiresAt, now) : null;
  const starting = previewState === "starting" || intent === "start";
  /**
   * A stop the user has asked for, before the server render agrees.
   *
   * Symmetrical with `starting`, and it was missing: a click on **Stop
   * preview** left the whole running block on screen — origin, countdown,
   * "Anyone with the preview URL…" — with only the button's label changed. The
   * first real stop looked to the user like nothing had happened at all.
   *
   * This claims an *intent*, never an outcome. The section below still says
   * "Stopping…", because the sandbox, the snapshot and the ledger belong to the
   * workflow and only it can report them finished (§12).
   */
  const stopping = previewState === "stopping" || intent === "stop";

  return (
    <section className="space-y-3 border-t border-line-2 pt-4">
      <h4 className="text-sm font-medium text-fg-body">Preview</h4>

      {starting ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">Starting temporary preview…</p>
          <p className="text-sm text-fg-secondary">
            {PREVIEW_STAGE_LABELS[stage ?? "preflight"]}
          </p>
          {/* The Sprint 7 promise, restated where it matters. */}
          <p className="text-xs text-fg-muted">
            You can leave this page. Vibe will continue starting the preview.
          </p>
        </div>
      ) : stopping ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">Stopping preview…</p>
          {/* The workflow owns the sandbox, the snapshot and the ledger from
              here. Saying "stopped" before it confirms would be the one claim
              this panel is in no position to make (§12). */}
          <p className="text-xs text-fg-muted">
            Vibe is stopping the environment and releasing the saved build.
          </p>
        </div>
      ) : previewState === "running" ? (
        <div className="space-y-3">
          <p className="text-sm text-mint">Temporary public preview</p>

          <div className="flex flex-wrap gap-2">
            {/* The poll's answer first, the server render's second. Both come
                from `getPreviewStatus`; the poll is simply newer. Preferring
                only the poll meant a freshly loaded page said "Resolving
                preview address…" for an origin it had already resolved. */}
            {(live?.origin ?? serverOrigin) ? (
              <a
                href={live?.origin ?? serverOrigin ?? ""}
                target="_blank"
                // Not only convention: without `noreferrer` the preview would
                // receive Vibe's project URL — and the project id in it — in a
                // Referer header, handing an internal identifier to code Vibe
                // did not write.
                rel="noreferrer noopener"
                className="rounded-md border border-mint-line bg-mint-tint-soft px-3 py-1.5 text-sm text-mint hover:bg-mint-tint"
              >
                Open preview
              </a>
            ) : (
              <span className="rounded-md border border-line-2 px-3 py-1.5 text-sm text-fg-muted">
                Resolving preview address…
              </span>
            )}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={stop}
              disabled={intent !== null}
            >
              {/* No "Stopping…" label here any more: a stop in flight renders
                  the stopping section instead of this block, so this branch is
                  only ever reached while the preview is genuinely running. */}
              Stop preview
            </Button>
          </div>

          {expiresAt && (
            <p className="text-xs text-fg-muted">
              Expires at {localTime(expiresAt)}
              {countdown ? ` · ${countdown}` : ""}
            </p>
          )}

          <p className="text-xs text-amber/80">
            Anyone with the preview URL may be able to access it until it expires.
          </p>
          <NotApproved approved={approved} merged={merged} />
        </div>
      ) : previewState === "needs_validation" || previewState === "not_available" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Validation required</p>
          <p className="text-xs text-fg-muted">
            This change must pass isolated validation before Vibe can create a temporary preview.
          </p>
        </div>
      ) : previewState === "artifact_unavailable" || previewState === "artifact_expired" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">
            {previewState === "artifact_expired"
              ? "Saved build expired"
              : "Saved build unavailable"}
          </p>
          {/* Deliberately not phrased as a free refresh. A new validation
              provisions a paid sandbox, and the user starts it or nobody
              does (§15, CLAUDE.md rule 60). */}
          <p className="text-xs text-fg-muted">
            The build Vibe saved from the last safety check is no longer kept. Run the checks
            again to make a new one.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={validateAgain}>
            Validate again
          </Button>
        </div>
      ) : previewState === "failed" ? (
        <div className="space-y-2">
          <p className="text-sm text-coral">Preview failed</p>
          {/* Safe copy from a stable code. Never a provider message, never a
              sandbox stack trace (§14). */}
          {card.failureMessage && <p className="text-sm text-fg-secondary">{card.failureMessage}</p>}
          {card.revalidationRequired && (
            <>
              <p className="text-xs text-fg-muted">
                The saved build was released when the preview ended. Run the checks again to
                make a new one.
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={validateAgain}>
                Validate again
              </Button>
            </>
          )}
        </div>
      ) : previewState === "stopped" || previewState === "expired" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">
            {previewState === "expired" ? "Preview expired" : "Preview stopped"}
          </p>
          <p className="text-xs text-fg-muted">
            {previewState === "expired"
              ? "The temporary preview has ended."
              : "The temporary preview was stopped and its environment was released."}
          </p>
          {card.revalidationRequired && (
            <>
              <p className="text-xs text-fg-muted">
                The saved build was released when the preview ended. Run the checks again to
                make a new one.
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={validateAgain}>
                Validate again
              </Button>
            </>
          )}
        </div>
      ) : confirming ? (
        <ConfirmDialog
          onCancel={() => setConfirming(false)}
          onConfirm={confirmStart}
          // Any action in flight disables the dialog. A start specifically
          // cannot be one of them — that renders the starting block instead,
          // which is exactly what the type narrowing here proves.
          pending={intent !== null}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Not started</p>
          <p className="text-xs text-fg-muted">
            Vibe will run the exact validated build in an isolated environment for 15 minutes, on a
            public, unlisted URL. Your repository and production site are not changed.
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={intent !== null || !validatedArtifactId}
          >
            Start temporary preview
          </Button>
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-coral">{state.message}</p>}

      {state?.ok && state.kind === "reused" && (
        <p className="text-xs text-fg-muted">
          A preview of this exact build is already running — nothing new was started.
        </p>
      )}
    </section>
  );
}
