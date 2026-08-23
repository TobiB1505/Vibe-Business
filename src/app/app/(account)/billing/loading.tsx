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
    <>
      <div role="status" aria-label="Loading your billing details" className="flex flex-col gap-6">
        <SkeletonBlock className="h-9 w-1/2 max-w-[24rem] rounded-full" />
        <SkeletonText lines={2} className="max-w-[62ch]" />
        <SkeletonBlock className="h-48 w-full" />
      </div>
    </>
  );
}
