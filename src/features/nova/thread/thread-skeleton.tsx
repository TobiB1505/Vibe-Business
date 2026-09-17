import { SkeletonSection, SkeletonText } from "@/components/ui/skeleton";

/**
 * What the conversations index calls itself, in one place.
 *
 * The page and the skeleton standing in for it must say the same thing, and
 * the way to guarantee that is to leave them nothing to disagree about — which
 * is `WORKSPACE_SECTION_HEADINGS`' whole argument, applied to the one route
 * that is not a workspace section. The thread route below deliberately has no
 * such pair: a thread's title is the thread's own, so its skeleton draws a
 * placeholder rather than a word the arriving page replaces.
 */
export const THREADS_HEADING = {
  eyebrow: "Conversations",
  title: "Everything you and Nova have talked about",
} as const;

/**
 * The first frame a conversation route answers a click with.
 *
 * `/threads/[threadId]` only. It stood in for `/threads` as well while that
 * route was a redirect to whichever thread was open; Slice 7 made it a list,
 * and a transcript's skeleton standing in for a titled list is the swap
 * `WORKSPACE_SECTION_HEADINGS` exists to prevent one level up.
 *
 * The heading is a placeholder here, unlike every other route's skeleton: a
 * thread's title is the thread's own, so there is no static string this file
 * and the page could share. Writing one would put a word on screen that the
 * arriving page replaces.
 */
export function ThreadSkeleton() {
  return (
    <section className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="text-mint text-[0.68rem] font-semibold tracking-[0.15em] uppercase">
          Conversation
        </span>
        <SkeletonText lines={1} />
      </div>
      <SkeletonSection />
    </section>
  );
}

/**
 * The conversations index, before the list arrives.
 *
 * Its own skeleton rather than the thread's, because the two screens are not
 * the same shape: one is a titled list and the other is a transcript with a
 * composer under it. Sharing one would mean a founder watching the heading they
 * were waiting for get swapped for a different one at the moment it landed.
 */
export function ThreadListSkeleton() {
  return (
    <section className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="text-mint text-[0.68rem] font-semibold tracking-[0.15em] uppercase">
          {THREADS_HEADING.eyebrow}
        </span>
        <h1 className="text-fg text-headline font-bold sm:text-display">{THREADS_HEADING.title}</h1>
      </div>
      <SkeletonSection />
    </section>
  );
}
