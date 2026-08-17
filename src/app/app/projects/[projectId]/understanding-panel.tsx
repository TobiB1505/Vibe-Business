import Link from "next/link";
import { ProductLogo } from "@/components/brand/product-logo";
import { VibeMark } from "@/components/brand/vibe-mark";
import { buttonClasses } from "@/components/ui/button";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { projectSectionHref } from "@/components/layout/project-shell";
import type { ConfidenceTone, UnderstandingView } from "@/modules/product-understanding/view";

/**
 * The final understanding screen (CORE-1 §31, §34, §35, §45, §46).
 *
 * ## Reading order
 *
 * Conclusion → identity → capabilities → brand → evidence → technical.
 *
 * That order is the sprint's central product claim rendered as a layout: a
 * founder should be impressed because Vibe understood what they built, not
 * because it counted their files. So the paragraph about their product is the
 * first thing on the page, the scanners are a disclosure near the bottom, and
 * the framework name is under a second disclosure below that.
 *
 * ## Every string here comes from the view model
 *
 * Nothing in this file decides what to claim. Confidence wording, source
 * wording, absence wording and the logo decision are all made in
 * `view.ts`, where they are tested. This file is layout.
 */

const TONE_TEXT: Record<ConfidenceTone, string> = {
  confirmed: "text-fg-body",
  likely: "text-fg-prose",
  unknown: "text-fg-muted",
};

const TONE_MARK: Record<ConfidenceTone, string> = {
  confirmed: "text-mint",
  likely: "text-fg-secondary",
  unknown: "text-fg-meta",
};

/** The glyph is decorative — every row states its confidence in words too. */
const TONE_GLYPH: Record<ConfidenceTone, string> = {
  confirmed: "✓",
  likely: "~",
  unknown: "—",
};

