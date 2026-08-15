import type {
  LiveEvidence,
  LiveProductIntelligenceSnapshot,
  ProductSurfaceSignal,
  SeoSignal,
} from "@/modules/live-product-intelligence/schema";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * Live product intelligence display (Sprint 3 §30).
 *
 * A compact summary, never a JSON dump: what the site says it is, which
 * surfaces exist, what the primary action appears to be, and which SEO
 * foundations are present. Evidence sits behind a native <details> so
 * "why did it say that?" is one click away without cluttering the page.
 *
 * Every string rendered here originates from a third-party website.
 * React escapes it, and nothing here is ever treated as markup or as
 * instructions (CLAUDE.md rule 25).
 */

function EvidenceList({ evidence }: { evidence: LiveEvidence[] }) {
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function SurfaceRow({ surface }: { surface: ProductSurfaceSignal }) {
  return (
    <li className="py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={surface.detected ? "text-sm text-fg-body" : "text-sm text-fg-meta"}>
          {surface.name}
        </span>
        <span className={surface.detected ? "text-xs text-mint" : "text-xs text-fg-meta"}>
          {surface.detected ? (surface.confidence === "high" ? "detected" : "likely") : "not detected"}
        </span>
      </div>
      {surface.detected && <EvidenceList evidence={surface.evidence} />}
    </li>
  );
}

function SeoRow({ signal }: { signal: SeoSignal }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <span className={signal.present ? "text-sm text-fg-prose" : "text-sm text-fg-meta"}>
        {signal.name}
      </span>
      <span className={signal.present ? "text-xs text-mint" : "text-xs text-fg-meta"}>
        {signal.present ? "present" : "—"}
      </span>
    </li>
  );
}

const FORM_KIND_LABELS: Record<string, string> = {
  login_like: "Login form",
  signup_like: "Signup form",
  contact_like: "Contact form",
  newsletter_like: "Newsletter form",
  search_like: "Search form",
  unknown: "Unclassified form",
};

export function LiveIntelligenceSummary({
  snapshot,
  analyzedAt,
}: {
  snapshot: LiveProductIntelligenceSnapshot;
  analyzedAt: string;
}) {
  const detectedSurfaces = snapshot.productSurfaces.filter((surface) => surface.detected);
  const undetectedSurfaces = snapshot.productSurfaces.filter((surface) => !surface.detected);
  const { conversionSignals } = snapshot;

  return (
    <div className="space-y-5 rounded-md border border-line-2 p-4">
      <div className="space-y-0.5">
        <h3 className="text-fg-body text-sm font-medium">Live product intelligence</h3>
        <p className="text-xs text-fg-muted">
          {snapshot.source.effectiveOrigin} · analyzed {formatTimestamp(analyzedAt) ?? analyzedAt}
        </p>
        {snapshot.source.redirected && (
          <p className="text-xs text-fg-muted">
            The configured URL redirected to <code className="text-fg-secondary">{snapshot.source.effectiveOrigin}</code>
            .
          </p>
        )}
      </div>

      <Section title="Site">
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-fg-muted">Title</dt>
            <dd className="text-fg-body">{snapshot.siteMetadata.title ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-fg-muted">Description</dt>
            <dd className="text-fg-prose">{snapshot.siteMetadata.description ?? "—"}</dd>
          </div>
          {snapshot.siteMetadata.language && (
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-fg-muted">Language</dt>
              <dd className="text-fg-prose">{snapshot.siteMetadata.language}</dd>
            </div>
          )}
        </dl>
      </Section>

      <Section title="Product surfaces">
        {detectedSurfaces.length === 0 ? (
          <p className="text-sm text-fg-muted">No product surfaces detected.</p>
        ) : (
          <ul className="divide-y divide-line-1">
            {detectedSurfaces.map((surface) => (
              <SurfaceRow key={surface.id} surface={surface} />
            ))}
          </ul>
        )}
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

      <Section title="Conversion">
        <ul className="space-y-1 text-sm">
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-fg-muted">Primary CTA</span>
            <span className="text-fg-body">
              {conversionSignals.primaryCta ? conversionSignals.primaryCta.label : "none detected"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-fg-muted">Signup CTA</span>
            <span className={conversionSignals.signupCtaPresent ? "text-mint" : "text-fg-meta"}>
              {conversionSignals.signupCtaPresent ? "present" : "—"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-fg-muted">Pricing CTA</span>
            <span className={conversionSignals.pricingCtaPresent ? "text-mint" : "text-fg-meta"}>
              {conversionSignals.pricingCtaPresent ? "present" : "—"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-fg-muted">Contact CTA</span>
            <span className={conversionSignals.contactCtaPresent ? "text-mint" : "text-fg-meta"}>
              {conversionSignals.contactCtaPresent ? "present" : "—"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-fg-muted">Forms</span>
            <span className="text-fg-prose">{conversionSignals.formCount}</span>
          </li>
        </ul>

        {conversionSignals.forms.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg-secondary">
              Form details
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {conversionSignals.forms.map((form, index) => (
                <li key={`${form.path}-${index}`} className="text-xs text-fg-muted">
                  {FORM_KIND_LABELS[form.kind] ?? form.kind} on <code className="text-fg-secondary">{form.path}</code>{" "}
                  <span className="text-fg-meta">
                    · {form.fieldCount} field{form.fieldCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="SEO foundations">
        <ul className="divide-y divide-line-1">
          {snapshot.seoSignals.map((signal) => (
            <SeoRow key={signal.id} signal={signal} />
          ))}
        </ul>
      </Section>

      <Section title="Pages inspected">
        <p className="text-sm text-fg-prose">{snapshot.crawl.pagesInspected}</p>
        <ul className="space-y-0.5 pt-1">
          {snapshot.pages.slice(0, 20).map((page) => (
            <li key={page.path} className="text-sm text-fg-secondary">
              <code>{page.path}</code>
              {page.redirectedTo && (
                <span className="text-xs text-amber/80"> → {page.redirectedTo}</span>
              )}
              {page.title && <span className="text-xs text-fg-meta"> · {page.title}</span>}
            </li>
          ))}
        </ul>
      </Section>

      {snapshot.warnings.length > 0 && (
        <Section title="Notes">
          <ul className="space-y-0.5">
            {snapshot.warnings.map((warning) => (
              <li key={warning.code} className="text-xs text-fg-muted">
                {warning.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Completeness">
        <p className="text-xs text-fg-muted">
          {snapshot.completeness.status === "complete"
            ? "Analysis complete"
            : `Analysis partial (${snapshot.completeness.reasons.join(", ")})`}
        </p>
        <p className="text-xs text-fg-meta">
          {snapshot.metrics.requestCount} requests · {Math.round(snapshot.metrics.bytesFetched / 1024)} KB ·{" "}
          {snapshot.metrics.durationMs} ms
        </p>
      </Section>
    </div>
  );
}
