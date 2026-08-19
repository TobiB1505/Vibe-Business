"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { shouldRefreshForState } from "@/modules/operations/view";
import type { ReviewCard } from "@/modules/review/view";
import type { ReviewImages } from "@/modules/review/service";
import {
  getReviewStatusAction,
  startReviewAction,
  type StartReviewActionState,
} from "./review-actions";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * Before/after review, as the user sees it (Sprint 11A §24, §25, §29, §30).
 *
 * ## What this section is for
 *
 * One question: *what did Vibe actually change?* Everything here serves
 * answering it quickly, and nothing here answers it *for* the user.
 *
 * There is **no approval control**, no merge, no deploy, no score, no "improved"
 * and no AI judgement (§30). A comparison is evidence for a decision, and the
 * decision is the person's.
 *
 * ## Screenshots, never the pages themselves
 *
 * Both sides are `<img>` elements pointing at short-lived signed URLs for PNGs
 * Vibe captured in an isolated browser. Deliberately **not** iframes: embedding
 * a customer's live site and a sandbox serving code Vibe did not write, inside
 * Vibe's own origin, is the class of problem this codebase exists not to have
 * (§8).
 *
 * ## The image URLs are server-rendered, and short-lived
 *
 * Both `src` values are signed URLs minted on the server *after* it confirmed
 * the caller owns the project. They are never persisted and never requested by
 * the client — the page is re-rendered to get fresh ones, so a signed URL never
 * has to survive longer than a render.
 *
 * ## Side-by-side, not a slider
 *
 * Chosen for reliability over polish (§25). A drag-to-compare slider needs
 * pointer capture, touch handling, keyboard equivalents and a focus model to be
 * accessible — several ways to be subtly broken — while two labelled images
 * side by side are legible, screen-reader friendly and stack on a narrow screen
 * without any of it. The primary job is understanding the change, not admiring
 * the control.
 */

const POLL_INTERVAL_MS = 2500;

function localTime(iso: string | null): string | null {
  // Deterministic across server and client — see format-datetime.ts. This
  // caption is what produced the hydration mismatch that motivated it.
  return formatTimestamp(iso);
}

/** Repeated wherever a comparison looks conclusive. That is when it is needed. */
function NotApproved() {
  return (
    <p className="text-xs text-fg-muted">
      A comparison is evidence, not a verdict · Not approved · Not merged · Not deployed
    </p>
  );
}

