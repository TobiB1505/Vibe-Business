import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown while the dashboard resolves its reads (UI-4 §1).
 *
 * This supplies `AppShell` itself. The `/app` layout deliberately renders no
 * chrome — it is an authorization gate and nothing else — so a bare skeleton
 * here would drop the header and read as a different application for as long
 * as the wait lasted.
 *
 * No email is passed: the session is one of the things still being resolved,
 * and an empty account slot is more honest than a guess.
 */
export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <SkeletonBlock className="h-9 w-2/3 max-w-[28rem] rounded-full" />
          <SkeletonText lines={1} className="max-w-[52ch]" />
        </header>
        <div role="status" aria-label="Loading your projects" className="flex flex-col gap-3">
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-20 w-full" />
        </div>
      </div>
    </>
  );
}
