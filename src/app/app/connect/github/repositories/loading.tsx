import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";
import { OnboardingShell } from "../../../onboarding/onboarding-shell";

/**
 * The first frame of the repository picker (PERF-015).
 *
 * This page asks GitHub for the installation's repositories, which is a third
 * party's round trip on the return leg of an OAuth hand-off — the slowest read
 * in onboarding and the one least under Vibe's control. It is the place a
 * blank screen is most likely and least excusable.
 */
export default function Loading() {
  return (
    <OnboardingShell email={null} state={null}>
      <section
        role="status"
        aria-label="Loading"
        className="flex max-w-[52rem] flex-col gap-5 py-4 sm:py-10"
      >
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-44 rounded-full" />
          <SkeletonBlock className="h-11 w-4/5 sm:h-14" />
          <SkeletonText lines={1} className="max-w-[48ch]" />
        </div>
        <div className="border-line-2 divide-line-2 flex flex-col divide-y overflow-hidden rounded-xl border">
          <SkeletonBlock className="h-14 w-full rounded-none" />
          <SkeletonBlock className="h-14 w-full rounded-none" />
          <SkeletonBlock className="h-14 w-full rounded-none" />
        </div>
      </section>
    </OnboardingShell>
  );
}
