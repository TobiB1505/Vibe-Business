import Link from "next/link";
import { ProductLogo } from "@/components/brand/product-logo";
import { VibeMark } from "@/components/brand/vibe-mark";
import { buttonClasses } from "@/components/ui/button";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { Surface } from "@/components/ui/surface";
import { projectSectionHref } from "@/components/layout/project-shell";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import {
  GOAL_LABELS,
  MONETIZATION_LABELS,
  STAGE_LABELS,
  type FounderIntent,
} from "@/modules/projects/founder-intent";
import type { ConfidenceTone, UnderstandingView } from "@/modules/product-understanding/view";

export type UnderstandingSource = {
  id: string;
  label: string;
  detail: string;
  ready: boolean;
  pending: string;
  href: string;
  action: string;
};

const TONE_TEXT: Record<ConfidenceTone, string> = {
  confirmed: "text-fg-body",
  likely: "text-fg-prose",
  unknown: "text-fg-muted",
};

const TONE_DOT: Record<ConfidenceTone, string> = {
  confirmed: "bg-mint shadow-[0_0_10px_rgb(0_229_160/0.55)]",
  likely: "bg-fg-muted",
  unknown: "bg-fg-disabled",
};

type ProductGlyphKind =
  | "purpose"
  | "audience"
  | "promise"
  | "problem"
  | "stage"
  | "money"
  | "goal"
  | "code"
  | "live"
  | "scan"
  | "intent";

