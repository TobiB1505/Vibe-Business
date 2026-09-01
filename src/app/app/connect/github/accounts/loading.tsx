import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";
import { OnboardingShell } from "../../../onboarding/onboarding-shell";

/**
 * The first frame of the account chooser (PERF-015).
 *
 * Reaching this screen means GitHub has just handed the browser back, so the
 * founder has already left the product once and returned. A blank page on the
 * way in reads as the hand-off having failed. The list shape is drawn because
 * a list is what arrives — how many rows it has is the only unknown.
 */
export default function Loading() {
  return (
    <OnboardingShell email={null} state={null}>
      <section
        role="status"
        aria-label="Loading"
        className="flex max-w-[48rem] flex-col gap-5 py-4 sm:py-10"
      >
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-44 rounded-full" />
          <SkeletonBlock className="h-11 w-3/4 sm:h-14" />
          <SkeletonText lines={1} className="max-w-[44ch]" />
        </div>
        <div className="border-line-2 divide-line-2 flex flex-col divide-y overflow-hidden rounded-xl border">
          <SkeletonBlock className="h-14 w-full rounded-none" />
          <SkeletonBlock className="h-14 w-full rounded-none" />
        </div>
      </section>
    </OnboardingShell>
  );
}
