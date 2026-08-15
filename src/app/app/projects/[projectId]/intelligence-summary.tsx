import type {
  BusinessSurfaceSignal,
  Detection,
  Evidence,
  IntegrationSignal,
  RepositoryIntelligenceSnapshot,
} from "@/modules/repository-intelligence/schema";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * Repository intelligence display (Sprint 2 §23, §24).
 *
 * Deliberately a compact summary, not a JSON dump: a handful of named
 * detections, the routes, and the counts that explain how much of the
 * repository was actually looked at. Evidence is available per detection
 * through a native <details>, so "why did it say Next.js?" is one click
 * away without cluttering the default view.
 *
 * Evidence is always a path or a dependency name — never a line of
 * source (Sprint 2 §24).
 */

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null;

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg-secondary">Detected from</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {evidence.slice(0, 6).map((item, index) => (
          <li key={`${item.path}-${index}`} className="text-xs text-fg-muted">
            <code className="text-fg-secondary">{item.path}</code>
            {item.detail ? <span className="text-fg-meta"> · {item.detail}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DetectionRow({ detection }: { detection: Detection | IntegrationSignal }) {
  return (
    <li className="py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-fg-body">{detection.name}</span>
        <span className="text-xs text-fg-meta">{detection.confidence} confidence</span>
      </div>
      <EvidenceList evidence={detection.evidence} />
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

const SIGNAL_SECTIONS: { category: IntegrationSignal["category"]; title: string }[] = [
  { category: "deployment", title: "Deployment" },
  { category: "database", title: "Database" },
  { category: "auth", title: "Auth" },
  { category: "payments", title: "Payments" },
  { category: "analytics", title: "Analytics" },
  { category: "monitoring", title: "Monitoring" },
];

function SurfaceRow({ surface }: { surface: BusinessSurfaceSignal }) {
  return (
    <li className="py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={surface.detected ? "text-sm text-fg-body" : "text-sm text-fg-meta"}>
          {surface.name}
        </span>
        <span className={surface.detected ? "text-xs text-mint" : "text-xs text-fg-meta"}>
          {surface.detected ? "detected" : "not detected"}
        </span>
      </div>
      {surface.detected && <EvidenceList evidence={surface.evidence} />}
    </li>
  );
}

export function IntelligenceSummary({
  snapshot,
  analyzedAt,
}: {
  snapshot: RepositoryIntelligenceSnapshot;
  analyzedAt: string;
}) {
  const shortSha = snapshot.source.commitSha.slice(0, 7);
  const stack = [...snapshot.frameworks, ...snapshot.languages];
  const pageRoutes = snapshot.routes.routes.filter((route) => route.kind === "page");
  const detectedSurfaces = snapshot.businessSurfaces.filter((surface) => surface.detected);
  const undetectedSurfaces = snapshot.businessSurfaces.filter((surface) => !surface.detected);

  return (
    <div className="space-y-5 rounded-md border border-line-2 p-4">
      <div className="space-y-0.5">
        <h3 className="text-fg-body text-sm font-medium">Repository intelligence</h3>
        <p className="text-xs text-fg-muted">
          Analyzed at commit <code className="text-fg-secondary">{shortSha}</code> on {snapshot.source.branch} ·{" "}
          {formatTimestamp(analyzedAt) ?? analyzedAt}
        </p>
      </div>

      {stack.length > 0 && (
        <Section title="Stack">
          <ul className="divide-y divide-line-1">
            {stack.map((detection) => (
              <DetectionRow key={`${detection.id}`} detection={detection} />
            ))}
          </ul>
        </Section>
      )}

      {SIGNAL_SECTIONS.map(({ category, title }) => {
        const signals = snapshot.integrationSignals.filter((signal) => signal.category === category);
        if (signals.length === 0) return null;
        return (
          <Section key={category} title={title}>
            <ul className="divide-y divide-line-1">
              {signals.map((signal) => (
                <DetectionRow key={signal.id} detection={signal} />
              ))}
            </ul>
          </Section>
        );
      })}

      <Section title="Product signals">
        <ul className="divide-y divide-line-1">
          {detectedSurfaces.map((surface) => (
            <SurfaceRow key={surface.id} surface={surface} />
          ))}
        </ul>
        {undetectedSurfaces.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg-secondary">
              {undetectedSurfaces.length} not detected
            </summary>
            <ul className="mt-1 divide-y divide-line-1">
              {undetectedSurfaces.map((surface) => (
                <SurfaceRow key={surface.id} surface={surface} />
              ))}
            </ul>
          </details>
        )}
      </Section>

      {snapshot.projectStructure.monorepo.detected && (
        <Section title="Monorepo">
          <p className="text-sm text-fg-prose">
            {snapshot.projectStructure.monorepo.tool ?? "Workspace layout"} detected
          </p>
          {snapshot.projectStructure.monorepo.apps.length > 0 && (
            <ul className="pl-3">
              {snapshot.projectStructure.monorepo.apps.map((app) => (
                <li key={app} className="text-xs text-fg-muted">
                  <code className="text-fg-secondary">{app}</code>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Routes">
        {snapshot.routes.mode === "limited" ? (
          <p className="text-sm text-fg-muted">
            Route detection is limited for this framework — routes are defined in code rather than by file
            structure.
          </p>
        ) : pageRoutes.length === 0 ? (
          <p className="text-sm text-fg-muted">No page routes detected.</p>
        ) : (
          <ul className="space-y-0.5">
            {pageRoutes.slice(0, 25).map((route) => (
              <li key={route.sourcePath} className="text-sm text-fg-prose">
                <code>{route.path}</code>
              </li>
            ))}
            {pageRoutes.length > 25 && (
              <li className="text-xs text-fg-meta">and {pageRoutes.length - 25} more</li>
            )}
          </ul>
        )}
      </Section>

      <Section title="Repository">
        <p className="text-sm text-fg-secondary">
          {snapshot.projectStructure.sourceFileCount} source files considered ·{" "}
          {snapshot.metrics.filesFetched} inspected
        </p>
        <p className="text-xs text-fg-muted">
          {snapshot.completeness.status === "complete"
            ? "Analysis complete"
            : `Analysis partial (${snapshot.completeness.reasons.join(", ")})`}
        </p>
      </Section>
    </div>
  );
}
