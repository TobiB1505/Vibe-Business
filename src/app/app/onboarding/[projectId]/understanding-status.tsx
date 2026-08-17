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
      {/*
        A stalled run is not a stage, so it is not described as one. The
        headline stays on the last real stage the server reported and the
        stalled state is rendered next to this panel, where it can carry an
        action — rather than overwriting the stage line with a worry that has
        nothing to do about it (UI-S1 §14).
      */}
      <div className="flex flex-col gap-2">
        <h2 className="text-fg text-2xl font-semibold">
          {STAGE_COPY[operation.stage] ?? "Vibe is getting to know your product"}
        </h2>
        {/*
          Durable by ADR 0013: the run is owned by the execution provider, not
          by this request, so leaving genuinely does not stop it. Claimed only
          while the operation is still believed to be live — once it stalls,
          that is exactly the claim that has stopped being safe to make.
        */}
        {!operation.stalled && (
          <p className="text-fg-muted text-sm">You can leave this page. Vibe will keep going.</p>
        )}
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
      {/* "Working from real source state" said the same thing in the code's
          words rather than the founder's (UI-S1 §25). The claim is worth
          keeping — Vibe is not guessing — so only the wording changed. */}
      <MonoLabel className="text-mint">Working only from what you connected</MonoLabel>
    </Surface>
  );
}
