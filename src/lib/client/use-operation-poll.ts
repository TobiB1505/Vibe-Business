"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One implementation of "ask the server again until it stops changing"
 * (UI-4 §5).
 *
 * ## Why this exists
 *
 * Eleven panels had written this themselves. They used four different
 * intervals for identical work, none paused when the tab was hidden, and the
 * differences between them were not choices — they were the order the panels
 * happened to be written in. Two of the defects the audit found were in the
 * gaps between those copies: one panel re-rendered the entire prepared-change
 * route every 2.5 seconds, and two never refreshed at all when their
 * operation finished.
 *
 * ## What it deliberately does not do
 *
 * **It never polls immediately.** There is no `leading` option, not even one
 * defaulting to false. Every call site already has a server-rendered value
 * that *is* the first reading, so an immediate poll would re-fetch what the
 * page just rendered — and in the fixture harness, where these panels are
 * rendered without a session, it would fire a Server Action that redirects
 * the browser to the sign-in page mid-test.
 *
 * **It never refreshes the router.** Refresh policy belongs to the call site,
 * which is the only thing that knows what its own server render already says.
 * A hook that refreshed on the caller's behalf could only do it on every
 * reading, which is the exact defect being removed.
 *
 * **It renders nothing.** No status line, no "Try again", no live region. The
 * panels have their own copy for those, the browser suite asserts on some of
 * them page-wide, and a shared widget would put text on screens that never
 * asked for it.
 *
 * ## What it owns
 *
 * The timer, and the fact that the timer survives re-renders. Every call site
 * passes an inline closure for `poll`, so a naive effect would re-arm the
 * interval on every parent render — with a two-second interval and a parent
 * that renders often, it would never fire at all, silently. The callback is
 * held in a ref and the effect depends only on identity, whether it is on,
 * and how often.
 *
 * It also owns the two things a bare `setInterval` gets wrong (PERF-003).
 * **One request at a time**: the callers' intervals run from 1.8s and the
 * Supabase client's deadline is fifteen seconds, so a slow read used to stack
 * concurrent Server Actions for the same operation — a tab that fell behind
 * pressed harder on the thing that was already struggling. **A failure is an
 * answer**: `void tick()` turned a rejected read into an unhandled rejection
 * and then asked again at the same cadence, which is the shape of a retry
 * storm. A failed read now costs a backoff instead.
 *
 * The timing logic here is a handful of lines with no decisions in them; the
 * decisions live in `pollBackoffMultiplier` above and in `operationPollPhase`,
 * `freshestOperation` and `shouldRefreshForState`, which are pure and
 * unit-tested. The hook itself is not, because the repository's test
 * environment is Node with no DOM, and adding one for a single file would
 * change how every other test runs.
 */

/**
 * The ceiling on the backoff, in multiples of the caller's interval.
 *
 * Eight is where a 1.8s poll becomes a ~15s poll — slow enough to stop being
 * pressure on something that is already failing, fast enough that a recovery
 * is noticed within one screenful of attention rather than after a coffee.
 */
export const POLL_BACKOFF_MAX_MULTIPLIER = 8;

/**
 * How long to wait after a failed read, as a multiple of the interval.
 *
 * The decision, kept pure and out of the effect below for the same reason
 * `operationPollPhase` is: a schedule buried in a timer is a schedule nobody
 * can assert on.
 *
 * Doubling rather than a fixed delay, because the two failures this exists for
 * differ in kind. A single dropped request should cost one skipped reading; a
 * backend that is genuinely down should stop being asked every two seconds by
 * every open tab. Capped, because a poll that has backed off past the point of
 * usefulness is indistinguishable from one that stopped.
 */
export function pollBackoffMultiplier(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 1;
  return Math.min(2 ** consecutiveFailures, POLL_BACKOFF_MAX_MULTIPLIER);
}

export type PollReading<T> =
  | { kind: "value"; value: T }
  /** The server declined to answer — not found, not owned, expired. The last
   *  known reading stands rather than being replaced by a gap. */
  | { kind: "unavailable" };

export type UseOperationPollOptions<T> = {
  /**
   * What is being watched. A change tears the timer down and drops the last
   * reading, so a second operation never inherits the first one's answer.
   */
  key: string | null;
  /** Whether to keep asking. Derived by the caller, usually from the phase. */
  enabled: boolean;
  intervalMs: number;
  /** One read. Must not write, and must be safe to call repeatedly. */
  poll: () => Promise<PollReading<T>>;
  /**
   * Whether the answer just received is worth asking after again.
   *
   * `enabled` can only speak for what the server rendered, which goes stale
   * the moment the first reading lands — so this is how a poller stops on its
   * own answer. Supplied by the caller and kept pure (`operationPollPhase`,
   * a state comparison) so the decision stays testable and out of here.
   *
   * Omitted, the timer runs until `enabled` or `key` says otherwise.
   */
  continueAfter?: (next: T) => boolean;
  /**
   * Called once per successful reading, with the one before it. This is where
   * a caller decides whether the server render is now stale.
   */
  onReading?: (next: T, previous: T | null) => void;
};

