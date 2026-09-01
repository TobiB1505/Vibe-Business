import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";
import { OnboardingShell } from "../onboarding-shell";

/**
 * The first frame of a project's onboarding (PERF-015).
 *
 * The longest read chain in the application sits behind this address, and it
 * is the screen a founder sees before they have any reason to trust that the
 * product works. The shell paints immediately; the phase rail claims no
 * position, because which phase this project is in is exactly what the page
 * is still finding out.
 */
export default function Loading() {
  return (
    <OnboardingShell email={null} state={null}>
      <section
        role="status"
        aria-label="Loading"
        className="flex max-w-[52rem] flex-col gap-8 py-5 sm:py-12"
      >
        <div className="flex flex-col gap-4">
          <SkeletonBlock className="h-3 w-28 rounded-full" />
          <SkeletonBlock className="h-14 w-3/4 sm:h-20" />
          <SkeletonText lines={2} className="max-w-[58ch]" />
        </div>
        <SkeletonBlock className="h-64 w-full" />
      </section>
    </OnboardingShell>
  );
}
