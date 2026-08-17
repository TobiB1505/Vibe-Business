import { VibeMark } from "@/components/brand/vibe-mark";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { LiveSiteStatus } from "@/modules/onboarding/state";
import type { OperationView } from "@/modules/operations/view";

const STAGE_COPY: Partial<Record<OperationView["stage"], string>> = {
  preparing: "Preparing what Vibe found",
  counting_tokens: "Preparing what Vibe found",
  reading_code: "Understanding what you built",
  reading_public_product: "Understanding how the product presents itself",
  understanding_product: "Understanding who it is for and how people use it",
  persisting: "Saving your Product Profile",
};

export function UnderstandingStatus({
  operation,
  liveSiteStatus,
}: {
  operation: OperationView;
  liveSiteStatus: LiveSiteStatus;
}) {
  const hasLive = liveSiteStatus === "provided";
  return (
    <Surface level="card" padding="lg" className="flex flex-col items-center gap-6 text-center" role="status">
      <VibeMark size={42} />
      <div className="flex flex-col gap-2">
        <h2 className="text-fg text-2xl font-semibold">
          {operation.stalled ? "This is taking longer than expected." : (STAGE_COPY[operation.stage] ?? "Vibe is getting to know your product")}
        </h2>
        <p className="text-fg-muted text-sm">You can leave this page. Vibe will keep going.</p>
      </div>
      <dl className="grid w-full max-w-[38rem] gap-2 text-left sm:grid-cols-2">
        <div className="border-line-2 bg-surface-2 rounded-lg border p-3">
          <dt className="text-fg-meta text-xs">Product source</dt>
          <dd className="text-fg-body mt-1 text-sm">Repository connected</dd>
        </div>
        <div className="border-line-2 bg-surface-2 rounded-lg border p-3">
          <dt className="text-fg-meta text-xs">Public product</dt>
          <dd className="text-fg-body mt-1 text-sm">
            {hasLive ? "Live product read" : "No live site provided"}
          </dd>
        </div>
      </dl>
      <MonoLabel className="text-mint">Working from real source state</MonoLabel>
    </Surface>
  );
}
