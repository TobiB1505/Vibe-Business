import { SkeletonBlock, SkeletonText } from "@/components/ui/skeleton";
import { OnboardingShell } from "./onboarding-shell";

/**
 * The first frame of onboarding (PERF-015).
 *
 * This route resolves which project a returning founder should be sent back
 * to, which is a read plus a redirect — so until now the most consequential
 * first click in the product answered with a blank page. The shell is drawn
 * for real (it needs nothing this route has to read), and only the part that
 * genuinely depends on the answer is a placeholder.
 *
 * `state` is null rather than guessed: see the prop's own docblock.
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
          <SkeletonBlock className="h-3 w-24 rounded-full" />
          <SkeletonBlock className="h-16 w-4/5 sm:h-24" />
          <SkeletonText lines={2} className="max-w-[58ch]" />
        </div>
        <SkeletonBlock className="h-36 w-full" />
      </section>
    </OnboardingShell>
  );
}