function ProductGlyph({ kind, className = "size-5" }: { kind: ProductGlyphKind; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (kind === "purpose") return <svg {...common}><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" /></svg>;
  if (kind === "audience") return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5.5 21v-2.2A5.8 5.8 0 0 1 11.3 13h1.4a5.8 5.8 0 0 1 5.8 5.8V21" /></svg>;
  if (kind === "promise") return <svg {...common}><path d="M12 21s-7-4.4-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.6-7 11-7 11Z" /></svg>;
  if (kind === "problem") return <svg {...common}><circle cx="11" cy="11" r="6" /><path d="m15.5 15.5 4 4M11 8v3l2 1" /></svg>;
  if (kind === "stage") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="m12 6 2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z" /></svg>;
  if (kind === "money") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.8-.7-1.8-1-3-1-1.7 0-3 .9-3 2.2 0 3.4 6 1.4 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.4-3.5-1.2M12.5 5.5v13" /></svg>;
  if (kind === "goal") return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m14.2 9.8 5-5M16.5 4.8h2.7v2.7" /></svg>;
  if (kind === "code") return <svg {...common}><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" /></svg>;
  if (kind === "live") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21M12 3C9.7 5.5 8.5 8.5 8.5 12s1.2 6.5 3.5 9" /></svg>;
  if (kind === "scan") return <svg {...common}><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><circle cx="12" cy="12" r="3" /></svg>;
  return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M6 20v-1a6 6 0 0 1 12 0v1" /></svg>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-mint text-[0.68rem] font-semibold tracking-[0.12em] uppercase">{children}</p>;
}

function sourceKind(id: string): ProductGlyphKind {
  if (id === "code") return "code";
  if (id === "live") return "live";
  if (id === "deep-scan") return "scan";
  return "intent";
}

export function UnderstandingPanel({
  view,
  projectId,
  confirmedAt,
  understoodAt,
  founderIntent,
  founderContextHref,
  sources,
  actions,
}: {
  view: UnderstandingView;
  projectId: string;
  confirmedAt: string | null;
  understoodAt?: string | null;
  founderIntent?: FounderIntent;
  founderContextHref?: string;
  sources?: UnderstandingSource[];
  actions: React.ReactNode;
}) {
  const { headline, brand } = view;
  const sourceCount = sources?.filter((source) => source.ready).length ?? view.sources.filter((source) => source.used).length;
  const sourceTotal = sources?.length ?? view.sources.length;
  const understoodLabel = formatTimestamp(understoodAt);
  const context = founderIntent
    ? [
        { label: "Current stage", value: founderIntent.stage ? STAGE_LABELS[founderIntent.stage] : null, kind: "stage" as const },
        { label: "Monetization intent", value: founderIntent.monetizationModel ? MONETIZATION_LABELS[founderIntent.monetizationModel] : null, kind: "money" as const },
        { label: "What you're building toward", value: founderIntent.primaryGoal ? GOAL_LABELS[founderIntent.primaryGoal] : null, kind: "goal" as const },
      ]
    : [];

  const renderedSources: UnderstandingSource[] = sources ?? view.sources.map((source, index) => ({
    id: ["code", "live", "deep-scan"][index] ?? `source-${index}`,
    label: source.label,
    detail: source.label,
    ready: source.used,
    pending: source.label,
    href: "#product-evidence",
    action: "View evidence",
  }));

  return (
    <div className="flex flex-col gap-4" data-testid="product-understanding-dashboard">
      <Surface level="card" padding="none" className="overflow-hidden">
        <div className="grid min-h-[20rem] lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)]">
          <div className="flex min-w-0 flex-col justify-between gap-8 p-6 sm:p-7 lg:p-8">
            <div>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="border-line-2 bg-surface-3 flex size-20 shrink-0 items-center justify-center rounded-2xl border">
                  {brand.logo ? <ProductLogo src={brand.logo.url} alt={brand.logo.alt} size={56} /> : <VibeMark size={52} />}
                </div>
                <div className="min-w-0">
                  <SectionLabel>Product profile</SectionLabel>
                  <h2 className="text-fg mt-2 text-[clamp(1.75rem,3vw,2.45rem)] leading-none font-semibold tracking-[-0.045em]">
                    {headline.productName ?? headline.title}
                  </h2>
                  {headline.category && <span className="border-line-2 bg-surface-3 text-fg-secondary mt-4 inline-flex min-h-7 items-center rounded-full border px-3 text-xs">{headline.category}</span>}
                </div>
              </div>

              {headline.understanding ? <p className="text-fg-prose mt-7 max-w-[58ch] text-base leading-7 sm:text-[1.05rem]">{headline.understanding}</p> : <p className="text-fg-muted mt-7 max-w-[58ch] text-base leading-7">{headline.title}</p>}
              {headline.synthesisNote && <p className="text-fg-muted mt-3 max-w-[58ch] text-sm leading-6">{headline.synthesisNote}</p>}
            </div>

            <div className="border-line-1 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-5 text-xs">
              {headline.understanding && <span className="text-fg-secondary flex items-center gap-2"><span className="bg-mint size-2 rounded-full" aria-hidden />{headline.title}</span>}
              {understoodLabel && <span className="text-fg-meta">Last understood {understoodLabel}</span>}
            </div>
          </div>

          <div className="border-line-1 bg-[radial-gradient(circle_at_50%_30%,rgb(0_229_160/0.1),transparent_48%),linear-gradient(145deg,rgb(255_255_255/0.025),transparent)] flex min-h-[18rem] flex-col justify-between border-t p-6 lg:border-t-0 lg:border-l lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-fg text-sm font-semibold">Vibe&apos;s product read</p><p className="text-fg-muted mt-1 max-w-xs text-sm leading-6">A compact identity assembled from the sources Vibe could actually reach.</p></div>
              <span className="border-mint/20 bg-mint/[0.06] text-mint flex size-11 shrink-0 items-center justify-center rounded-full border"><ProductGlyph kind="scan" className="size-6" /></span>
            </div>
            <div className="my-8 flex min-h-28 items-center justify-center">
              <div className="relative flex size-28 items-center justify-center rounded-full border border-mint/25 bg-[radial-gradient(circle_at_35%_25%,rgb(255_255_255/0.12),transparent_25%),rgb(0_229_160/0.055)] shadow-[0_0_50px_rgb(0_229_160/0.12)]">
                {brand.logo ? <ProductLogo src={brand.logo.url} alt="" size={54} /> : <VibeMark size={52} />}
                <span className="border-app bg-mint absolute -right-1 bottom-3 size-4 rounded-full border-[3px]" aria-hidden />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="border-line-1 bg-surface-2 rounded-xl border p-3"><span className="text-fg text-xl font-semibold tabular-nums">{view.capabilities.length}</span><p className="text-fg-meta mt-1 text-xs">supported capabilities</p></div>
              <div className="border-line-1 bg-surface-2 rounded-xl border p-3"><span className="text-fg text-xl font-semibold tabular-nums">{sourceCount}/{sourceTotal}</span><p className="text-fg-meta mt-1 text-xs">sources available</p></div>
            </div>
          </div>
        </div>
      </Surface>

      <Surface level="panel" padding="lg" className="flex flex-col gap-5">
        <SectionLabel>Product DNA</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {view.dna.map((fact) => (
            <article key={fact.id} className="border-line-1 bg-surface-2 flex min-h-48 flex-col rounded-xl border p-4">
              <div className="text-mint flex size-10 items-center justify-center rounded-xl border border-mint/20 bg-mint/[0.055]"><ProductGlyph kind={fact.id} /></div>
              <h3 className="text-fg mt-4 text-sm font-semibold">{fact.label}</h3>
              <p className={`${TONE_TEXT[fact.tone]} mt-2 flex-1 text-sm leading-6`}>{fact.value}</p>
              <p className="text-fg-meta mt-4 flex items-center gap-2 text-[0.7rem]"><span className={`${TONE_DOT[fact.tone]} size-1.5 rounded-full`} aria-hidden />{fact.note}</p>
            </article>
          ))}
        </div>
      </Surface>

      {founderIntent && (
        <Surface id="founder-context" level="panel" padding="lg" className="scroll-mt-32 flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>Founder context</SectionLabel>
            {founderContextHref && <Link href={founderContextHref} className="border-line-2 text-fg-secondary hover:border-line-strong hover:text-fg inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs transition-interactive focus-visible:ring-2 focus-visible:ring-mint"><span aria-hidden>✎</span> Edit founder context</Link>}
          </div>
          <dl className="grid gap-0 md:grid-cols-3 md:divide-x md:divide-line-1">
            {context.map((item) => (
              <div key={item.label} className="border-line-1 flex gap-4 border-b py-4 first:pt-0 last:border-b-0 last:pb-0 md:border-b-0 md:px-5 md:py-0 md:first:pl-0 md:last:pr-0">
                <span className="border-mint/15 bg-mint/[0.045] text-mint flex size-10 shrink-0 items-center justify-center rounded-full border"><ProductGlyph kind={item.kind} /></span>
                <div><dt className="text-fg text-sm font-semibold">{item.label}</dt><dd className={item.value ? "text-fg-prose mt-2 text-sm leading-6" : "text-fg-muted mt-2 text-sm leading-6"}>{item.value ?? "Not specified yet."}</dd></div>
              </div>
            ))}
          </dl>
          <p className="text-fg-meta border-line-1 border-t pt-4 text-xs">Founder context tells Vibe what evidence cannot: where you are and what you want to do next.</p>
        </Surface>
      )}

      <Surface level="panel" padding="lg" className="grid gap-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <div className="min-w-0">
          <SectionLabel>What Vibe discovered</SectionLabel>
          <h3 className="text-fg mt-3 text-base font-semibold">Product capabilities</h3>
          {view.capabilities.length > 0 ? (
            <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {view.capabilities.map((capability) => (
                <li key={capability.id} className="flex gap-3 text-sm">
                  <span className="border-mint/20 bg-mint/[0.06] text-mint mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem]" aria-hidden>✓</span>
                  <span className="min-w-0"><span className={TONE_TEXT[capability.tone]}>{capability.label}</span><span className="text-fg-meta mt-0.5 block text-[0.68rem]">{capability.note}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-fg-muted mt-4 text-sm">Vibe could not establish a supported capability yet.</p>}
        </div>
        <div className="border-line-1 min-w-0 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
          <h3 className="text-fg text-sm font-semibold">Product journey</h3>
          <ol className="mt-5 flex flex-col gap-0">
            {view.journey.map((stage, index) => (
              <li key={stage.id} className="relative flex gap-3 pb-4 last:pb-0">
                {index < view.journey.length - 1 && <span className="bg-line-2 absolute top-5 bottom-0 left-[0.35rem] w-px" aria-hidden />}
                <span className={`relative z-10 mt-0.5 size-3 shrink-0 rounded-full border-2 border-app ${stage.tone === "confirmed" ? "bg-mint" : stage.tone === "likely" ? "bg-fg-muted" : "bg-fg-disabled"}`} aria-hidden />
                <span className="min-w-0"><span className="text-fg-secondary block text-xs font-medium">{stage.label}</span><span className={`${TONE_TEXT[stage.tone]} mt-0.5 block text-xs leading-5`}>{stage.detail}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </Surface>

      <Surface level="panel" padding="lg" className="flex flex-col gap-5">
        <SectionLabel>Brand &amp; visual identity</SectionLabel>
        {!brand.empty ? (
          <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1.2fr)_minmax(12rem,0.7fr)_minmax(12rem,0.8fr)] md:divide-x md:divide-line-1">
            <div className="pr-2"><p className="text-fg-muted text-xs">Logo</p><div className="border-line-2 bg-surface-2 mt-3 flex size-20 items-center justify-center rounded-xl border">{brand.logo ? <ProductLogo src={brand.logo.url} alt="" size={52} /> : <VibeMark size={48} />}</div>{brand.logoNote && <p className="text-fg-meta mt-2 max-w-36 text-[0.68rem] leading-5">{brand.logoNote}</p>}</div>
            <div className="md:px-6"><p className="text-fg-muted text-xs">Colors</p>{brand.colors.length > 0 ? <ul className="mt-3 flex flex-wrap gap-4">{brand.colors.map((color) => <li key={`${color.role}-${color.value}`} className="flex flex-col items-center gap-2"><span aria-hidden className="border-line-strong size-11 rounded-full border shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]" style={{ backgroundColor: color.value }} /><span className="text-fg-secondary font-mono text-[0.65rem] uppercase">{color.value}</span><span className="text-fg-meta text-[0.62rem]">{color.role}</span></li>)}</ul> : <p className="text-fg-muted mt-3 text-sm">No reliable palette was established.</p>}</div>
            <div className="md:px-6"><p className="text-fg-muted text-xs">Interface type</p>{brand.typefaces.length > 0 ? <ul className="mt-3 space-y-3">{brand.typefaces.map((typeface) => <li key={`${typeface.role}-${typeface.family}`}><span className="text-fg block text-sm">{typeface.family}</span><span className="text-fg-meta text-[0.68rem]">{typeface.role}</span></li>)}</ul> : <p className="text-fg-muted mt-3 text-sm">No reliable typeface was established.</p>}</div>
            <div className="md:pl-6"><p className="text-fg-muted text-xs">Tone</p><p className="text-fg-prose mt-3 text-sm leading-6">{brand.tone ? `Your product writes in a ${brand.tone} voice.` : "Vibe could not establish a consistent voice yet."}</p>{brand.phrases.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">{brand.phrases.map((phrase) => <li key={phrase} className="border-line-1 bg-surface-2 text-fg-secondary rounded-full border px-2.5 py-1 text-[0.68rem]">{phrase}</li>)}</ul>}</div>
          </div>
        ) : <p className="text-fg-muted text-sm">Vibe did not find enough reliable brand evidence to describe this identity yet.</p>}
      </Surface>

      <Surface level="panel" padding="lg" className="flex flex-col gap-5">
        <SectionLabel>Vibe learns from</SectionLabel>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {renderedSources.map((source) => (
            <li key={source.id} className="border-line-1 bg-surface-2 flex min-h-40 flex-col rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3"><span className="border-line-2 bg-surface-3 text-fg-secondary flex size-9 items-center justify-center rounded-full border"><ProductGlyph kind={sourceKind(source.id)} /></span><span className={source.ready ? "border-mint/20 bg-mint/[0.06] text-mint rounded-full border px-2 py-1 text-[0.65rem]" : "border-line-2 bg-surface-3 text-fg-muted rounded-full border px-2 py-1 text-[0.65rem]"}>{source.ready ? "Available" : "Not available yet"}</span></div>
              <h3 className="text-fg mt-4 text-sm font-semibold">{source.label}</h3>
              <p className="text-fg-muted mt-1 flex-1 text-xs leading-5">{source.ready ? source.detail : source.pending}</p>
              <Link href={source.href} className="text-fg-secondary hover:text-mint mt-4 w-fit rounded-sm text-xs underline underline-offset-4 transition-interactive focus-visible:ring-2 focus-visible:ring-mint">{source.action}</Link>
            </li>
          ))}
        </ul>
        {view.limitations.length > 0 && <ul className="border-line-1 flex flex-col gap-1.5 border-t pt-4">{view.limitations.map((limitation) => <li key={limitation} className="text-fg-meta text-xs">{limitation}</li>)}</ul>}
      </Surface>

      <Surface id="product-evidence" level="section" padding="lg" className="scroll-mt-32 flex flex-col gap-4">
        <Disclosure label="See what Vibe found"><div className="flex flex-col gap-3">{view.businessSignals.length > 0 ? <ul className="flex flex-col gap-2">{view.businessSignals.map((signal) => <li key={signal.id} className={`${TONE_TEXT[signal.tone]} text-sm`}>{signal.statement}</li>)}</ul> : <p className="text-fg-muted text-sm">No business observations were established yet.</p>}<Link href={projectSectionHref(projectId, "my-product")} className="text-fg-muted hover:text-fg-body w-fit rounded-sm text-xs underline underline-offset-4 transition-interactive">Code and public product findings</Link></div></Disclosure>
        {view.technical.length > 0 && <TechnicalDetails label="Technical details" entries={view.technical.map((row) => ({ key: row.label, value: row.value }))} />}
      </Surface>

      <Surface level="panel" tone={confirmedAt === null ? "mint" : undefined} padding="lg" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4"><span className="border-mint/25 bg-mint/[0.07] text-mint flex size-12 shrink-0 items-center justify-center rounded-full border"><ProductGlyph kind="scan" className="size-6" /></span><div><h3 className="text-fg text-base font-semibold">{confirmedAt === null ? "Is this correct?" : "You confirmed this product profile"}</h3><p className="text-fg-muted mt-1 max-w-xl text-sm leading-6">{confirmedAt === null ? "Your corrections become the strongest source in this product profile and survive future scans." : "Vibe will preserve your corrections when it refreshes the evidence behind this profile."}</p></div></div>
        {confirmedAt === null ? <div className="shrink-0">{actions}</div> : <span className="border-mint/20 bg-mint/[0.06] text-mint shrink-0 rounded-full border px-3 py-1.5 text-xs">Confirmed {formatTimestamp(confirmedAt)}</span>}
      </Surface>

      <div className="flex justify-end"><Link href={projectSectionHref(projectId, "business-audit")} className={buttonClasses({ variant: "secondary" })}>Open Business Health</Link></div>
    </div>
  );
}
