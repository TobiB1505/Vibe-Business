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
      <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400">Detected from</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {evidence.slice(0, 6).map((item, index) => (
          <li key={`${item.path}-${index}`} className="text-xs text-zinc-500">
            <code className="text-zinc-400">{item.path}</code>
            {item.detail ? <span className="text-zinc-600"> · {item.detail}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function SurfaceRow({ surface }: { surface: ProductSurfaceSignal }) {
  return (
    <li className="py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={surface.detected ? "text-sm text-zinc-200" : "text-sm text-zinc-600"}>
          {surface.name}
        </span>
        <span className={surface.detected ? "text-xs text-emerald-400" : "text-xs text-zinc-600"}>
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
      <span className={signal.present ? "text-sm text-zinc-300" : "text-sm text-zinc-600"}>
        {signal.name}
      </span>
      <span className={signal.present ? "text-xs text-emerald-400" : "text-xs text-zinc-600"}>
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
    <div className="space-y-5 rounded-md border border-zinc-800 p-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-zinc-200">Live product intelligence</h2>
        <p className="text-xs text-zinc-500">
          {snapshot.source.effectiveOrigin} · analyzed {formatTimestamp(analyzedAt) ?? analyzedAt}
        </p>
        {snapshot.source.redirected && (
          <p className="text-xs text-zinc-500">
            The configured URL redirected to <code className="text-zinc-400">{snapshot.source.effectiveOrigin}</code>
            .
          </p>
        )}
      </div>

      <Section title="Site">
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-zinc-500">Title</dt>
            <dd className="text-zinc-200">{snapshot.siteMetadata.title ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-zinc-500">Description</dt>
            <dd className="text-zinc-300">{snapshot.siteMetadata.description ?? "—"}</dd>
          </div>
          {snapshot.siteMetadata.language && (
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-zinc-500">Language</dt>
              <dd className="text-zinc-300">{snapshot.siteMetadata.language}</dd>
            </div>
          )}
        </dl>
      </Section>

      <Section title="Product surfaces">
        {detectedSurfaces.length === 0 ? (
          <p className="text-sm text-zinc-500">No product surfaces detected.</p>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {detectedSurfaces.map((surface) => (
              <SurfaceRow key={surface.id} surface={surface} />
            ))}
          </ul>
        )}
        {undetectedSurfaces.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400">
              {undetectedSurfaces.length} not detected
            </summary>
            <ul className="mt-1 divide-y divide-zinc-900">
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
            <span className="text-zinc-500">Primary CTA</span>
            <span className="text-zinc-200">
              {conversionSignals.primaryCta ? conversionSignals.primaryCta.label : "none detected"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-zinc-500">Signup CTA</span>
            <span className={conversionSignals.signupCtaPresent ? "text-emerald-400" : "text-zinc-600"}>
              {conversionSignals.signupCtaPresent ? "present" : "—"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-zinc-500">Pricing CTA</span>
            <span className={conversionSignals.pricingCtaPresent ? "text-emerald-400" : "text-zinc-600"}>
              {conversionSignals.pricingCtaPresent ? "present" : "—"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-zinc-500">Contact CTA</span>
            <span className={conversionSignals.contactCtaPresent ? "text-emerald-400" : "text-zinc-600"}>
              {conversionSignals.contactCtaPresent ? "present" : "—"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-zinc-500">Forms</span>
            <span className="text-zinc-300">{conversionSignals.formCount}</span>
          </li>
        </ul>

        {conversionSignals.forms.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400">
              Form details
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {conversionSignals.forms.map((form, index) => (
                <li key={`${form.path}-${index}`} className="text-xs text-zinc-500">
                  {FORM_KIND_LABELS[form.kind] ?? form.kind} on <code className="text-zinc-400">{form.path}</code>{" "}
                  <span className="text-zinc-600">
                    · {form.fieldCount} field{form.fieldCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="SEO foundations">
        <ul className="divide-y divide-zinc-900">
          {snapshot.seoSignals.map((signal) => (
            <SeoRow key={signal.id} signal={signal} />
          ))}
        </ul>
      </Section>

      <Section title="Pages inspected">
        <p className="text-sm text-zinc-300">{snapshot.crawl.pagesInspected}</p>
        <ul className="space-y-0.5 pt-1">
          {snapshot.pages.slice(0, 20).map((page) => (
            <li key={page.path} className="text-sm text-zinc-400">
              <code>{page.path}</code>
              {page.redirectedTo && (
                <span className="text-xs text-amber-500/80"> → {page.redirectedTo}</span>
              )}
              {page.title && <span className="text-xs text-zinc-600"> · {page.title}</span>}
            </li>
          ))}
        </ul>
      </Section>

      {snapshot.warnings.length > 0 && (
        <Section title="Notes">
          <ul className="space-y-0.5">
            {snapshot.warnings.map((warning) => (
              <li key={warning.code} className="text-xs text-zinc-500">
                {warning.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Completeness">
        <p className="text-xs text-zinc-500">
          {snapshot.completeness.status === "complete"
            ? "Analysis complete"
            : `Analysis partial (${snapshot.completeness.reasons.join(", ")})`}
        </p>
        <p className="text-xs text-zinc-600">
          {snapshot.metrics.requestCount} requests · {Math.round(snapshot.metrics.bytesFetched / 1024)} KB ·{" "}
          {snapshot.metrics.durationMs} ms
        </p>
      </Section>
    </div>
  );
}