export type OperationPoll<T> = {
  /** The freshest reading, or null before one lands. Never seeded from the
   *  server render — the caller already has that and knows how to prefer it. */
  latest: T | null;
  /** Whether a timer is currently armed. Never means "finished". */
  polling: boolean;
};

export function useOperationPoll<T>({
  key,
  enabled,
  intervalMs,
  poll,
  continueAfter,
  onReading,
}: UseOperationPollOptions<T>): OperationPoll<T> {
  /*
   * The reading is stored with the subject it came from, and read back only
   * when they still agree. That makes "a new subject has no history" a
   * derivation rather than a reset — nothing has to fire to clear it, so a
   * stale answer can never be read as the new subject's first one, not even
   * for the one render before an effect would have run.
   */
  const [reading, setReading] = useState<{
    key: string | null;
    value: T | null;
    /** Set once an answer says there is nothing left to wait for. Stored with
     *  the subject, so a new one is never born already stopped. */
    stopped: boolean;
  }>({ key, value: null, stopped: false });

  const current = reading.key === key ? reading : { key, value: null, stopped: false };
  const latest = current.value;

  // Held rather than depended on: both are re-created by the caller on every
  // render, and depending on them would re-arm the interval each time.
  const pollRef = useRef(poll);
  const onReadingRef = useRef(onReading);
  const continueAfterRef = useRef(continueAfter);
  const previousRef = useRef<T | null>(null);
  /** Whether a read is outstanding. The guard against stacking requests. */
  const inFlightRef = useRef(false);
  /** Consecutive failed reads, and the moment the next one may be attempted. */
  const failuresRef = useRef(0);
  const nextAttemptAtRef = useRef(0);

  useEffect(() => {
    pollRef.current = poll;
    onReadingRef.current = onReading;
    continueAfterRef.current = continueAfter;
  });

  useEffect(() => {
    if (!key || !enabled || current.stopped) return;

    // A new subject starts with no history to compare against, and inherits
    // neither the previous one's outstanding read nor its backoff.
    previousRef.current = null;
    inFlightRef.current = false;
    failuresRef.current = 0;
    nextAttemptAtRef.current = 0;

    let cancelled = false;

    const tick = async () => {
      // A hidden tab is not watching. Skipping rather than clearing keeps the
      // schedule, so returning to the tab does not wait a full interval.
      if (typeof document !== "undefined" && document.hidden) return;

      // One at a time. The previous read is still outstanding, so asking again
      // would not produce a fresher answer — only a second request competing
      // with the first for the same connection.
      if (inFlightRef.current) return;

      // Still backing off from a failure. Same skip-rather-than-reschedule
      // shape as the hidden tab above, so recovery lands on the next tick
      // after the wait rather than a full interval later.
      if (Date.now() < nextAttemptAtRef.current) return;

      let next: PollReading<T>;
      inFlightRef.current = true;
      try {
        next = await pollRef.current();
      } catch {
        // A read that threw is a failure, not a reason to stop: the operation
        // it is watching is unaffected by this browser's network. Swallowed
        // deliberately and narrowly — the alternative was an unhandled
        // rejection, and the caller has a server-rendered value to keep
        // showing meanwhile.
        failuresRef.current += 1;
        nextAttemptAtRef.current =
          Date.now() + intervalMs * pollBackoffMultiplier(failuresRef.current);
        return;
      } finally {
        inFlightRef.current = false;
      }

      // An answer arrived, so the next one may be asked for on schedule.
      failuresRef.current = 0;
      nextAttemptAtRef.current = 0;

      // The component may have unmounted, or moved on to another subject,
      // while the request was in flight; a setState then is both useless and
      // noisy.
      if (cancelled || next.kind !== "value") return;

      const previous = previousRef.current;
      previousRef.current = next.value;

      const keepGoing = continueAfterRef.current?.(next.value) ?? true;
      setReading({ key, value: next.value, stopped: !keepGoing });
      onReadingRef.current?.(next.value, previous);
    };

    const timer = setInterval(() => void tick(), intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, enabled, intervalMs, current.stopped]);

  return { latest, polling: Boolean(key) && enabled && !current.stopped };
}