export function UnderstandingPanel({
  view,
  projectId,
  confirmedAt,
  actions,
}: {
  view: UnderstandingView;
  projectId: string;
  confirmedAt: string | null;
  /** The confirm/edit controls. Passed in so this stays a server component. */
  actions: React.ReactNode;
}) {
  const { headline, brand } = view;

  return (
    <div className="flex flex-col gap-6">
      {/* ── The conclusion ─────────────────────────────────────────── */}
      <Surface level="card" padding="lg" className="flex flex-col items-center gap-6 text-center">
        {brand.logo ? (
          // A real asset, or the Vibe mark if the browser cannot load it. The
          // fallback lives in `ProductLogo` because only the browser knows
          // whether a URL on the customer's own origin resolves (UI-S1 §18).
          <ProductLogo src={brand.logo.url} alt={brand.logo.alt} size={40} />
        ) : (
          <VibeMark size={40} />
        )}

        <div className="flex flex-col gap-3">
          <h2 className="text-fg text-headline font-bold">{headline.title}</h2>
          {headline.productName && (
            <p className="text-fg-body text-title font-semibold">{headline.productName}</p>
          )}
          {headline.understanding && (
            <p className="text-fg-prose mx-auto max-w-[62ch] text-base leading-relaxed">
              {headline.understanding}
            </p>
          )}
        </div>

        {headline.synthesisNote && (
          <p className="text-fg-muted max-w-[62ch] text-sm">{headline.synthesisNote}</p>
        )}

        {confirmedAt === null ? (
          <div className="border-line-2 flex w-full flex-col items-center gap-4 border-t pt-6">
            {/* A heading, not a styled paragraph: it labels the confirm
                controls below it, so it belongs in the document outline for
                anyone navigating by heading (CORE-1 §54). */}
            <h3 className="text-fg-body text-base font-semibold">Did I get this right?</h3>
            {actions}
          </div>
        ) : (
          <p className="text-mint font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
            You confirmed this
          </p>
        )}
      </Surface>

      {/* ── Who it's for ───────────────────────────────────────────── */}
      {view.audience.length > 0 && (
        <Surface level="panel" padding="lg" className="flex flex-col gap-4">
          <MonoLabel>Who it&apos;s for</MonoLabel>
          <dl className="flex flex-col gap-4">
            {view.audience.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-1">
                <dt className="text-fg-muted text-xs">{fact.label}</dt>
                <dd className={`${TONE_TEXT[fact.tone]} text-sm`}>{fact.value}</dd>
                <p className="text-fg-meta font-mono text-[0.6875rem]">{fact.note}</p>
              </div>
            ))}
          </dl>
        </Surface>
      )}

      {/* ── What people can do ─────────────────────────────────────── */}
      {view.capabilities.length > 0 && (
        <Surface level="panel" padding="lg" className="flex flex-col gap-4">
          <MonoLabel>What people can do</MonoLabel>
          <ul className="flex flex-col gap-2.5">
            {view.capabilities.map((capability) => (
              // Stacked on a phone, one line from `sm` up. The note is a full
              // sentence ("Likely, based on several signals" measures 211px),
              // so holding it on the same row as the label is what pushed a
              // 375px screen sideways — a browser with a classic scrollbar
              // leaves ~360px of content width, and `shrink-0` refused to give
              // any of it back.
              <li
                key={capability.id}
                className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <span className={`${TONE_TEXT[capability.tone]} flex items-baseline gap-2.5 text-sm`}>
                  <span aria-hidden className={`${TONE_MARK[capability.tone]} text-xs`}>
                    {TONE_GLYPH[capability.tone]}
                  </span>
                  {capability.label}
                </span>
                <span className="text-fg-meta pl-6 font-mono text-[0.6875rem] sm:shrink-0 sm:pl-0">
                  {capability.note}
                </span>
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {/* ── How it appears to work ─────────────────────────────────── */}
      <Surface level="panel" padding="lg" className="flex flex-col gap-4">
        <MonoLabel>How the product appears to work</MonoLabel>
        <ol className="flex flex-col gap-3">
          {view.journey.map((stage) => (
            <li key={stage.id} className="flex flex-col gap-0.5">
              <span className="text-fg-body text-sm font-semibold">{stage.label}</span>
              <span className={`${TONE_TEXT[stage.tone]} text-sm`}>{stage.detail}</span>
            </li>
          ))}
        </ol>
      </Surface>

      {/* ── Brand ──────────────────────────────────────────────────── */}
      {!brand.empty && (
        <Surface level="panel" padding="lg" className="flex flex-col gap-5">
          <MonoLabel>Your brand</MonoLabel>

          {brand.colors.length > 0 && (
            <ul className="flex flex-wrap gap-4">
              {brand.colors.map((color) => (
                <li key={`${color.role}-${color.value}`} className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="border-line-strong size-6 shrink-0 rounded-full border"
                    style={{ backgroundColor: color.value }}
                  />
                  <span className="flex flex-col">
                    <span className="text-fg-body font-mono text-[0.75rem]">{color.value}</span>
                    <span className="text-fg-meta text-[0.6875rem]">{color.role}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {brand.typefaces.length > 0 && (
            <ul className="flex flex-wrap gap-x-8 gap-y-2">
              {brand.typefaces.map((typeface) => (
                <li key={`${typeface.role}-${typeface.family}`} className="flex flex-col">
                  <span className="text-fg-body text-sm">{typeface.family}</span>
                  <span className="text-fg-meta text-[0.6875rem]">{typeface.role}</span>
                </li>
              ))}
            </ul>
          )}

          {brand.tone && (
            <p className="text-fg-prose text-sm">
              Your product writes in a <span className="text-fg-body">{brand.tone}</span> voice.
            </p>
          )}

          {brand.phrases.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-fg-muted text-xs">Words your product repeats</span>
              <ul className="flex flex-wrap gap-2">
                {brand.phrases.map((phrase) => (
                  <li
                    key={phrase}
                    className="bg-surface-hover border-line-4 text-fg-prose rounded-full border px-2.5 py-1 text-[0.75rem]"
                  >
                    {phrase}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brand.logoNote && <p className="text-fg-meta text-xs">{brand.logoNote}</p>}
        </Surface>
      )}

      {/* ── What Vibe used ─────────────────────────────────────────── */}
      <Surface level="section" padding="lg" className="flex flex-col gap-4">
        <MonoLabel>What Vibe used</MonoLabel>
        <ul className="flex flex-col gap-1.5">
          {view.sources.map((source) => (
            <li
              key={source.label}
              className={`${source.used ? "text-fg-prose" : "text-fg-muted"} flex items-baseline gap-2.5 text-sm`}
            >
              <span aria-hidden className={source.used ? "text-mint text-xs" : "text-fg-meta text-xs"}>
                {source.used ? "✓" : "○"}
              </span>
              {source.label}
            </li>
          ))}
        </ul>

        {view.limitations.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {view.limitations.map((limitation) => (
              <li key={limitation} className="text-fg-muted text-xs">
                {limitation}
              </li>
            ))}
          </ul>
        )}

        {/* The scanners are not deleted — they are ordered behind the answer
            (CORE-1 §35). Both remain reachable, as evidence. */}
        <Disclosure label="See what Vibe found">
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {view.businessSignals.map((signal) => (
                <li key={signal.id} className={`${TONE_TEXT[signal.tone]} text-sm`}>
                  {signal.statement}
                </li>
              ))}
            </ul>
            <Link
              href={projectSectionHref(projectId, "overview")}
              className="text-fg-muted hover:text-fg-body w-fit rounded-sm text-xs underline underline-offset-4 transition-colors"
            >
              Code and public product findings
            </Link>
          </div>
        </Disclosure>

        {view.technical.length > 0 && (
          <TechnicalDetails
            label="Technical details"
            entries={view.technical.map((row) => ({ key: row.label, value: row.value }))}
          />
        )}
      </Surface>

      {/* ── The next step ──────────────────────────────────────────── */}
      <Surface level="panel" tone="mint" padding="lg" className="flex flex-col gap-3">
        <h3 className="text-fg text-base font-semibold">
          Now let&apos;s see how strong the business around it is.
        </h3>
        <p className="text-fg-prose max-w-[62ch] text-sm">
          Vibe understands your product. The next step looks at what it would take to turn it into
          a business.
        </p>
        <div>
          <Link
            href={projectSectionHref(projectId, "business-audit")}
            className={buttonClasses({ variant: "accent" })}
          >
            Run my business audit
          </Link>
        </div>
      </Surface>
    </div>
  );
}
