import { SkeletonSection, SkeletonText } from "@/components/ui/skeleton";

/**
 * The first frame a conversation route answers a click with.
 *
 * One component for both thread routes — `/threads`, which resolves which
 * thread is open, and `/threads/[threadId]`, which reads one. Two copies of a
 * skeleton is two skeletons within a month, and the swap a founder sees is
 * exactly what `WORKSPACE_SECTION_HEADINGS` exists to prevent one level up.
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
