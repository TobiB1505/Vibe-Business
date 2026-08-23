import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown while the dashboard resolves its reads (UI-4 §1, reshaped in CORE-6).
 *
 * It supplies no chrome of its own any more. The account rail lives in
 * `(account)/layout.tsx`, which renders around this — so the rail is already
 * on screen while these blocks are, and the wait no longer looks like a
 * different application. Before CORE-6 this file had to render `AppShell`
 * itself, because `/app/layout.tsx` is an authorization gate and nothing else.
 *
 * The shapes follow the screen they stand in for: one wide hero beside a
 * narrower card, then the product grid. A skeleton that does not match its
 * page makes the content jump when it arrives.
 */
export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <SkeletonBlock className="h-9 w-2/3 max-w-[28rem] rounded-full" />
          <SkeletonText lines={1} className="max-w-[52ch]" />
        </header>
        <div role="status" aria-label="Loading your products" className="flex flex-col gap-10">
          <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
            <SkeletonBlock className="h-56 w-full" />
            <SkeletonBlock className="h-56 w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SkeletonBlock className="h-60 w-full" />
            <SkeletonBlock className="h-60 w-full" />
            <SkeletonBlock className="h-60 w-full" />
          </div>
        </div>
      </div>
    </>
  );
}
