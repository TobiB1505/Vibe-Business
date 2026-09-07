"use client";

import { useEffect, useState } from "react";
import { formatLocalClock } from "@/lib/utils/format-datetime";

/**
 * The viewer's own clock, in the header.
 *
 * ## Why this is a client component and could not be anything else
 *
 * A time rendered on the server is the server's time in the server's zone,
 * and it is stale the moment it is sent. Both halves are wrong for a header
 * whose whole job is to say *right now*. So the value comes from the browser
 * that is reading it, which is also the only place the founder's own timezone
 * and 12/24-hour preference exist.
 *
 * ## Why it renders nothing first
 *
 * There is no correct server value to render, so it renders none — and the
 * space is reserved with `tabular-nums` and a minimum width, so the header
 * does not shift when the real time arrives. A placeholder would be a time
 * nobody's clock says.
 *
 * ## Why it is not animation
 *
 * A minute is not a frame. It ticks on a thirty-second interval and refreshes
 * when the tab comes back, so a founder returning to a page that sat open for
 * an hour does not read a stale clock as a live one — which is the only way
 * this element could tell a lie.
 *
 * ## Why it does not use a locale formatter
 *
 * `format-datetime.ts` forbids one and a test enforces it: `Intl` output
 * differs between runtimes, which is where hydration mismatches come from.
 * `formatLocalClock` is that file's one local-time function, hand-computed
 * from `Date`'s local getters, and it exists for exactly this call site.
 */
export function NovaClock() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const read = () => setNow(formatLocalClock(new Date()));

    read();
    const timer = window.setInterval(read, 30_000);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);

  return (
    <span className="min-w-[3.5ch] shrink-0 text-right font-mono text-caption text-fg-meta tabular-nums">
      {now}
    </span>
  );
}
