import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown while the dashboard resolves its reads.
 *
 * It supplies no chrome of its own. The account rail lives in
 * `(account)/layout.tsx`, which renders around this — so the rail is already on
 * screen while these blocks are, and the wait no longer looks like a different
 * application.
 *
 * ## The shapes are the screen's, and that is the whole job
 *
 * A skeleton that does not match what arrives is a second layout the reader
 * watches collapse into the first. This one is the desk: the open decision,
 * then rows. It followed the old grid — one signal, one action band, three
 * cards and a banner — until the screen stopped being that, which is exactly
 * the kind of drift a loading state acquires silently because nobody sees the
 * two side by side.
 *
 * Three rows rather than the four a full desk has: the count is unknown while
 * the read is in flight, and guessing high leaves a taller hole than the
 * content fills. Guessing low is the safer error — the list grows downward
 * into empty page rather than shrinking away under a cursor.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <SkeletonBlock className="h-9 w-2/3 max-w-[28rem] rounded-full" />
        <SkeletonText lines={1} className="max-w-[52ch]" />
      </header>
      <div role="status" aria-label="Loading your desk" className="flex flex-col gap-6">
        {/* The open decision. */}
        <SkeletonBlock className="h-[22rem] w-full" />
        <div className="flex flex-col gap-2.5">
          <SkeletonBlock className="h-[4.5rem] w-full" />
          <SkeletonBlock className="h-[4.5rem] w-full" />
          <SkeletonBlock className="h-[4.5rem] w-full" />
        </div>
      </div>
    </div>
  );
}
