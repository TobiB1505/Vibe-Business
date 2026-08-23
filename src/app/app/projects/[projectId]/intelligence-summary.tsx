import Link from "next/link";
import { projectSectionHref } from "@/components/layout/project-shell";
import { Disclosure, FoundList, TechnicalDetails } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/states";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { buildIntelligenceCrossChecks } from "@/modules/repository-intelligence/cross-check";
import {
  buildRepositoryHumanView,
  CAPABILITY_STATUS_LABELS,
  CONFIDENCE_DISCLAIMER,
  type CapabilityNextStep,
  type CapabilityStatus,
  type CapabilityTone,
  type RepositoryCapability,
} from "@/modules/repository-intelligence/human-view";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";

/**
 * What Vibe learned from your code (Sprint UI-3.6).
 *
 * This screen used to open with "Stack", "Deployment", "Database", "Auth",
 * "Payments" and a list of routes — the analyzer's own output, arranged by the
 * analyzer's own taxonomy. It was accurate, and it asked someone who has never
 * written a line of code to work out what 34 routes and a Stripe dependency
 * mean for their business.
 *
 * It now reads: what Vibe understood, what already exists, what needs checking,
 * what Vibe couldn't find, and only then paths, package names and scan counts.
 *
 * Nothing was deleted. `buildRepositoryHumanView` carries every detection id,
 * confidence, evidence path and metric into the technical layer, and the
 * detectors that produce them are untouched (§40).
 */

/** The anchor the live product check renders at on the overview route. */
export const LIVE_PRODUCT_ANCHOR = "live-product-check";

const TONE_DOT: Record<CapabilityTone, string> = {
  good: "bg-mint",
  attention: "bg-amber",
  neutral: "bg-fg-meta",
};

/** The pill beside the dot, so a state is never carried by colour alone. */
const STATUS_TONE: Record<CapabilityStatus, StatusTone> = {
  likely: "success",
  partial: "waiting",
  unclear: "waiting",
  not_found: "neutral",
};

function nextStepHref(step: CapabilityNextStep, projectId: string): string {
  if (step.target === "next-moves") return projectSectionHref(projectId, "action-plan");
  if (step.target === "deep-scan") return projectSectionHref(projectId, "deep-scan");
  // The live check lives further down this same route, so this is a jump
  // rather than a navigation.
  return `#${LIVE_PRODUCT_ANCHOR}`;
}

function NextStepLink({ step, projectId }: { step: CapabilityNextStep; projectId: string }) {
  return (
    <Link
      href={nextStepHref(step, projectId)}
      className="text-fg-prose hover:text-fg w-fit rounded-sm text-sm underline underline-offset-4 transition-interactive"
    >
      {step.label}
    </Link>
  );
}

function Capability({
  capability,
  projectId,
}: {
  capability: RepositoryCapability;
  projectId: string;
}) {
  return (
    <div className="border-line-1 flex flex-col gap-3 border-b py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[capability.tone]}`} />
          <MonoLabel className="tracking-[0.14em]">{capability.name}</MonoLabel>
          <StatusPill tone={STATUS_TONE[capability.status]}>
            {CAPABILITY_STATUS_LABELS[capability.status]}
          </StatusPill>
        </div>
        <h4 className="text-fg text-[0.9375rem] font-semibold">{capability.title}</h4>
        <p className="text-fg-prose max-w-[70ch] text-sm leading-relaxed">{capability.basis}</p>
        {capability.whyItMatters && (
          <p className="text-fg-muted max-w-[70ch] text-sm leading-relaxed">
            <span className="text-fg-secondary">Why it matters: </span>
            {capability.whyItMatters}
          </p>
        )}
      </div>

      {(capability.found.length > 0 || capability.missing.length > 0) && (
        <Disclosure label="What Vibe found">
          <div className="flex flex-col gap-3">
            <FoundList found={capability.found} missing={capability.missing} label="In your code" />
            {capability.evidence.length > 0 && (
              // Level 3: the exact paths and package names. A person does not
              // need to understand the repository layout to read anything above.
              <TechnicalDetails label="Where in the code">
                <ul className="flex flex-col gap-1">
                  {capability.evidence.map((item) => (
                    <li
                      key={`${item.path}-${item.detail ?? ""}`}
                      className="text-fg-secondary [overflow-wrap:anywhere] font-mono text-meta"
                    >
                      {item.path}
                      {item.detail && <span className="text-fg-meta"> · {item.detail}</span>}
                    </li>
                  ))}
                </ul>
              </TechnicalDetails>
            )}
          </div>
        </Disclosure>
      )}

      {capability.nextStep && <NextStepLink step={capability.nextStep} projectId={projectId} />}
    </div>
  );
}

