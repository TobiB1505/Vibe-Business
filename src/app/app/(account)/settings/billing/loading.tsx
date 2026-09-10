import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown while the billing overview resolves (UI-4 §1).
 *
 * Same reasoning as the dashboard: `/app` renders no chrome of its own, so the
 * shell is supplied here. Nothing on this screen is skeletonised in a way that
 * suggests a balance, a plan or an amount — a placeholder where a number will
 * appear is a shape, and it must not read as a figure.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading your billing details" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-9 w-44 rounded-full" />
        <SkeletonText lines={1} className="max-w-[28rem]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonBlock className="h-72 w-full" />
        <SkeletonBlock className="h-72 w-full" />
        <SkeletonBlock className="h-72 w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.7fr)]">
        <SkeletonBlock className="h-80 w-full" />
        <SkeletonBlock className="h-80 w-full" />
      </div>
    </div>
  );
}
