import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { VibeMark } from "@/components/brand/vibe-mark";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { requireSession } from "@/modules/auth/session";
import { getAuditReadiness } from "@/modules/business-audit/service";
import { getActiveOpportunityOperation } from "@/modules/operations/service";
import { markOnboardingMilestone, getProjectOnboarding } from "@/modules/onboarding/store";
import { buildUnderstandingView } from "@/modules/product-understanding/view";
import { AuditAnalyzing, AuditPreparing, AuditWaitingHeader } from "../../projects/[projectId]/audit-lifecycle";
import { NeedsUserPanel } from "../../projects/[projectId]/needs-user-panel";
import { OnboardingShell } from "../onboarding-shell";
import { completeOnboardingAction } from "./actions";
import { OnboardingAuditReveal } from "./audit-reveal";
import { AuditLivePrerequisite } from "./audit-live-prerequisite";
import { LiveSiteStep } from "./live-site-step";
import { OperationWatcher } from "./operation-watcher";
import { ProductConfirmation } from "./product-confirmation";
import { RetryProductScan, StartAudit } from "./phase-actions";
import { UnderstandingStatus } from "./understanding-status";

export default async function ProjectOnboardingPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const onboarding = await getProjectOnboarding(supabase, { projectId, userId: session.userId });
  if (!onboarding) notFound();
  if (onboarding.state === "complete") redirect(`/app/projects/${projectId}`);

  const auditReadiness =
    onboarding.productProfile?.stored.confirmedAt && !onboarding.audit?.result
      ? await getAuditReadiness(supabase, projectId)
      : null;
  const opportunityOperation =
    onboarding.state === "first_move"
      ? await getActiveOpportunityOperation(supabase, projectId)
      : null;

  if (
    onboarding.state === "first_move" &&
    onboarding.firstMoveViewedAt === null &&
    (Boolean(onboarding.opportunities?.set.opportunities[0]) || opportunityOperation === null)
  ) {
    const firstView = await markOnboardingMilestone(supabase, {
      projectId,
      milestone: "first_move_viewed_at",
    });
    if (firstView) {
      await recordAuditEvent(supabase, {
        userId: session.userId,
        projectId,
        eventType: "onboarding.first_move_viewed",
        metadata: {
          projectId,
          hasMove: (onboarding.opportunities?.set.opportunities.length ?? 0) > 0,
        },
      });
    }
  }

  const understanding = onboarding.productProfile
    ? buildUnderstandingView(
        onboarding.productProfile.profile,
        onboarding.productProfile.stored.synthesized,
      )
    : null;

  return (
    <OnboardingShell
      email={session.email}
      state={onboarding.state}
      projectName={onboarding.projectName}
    >
      {onboarding.state === "connect_source" && (
        <section className="flex max-w-[44rem] flex-col gap-6 py-8">
          <MonoLabel>Connect</MonoLabel>
          <h1 className="text-fg text-display font-bold">Show Vibe what you built.</h1>
          <p className="text-fg-prose max-w-[55ch] leading-relaxed">
            Connect the product source. GitHub is the current read-only source; the onboarding lifecycle stays independent of the provider.
          </p>
          <div>
            <Link href="/app/connect/github" className={buttonClasses()}>
              Connect GitHub
            </Link>
          </div>
        </section>
      )}

      {onboarding.state === "add_live_product" && (
        <section className="flex max-w-[50rem] flex-col gap-7">
          <header className="flex flex-col gap-3">
            <MonoLabel>Connect · Product found</MonoLabel>
            <h1 className="text-fg text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[3rem]">
              One more view of your product.
            </h1>
            <p className="text-fg-prose max-w-[58ch] leading-relaxed">
              Vibe found <span className="text-fg-body">{onboarding.repository?.fullName}</span>. A live site helps Vibe compare the code with what customers can actually reach.
            </p>
          </header>
          {onboarding.repository && (
            <Surface level="panel" padding="md" className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-fg-body text-sm font-medium">{onboarding.repository.fullName}</span>
              <span className="text-fg-meta font-mono text-xs">{onboarding.repository.defaultBranch} · connected</span>
            </Surface>
          )}
          <LiveSiteStep
            projectId={projectId}
            currentUrl={onboarding.productionUrl}
            liveScanFailed={onboarding.liveSiteStatus === "scan_failed"}
          />
        </section>
      )}

      {onboarding.state === "product_scanning" && (
        <section className="flex flex-col gap-6">
          <header className="flex flex-col gap-3">
            <MonoLabel>Understand</MonoLabel>
            <h1 className="text-fg text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[3rem]">
              Vibe is getting to know your product.
            </h1>
            <p className="text-fg-muted max-w-[58ch]">
              It is reading what you built, who it appears to be for, and how people use it. You can leave and come back.
            </p>
          </header>
          {onboarding.understandingOperation ? (
            <>
              <OperationWatcher projectId={projectId} operation={onboarding.understandingOperation} />
              <UnderstandingStatus
                operation={onboarding.understandingOperation}
                liveSiteStatus={onboarding.liveSiteStatus}
              />
            </>
          ) : (
            <Surface level="card" padding="lg" className="flex flex-col gap-5">
              <VibeMark size={40} />
              <div className="flex flex-col gap-2">
                <h2 className="text-fg text-xl font-semibold">Your source is still connected.</h2>
                <p className="text-fg-muted text-sm">The previous attempt did not produce a Product Profile. Nothing else needs repeating.</p>
              </div>
              <RetryProductScan projectId={projectId} />
            </Surface>
          )}
        </section>
      )}

      {onboarding.state === "product_reveal" && understanding && onboarding.productProfile && (
        <section className="flex flex-col gap-8">
          <Surface level="card" padding="lg" className="flex flex-col items-center gap-7 text-center">
            {understanding.brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={understanding.brand.logo.url} alt={understanding.brand.logo.alt} className="h-12 max-w-[220px] object-contain" referrerPolicy="no-referrer" />
            ) : (
              <VibeMark size={44} />
            )}
            <div className="flex flex-col gap-3">
              <MonoLabel>Understand · Product reveal</MonoLabel>
              <h1 className="text-fg text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[3rem]">
                {understanding.headline.title}
              </h1>
              {understanding.headline.productName && (
                <p className="text-fg-body text-xl font-semibold">{understanding.headline.productName}</p>
              )}
              {understanding.headline.understanding && (
                <p className="text-fg-prose mx-auto max-w-[62ch] leading-relaxed">{understanding.headline.understanding}</p>
              )}
            </div>
            <div className="grid w-full max-w-[54rem] gap-3 text-left sm:grid-cols-2">
              {understanding.audience.slice(0, 2).map((fact) => (
                <div key={fact.label} className="border-line-2 bg-surface-2 rounded-xl border p-4">
                  <p className="text-fg-meta text-xs">{fact.label}</p>
                  <p className="text-fg-body mt-1 text-sm">{fact.value}</p>
                </div>
              ))}
            </div>
            <div className="border-line-2 w-full border-t pt-6">
              <h2 className="text-fg-body mb-4 font-semibold">Did Vibe get this right?</h2>
              <ProductConfirmation
                projectId={projectId}
                profileId={onboarding.productProfile.stored.id}
                values={{
                  name: onboarding.productProfile.profile.identity.name.value ?? "",
                  shortDescription: onboarding.productProfile.profile.identity.shortDescription.value ?? "",
                  understanding: onboarding.productProfile.profile.identity.understanding.value ?? "",
                  mainPurpose: onboarding.productProfile.profile.identity.mainPurpose.value ?? "",
                  mainPromise: onboarding.productProfile.profile.identity.mainPromise.value ?? "",
                  primaryAudience: onboarding.productProfile.profile.audience.primaryAudience.value ?? "",
                  problemSolved: onboarding.productProfile.profile.audience.problemSolved.value ?? "",
                }}
              />
            </div>
          </Surface>
        </section>
      )}

      {(onboarding.state === "audit_preparing" || onboarding.state === "audit_running") && (
        <section className="flex flex-col gap-6">
          <header className="flex flex-col gap-3">
            <MonoLabel>Audit</MonoLabel>
            <h1 className="text-fg text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[3rem]">
              Now Vibe is looking at the business around it.
            </h1>
          </header>
          {onboarding.auditOperation ? (
            <>
              <OperationWatcher projectId={projectId} operation={onboarding.auditOperation} />
              {onboarding.auditOperation.stage === "running_ai" ? <AuditAnalyzing /> : <AuditPreparing />}
            </>
          ) : auditReadiness && !auditReadiness.hasLiveProductIntelligence ? (
            <AuditLivePrerequisite projectId={projectId} />
          ) : onboarding.productProfile ? (
            <StartAudit projectId={projectId} profileId={onboarding.productProfile.stored.id} />
          ) : null}
        </section>
      )}

      {onboarding.state === "audit_needs_user" && onboarding.pausedAudit && (
        <section className="flex flex-col gap-5">
          <AuditWaitingHeader />
          <NeedsUserPanel projectId={projectId} question={onboarding.pausedAudit.question} />
        </section>
      )}

      {onboarding.state === "audit_reveal" && onboarding.audit?.result && (
        <OnboardingAuditReveal audit={onboarding.audit.result} projectId={projectId} />
      )}

      {onboarding.state === "first_move" && (
        <section className="flex max-w-[52rem] flex-col gap-8 py-4">
          <OperationWatcher projectId={projectId} operation={opportunityOperation} />
          <header className="flex flex-col gap-3">
            <MonoLabel>First move</MonoLabel>
            <h1 className="text-fg text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[3rem]">
              Vibe knows what your business needs next.
            </h1>
          </header>

          {onboarding.opportunities?.set.opportunities[0] ? (
            <Surface level="card" padding="lg" className="border-mint/30 flex flex-col gap-4 border">
              <MonoLabel className="text-mint">This is where I&apos;d start</MonoLabel>
              <h2 className="text-fg text-2xl font-semibold">{onboarding.opportunities.set.opportunities[0].title}</h2>
              <p className="text-fg-prose leading-relaxed">{onboarding.opportunities.set.opportunities[0].problem}</p>
              <div className="border-line-2 border-t pt-4">
                <p className="text-fg-meta mb-1 text-xs">Why this comes first</p>
                <p className="text-fg-secondary text-sm leading-relaxed">{onboarding.opportunities.set.opportunities[0].whyNow}</p>
              </div>
            </Surface>
          ) : opportunityOperation ? (
            <Surface level="card" padding="lg" className="flex flex-col gap-3" role="status">
              <h2 className="text-fg text-xl font-semibold">Vibe is finding your highest-impact opportunity.</h2>
              <p className="text-fg-muted text-sm">You can leave and come back. No Move will be invented while this runs.</p>
            </Surface>
          ) : (
            <Notice tone="info" label="Your Audit is ready">
              Vibe knows where the business needs attention first. No actual Next Move is available yet, so onboarding will not pretend one exists.
            </Notice>
          )}

          {!opportunityOperation && (
            <Surface level="section" padding="lg" className="flex flex-col gap-4">
              <h2 className="text-fg text-xl font-semibold">Vibe knows your product.</h2>
              <p className="text-fg-prose">Your Product Profile is confirmed and your first Business Audit is ready. You can now enter the normal workspace.</p>
              <form action={completeOnboardingAction.bind(null, projectId)}>
                <button type="submit" className={buttonClasses()}>
                  Go to dashboard
                </button>
              </form>
            </Surface>
          )}
        </section>
      )}
    </OnboardingShell>
  );
}