export function IntelligenceSummary({
  snapshot,
  analyzedAt,
  projectId,
  /**
   * The live product check, when one exists. Present only so the two layers
   * can be compared — this screen never renders live results itself.
   */
  liveSnapshot = null,
}: {
  snapshot: RepositoryIntelligenceSnapshot;
  analyzedAt: string;
  projectId: string;
  liveSnapshot?: LiveProductIntelligenceSnapshot | null;
}) {
  const view = buildRepositoryHumanView(snapshot);
  const crossChecks = buildIntelligenceCrossChecks(snapshot, liveSnapshot);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* The system's own name stays, one step down from the question it
            answers (§12). */}
        <MonoLabel>What Vibe learned from your code · Repository intelligence</MonoLabel>
        <h3 className="text-fg text-title font-bold">{view.headline}</h3>
        <p className="text-fg-muted max-w-[70ch] text-sm">{view.subhead}</p>
        {/* The line that keeps every "Likely" below honest, so it is set at
            the readable end of the muted ramp rather than the faint one. */}
        <p className="text-fg-muted max-w-[70ch] text-xs leading-relaxed">{CONFIDENCE_DISCLAIMER}</p>
      </div>

      {/* Real counts only — each is the length of a list rendered below. */}
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {[
          { label: "Already there", value: view.counts.exists },
          { label: "Needs checking", value: view.counts.needsChecking },
          { label: "Not found", value: view.counts.notFound },
        ].map((count) => (
          <div key={count.label} className="flex items-baseline gap-2">
            <dt className="text-fg-muted text-sm">{count.label}</dt>
            <dd className="text-fg font-mono text-sm font-semibold">{count.value}</dd>
          </div>
        ))}
      </dl>

      {/* An unfinished analysis says so before its results are read. */}
      {view.incompleteReason && (
        <Notice tone="waiting" label="This analysis did not finish">
          {view.incompleteReason}
        </Notice>
      )}

      {crossChecks.length > 0 && (
        <Notice tone="waiting" label="Your code and your live product disagree">
          <ul className="flex flex-col gap-3">
            {crossChecks.map((check) => (
              <li key={check.id} className="flex flex-col gap-1">
                <span className="text-fg font-semibold">{check.title}</span>
                <span className="text-fg-prose">{check.detail}</span>
                {check.nextStep && <NextStepLink step={check.nextStep} projectId={projectId} />}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {view.groups.map((group) => (
        <section key={group.id} aria-label={group.title} className="flex flex-col gap-3">
          <MonoLabel as="h4">{group.title}</MonoLabel>
          <Surface level="panel" padding="lg" className="flex flex-col">
            {group.capabilities.map((capability) => (
              <Capability key={capability.id} capability={capability} projectId={projectId} />
            ))}
          </Surface>
        </section>
      ))}

      <div className="flex flex-col gap-3">
        <p className="text-fg-prose text-sm">{view.stackSummary}</p>
        <p className="text-fg-meta font-mono text-meta">
          Code last read {formatTimestamp(analyzedAt) ?? analyzedAt}
        </p>

        {view.routePaths.length > 0 && (
          <Disclosure label={`Pages Vibe found in the code (${view.routePaths.length})`}>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {view.routePaths.map((path) => (
                <li key={path} className="text-fg-muted [overflow-wrap:anywhere] font-mono text-xs">
                  {path}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        {snapshot.warnings.length > 0 && (
          <Disclosure label={`Notes from this analysis (${snapshot.warnings.length})`}>
            <ul className="flex flex-col gap-1">
              {snapshot.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.path ?? ""}`} className="text-fg-muted text-xs leading-relaxed">
                  {warning.message}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        {/* Every detection, metric and identifier the analyzer produced. */}
        <TechnicalDetails entries={view.technical}>
          {view.stackNames.length > 0 && (
            <p className="text-fg-secondary [overflow-wrap:anywhere] font-mono text-meta">
              {view.stackNames.join(" · ")}
            </p>
          )}
        </TechnicalDetails>
      </div>
    </div>
  );
}