function Panel({
  label,
  caption,
  src,
  href,
}: {
  label: string;
  caption: string | null;
  src: string;
  href: string | null;
}) {
  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-prose">{label}</span>
        {href && (
          <a
            href={href}
            target="_blank"
            // Without this the opened page receives Vibe's project URL — and the
            // project id in it — in a Referer header.
            rel="noreferrer noopener"
            className="text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-body"
          >
            Open
          </a>
        )}
      </figcaption>

      {/* A plain image of bytes Vibe captured. No iframe, no proxy, no DOM from
          the page itself ever reaches this document (§8, §17). */}
      <a href={src} target="_blank" rel="noreferrer noopener" className="block">
        {/* Deliberately not `next/image`: the src is a short-lived signed URL,
            and the image optimizer would fetch and cache these bytes on a
            public, longer-lived optimizer URL — which is exactly the
            permanently-public screenshot URL §16 forbids. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${label} screenshot`}
          className="w-full rounded-md border border-line-2 bg-app"
        />
      </a>

      {caption && <p className="text-xs text-fg-muted">{caption}</p>}
    </figure>
  );
}

export function ReviewPanel({
  projectId,
  preparedChangeId,
  card,
  /** Signed, short-lived image URLs. Null unless the card is ready (§16). */
  images,
  /** The running preview to photograph, when there is one. */
  previewSessionId,
  /** The preview's current public origin, for "Open preview". Null once stopped. */
  previewOrigin,
  /** Existing code-diff equivalent. Kept available for technical users (§27). */
  branchUrl,
  commitSha,
  filesChanged,
}: {
  projectId: string;
  preparedChangeId: string;
  card: ReviewCard;
  images: ReviewImages | null;
  previewSessionId: string | null;
  previewOrigin: string | null;
  branchUrl: string | null;
  commitSha: string | null;
  filesChanged: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<StartReviewActionState>(null);
  const [pending, startTransition] = useTransition();
  /*
   * Watch the comparison, rather than re-rendering the page to find out
   * (UI-4 §5).
   *
   * This used to poll by calling `router.refresh()` on every tick, which
   * re-rendered the entire prepared-change route — every card, its merge
   * preflight, its signed image URLs — two and a half seconds apart. A render
   * can outlast that gap, so each refresh superseded the one still in flight,
   * and a capture of a minute cost roughly two dozen full re-renders to learn
   * one thing. It is the same mistake the preview panel had already made and
   * documented one file over.
   *
   * Now it asks the cheap question and refreshes once, on the transition.
   */
  useOperationPoll<ReviewCard>({
    key: `${preparedChangeId}:review`,
    enabled: card.state === "capturing" || pending,
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => ({
      kind: "value",
      value: await getReviewStatusAction(projectId, preparedChangeId),
    }),
    continueAfter: (next) => next.state === "capturing",
    onReading: (next) => {
      if (shouldRefreshForState(next.state, card.state)) router.refresh();
    },
  });

  function generate() {
    if (!previewSessionId) return;

    startTransition(async () => {
      setState(await startReviewAction(projectId, preparedChangeId, previewSessionId));
      router.refresh();
    });
  }

  const capturing = card.state === "capturing" || pending;
  const beforeAt = localTime(card.beforeCapturedAt);
  const afterAt = localTime(card.afterCapturedAt);

  return (
    <section className="space-y-3 border-t border-line-2 pt-4">
      <h4 className="text-sm font-medium text-fg-body">Review</h4>

      {capturing ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">Preparing comparison…</p>
          <p className="text-sm text-fg-secondary">
            Capturing your current live page and the preview.
          </p>
          <p className="text-xs text-fg-muted">
            You can leave this page. Vibe will finish the comparison.
          </p>
        </div>
      ) : card.state === "ready" ? (
        <div className="space-y-4">
          {images ? (
            <>
              {/* Side by side on desktop, stacked on narrow screens. Both images
                  are the same pinned viewport, so neither is scaled to fit the
                  other — scaling is how a comparison starts lying (§12). */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Panel
                  label="Before"
                  caption={beforeAt ? `Current live · captured ${beforeAt}` : "Current live"}
                  src={images.beforeUrl}
                  href={new URL(images.route, images.beforeOrigin).toString()}
                />
                <Panel
                  label="After"
                  caption={
                    afterAt
                      ? `Preview${commitSha ? ` · ${commitSha.slice(0, 7)}` : ""} · captured ${afterAt}`
                      : "Preview"
                  }
                  src={images.afterUrl}
                  // Only while the preview is alive. After teardown the images
                  // remain and this link does not — which is expected (§28).
                  href={previewOrigin ? new URL(images.route, previewOrigin).toString() : null}
                />
              </div>

              <p className="text-xs text-fg-muted">
                Route {images.route}
                {images.width && images.height ? ` · ${images.width}×${images.height}` : ""}
                {" · validated · "}
                {filesChanged} file{filesChanged === 1 ? "" : "s"} changed
              </p>
            </>
          ) : (
            /* The artifact is `ready`, so the images exist — this render simply
               could not produce a URL for them. Saying "loading" would be a
               lie that never resolves: nothing is in flight, and the first
               real comparison sat on that sentence while RLS silently refused
               to sign. */
            <div className="space-y-1">
              <p className="text-sm text-fg-secondary">Comparison images unavailable</p>
              <p className="text-xs text-fg-muted">
                The comparison was captured, but its images could not be opened for viewing.
                Reload the page to try again.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {branchUrl && (
              <a
                href={branchUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-line-4 px-3 py-1.5 text-sm text-fg-body hover:bg-surface-2"
              >
                View code diff
              </a>
            )}
          </div>

          <NotApproved />
        </div>
      ) : card.state === "failed" ? (
        <div className="space-y-2">
          <p className="text-sm text-coral">Comparison failed</p>
          {/* Safe copy from a stable code. Never a provider message (§31). */}
          {card.failureMessage && <p className="text-sm text-fg-secondary">{card.failureMessage}</p>}
          {previewSessionId && (
            <button
              type="button"
              onClick={generate}
              disabled={pending}
              className="rounded-md border border-line-4 px-3 py-1.5 text-sm text-fg-body hover:bg-surface-2 disabled:opacity-60"
            >
              Try again
            </button>
          )}
        </div>
      ) : card.state === "expired" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Comparison expired</p>
          <p className="text-xs text-fg-muted">
            Review images are kept for a limited time and this one has been removed.
          </p>
        </div>
      ) : previewSessionId ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Not generated</p>
          <p className="text-xs text-fg-muted">
            Generate a visual before/after comparison of your current live page and the temporary
            preview. Vibe opens both in an isolated browser and stores two screenshots.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="rounded-md border border-line-4 px-3 py-1.5 text-sm text-fg-body hover:bg-surface-2 disabled:opacity-60"
          >
            Generate comparison
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Preview required</p>
          {/* Never offers to start one. A preview is provider spend, and the
              user starts it deliberately from its own section (§6, §23). */}
          <p className="text-xs text-fg-muted">
            Start a temporary preview above — a comparison photographs the running preview beside
            your current live page.
          </p>
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-coral">{state.message}</p>}
    </section>
  );
}
