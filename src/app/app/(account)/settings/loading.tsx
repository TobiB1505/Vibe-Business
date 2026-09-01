import { SkeletonBlock } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/ui/typography";

/**
 * Shown while account settings resolve the erasure state (PERF-015).
 *
 * Same correction as the profile route: this screen is a three-card grid and
 * a delete section, and the dashboard skeleton it used to borrow describes
 * neither. The header renders for real — see `profile/loading.tsx`.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title="Settings"
        description="Manage your account, connected GitHub access and billing."
      />
      <div role="status" aria-label="Loading your settings" className="flex flex-col gap-8">
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonBlock className="h-56 w-full" />
          <SkeletonBlock className="h-56 w-full" />
          <SkeletonBlock className="h-56 w-full" />
        </div>
        <SkeletonBlock className="h-44 w-full" />
      </div>
    </div>
  );
}
