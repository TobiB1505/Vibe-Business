import { SkeletonBlock } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/ui/typography";

/**
 * Shown while the profile resolves its GitHub identity (PERF-015).
 *
 * Until now this route borrowed `(account)/loading.tsx` — a product grid,
 * three cards and a connect banner, none of which this page has. A skeleton
 * that promises the wrong screen is worse than a plain one: the layout moves
 * twice, and the first move was a guess.
 *
 * The header is rendered for real. It depends on nothing that is being read,
 * so a placeholder in its place would be a shape standing in for text that was
 * already available — and would reintroduce the copy drift PERF-015 found on
 * the two routes that did exactly that.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title="Account Profile"
        description="Your identity, connected account and workspace at a glance."
      />
      <div role="status" aria-label="Loading your profile" className="flex flex-col gap-5 sm:gap-6">
        <SkeletonBlock className="h-44 w-full sm:h-40" />
        <SkeletonBlock className="h-72 w-full" />
        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <SkeletonBlock className="h-52 w-full" />
          <SkeletonBlock className="h-52 w-full" />
        </div>
        <SkeletonBlock className="h-36 w-full" />
      </div>
    </div>
  );
}
