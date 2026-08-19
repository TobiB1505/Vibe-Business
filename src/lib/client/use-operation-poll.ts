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
 * The timing logic here is a handful of lines with no decisions in them; the
 * decisions live in `operationPollPhase`, `freshestOperation` and
 * `shouldRefreshForState`, which are pure and unit-tested. This file is not,
 * because the repository's test environment is Node with no DOM, and adding
 * one for a single file would change how every other test runs.
 */

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
  onReading,
}: UseOperationPollOptions<T>): OperationPoll<T> {
  /*
   * The reading is stored with the subject it came from, and read back only
   * when they still agree. That makes "a new subject has no history" a
   * derivation rather than a reset — nothing has to fire to clear it, so a
   * stale answer can never be read as the new subject's first one, not even
   * for the one render before an effect would have run.
   */
  const [reading, setReading] = useState<{ key: string | null; value: T | null }>({
    key,
    value: null,
  });
  const latest = reading.key === key ? reading.value : null;

  // Held rather than depended on: both are re-created by the caller on every
  // render, and depending on them would re-arm the interval each time.
  const pollRef = useRef(poll);
  const onReadingRef = useRef(onReading);
  const previousRef = useRef<T | null>(null);

  useEffect(() => {
    pollRef.current = poll;
    onReadingRef.current = onReading;
  });

  useEffect(() => {
    if (!key || !enabled) return;

    // A new subject starts with no history to compare against.
    previousRef.current = null;

    let cancelled = false;

    const tick = async () => {
      // A hidden tab is not watching. Skipping rather than clearing keeps the
      // schedule, so returning to the tab does not wait a full interval.
      if (typeof document !== "undefined" && document.hidden) return;

      const next = await pollRef.current();

      // The component may have unmounted, or moved on to another subject,
      // while the request was in flight; a setState then is both useless and
      // noisy.
      if (cancelled || next.kind !== "value") return;

      const previous = previousRef.current;
      previousRef.current = next.value;
      setReading({ key, value: next.value });
      onReadingRef.current?.(next.value, previous);
    };

    const timer = setInterval(() => void tick(), intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, enabled, intervalMs]);

  return { latest, polling: Boolean(key) && enabled };
}
