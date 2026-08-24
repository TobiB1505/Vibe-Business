import Link from "next/link";
import {
  ArrowRightIcon,
  BranchIcon,
  CodeIcon,
  GlobeIcon,
  LockIcon,
} from "@/components/ui/dashboard-icons";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { Sparkline } from "@/components/ui/sparkline";
import { StatusPill, statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import { initialsFrom } from "@/modules/auth/initials";
import type { ProductOverviewItem } from "@/modules/projects/product-summary";
import { buildScoreSeries } from "@/modules/projects/score-series";
import { productListStatus } from "./product-list-state";

const SCORE_TONE: Record<ScoreTone, StatusTone> = {
  strong: "success",
  partial: "waiting",
  weak: "problem",
  unscored: "neutral",
};

const TILE_TONE: Record<ScoreTone, string> = {
  strong: "from-mint/35 via-mint/15 to-surface-hover border-mint-line text-mint",
  partial: "from-amber/35 via-amber/15 to-surface-hover border-amber-line text-amber",
  weak: "from-coral/35 via-coral/15 to-surface-hover border-coral-line text-coral",
  unscored: "from-white/10 via-white/[0.04] to-surface-hover border-line-strong text-fg-body",
};

function ProfileFact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-body text-xs font-semibold">{label}</dt>
      <dd
        className={cn(
          "mt-1.5 line-clamp-2 text-xs leading-5",
          value ? "text-fg-muted" : "text-fg-meta",
        )}
      >
        {value ?? "Not established yet"}
      </dd>
    </div>
  );
}

export function ProductListCard({ product }: { product: ProductOverviewItem }) {
  const display = scoreDisplay(product.score);
  const status = productListStatus(product);
  const series = buildScoreSeries(product.scoreHistory);
  const tone =
    display.tone === "strong"
      ? "mint"
      : display.tone === "partial"
        ? "amber"
        : display.tone === "weak"
          ? "coral"
          : "neutral";

  return (
    <li data-testid="product-list-card">
      <Link
        href={`/app/projects/${product.id}`}
        aria-label={`Open ${product.name}`}
        className="group rounded-panel block"
      >
        <article
          className={cn(
            "border-line-2 bg-surface-2 rounded-panel border p-5 shadow-panel",
            "transition-[border-color,background-color,transform] duration-200",
            "group-hover:border-line-strong group-hover:bg-surface-3 group-hover:-translate-y-px",
            "sm:p-6",
          )}
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(12rem,0.72fr)_9rem_1.5rem] xl:items-center">
            <div className="min-w-0">
              <div className="flex items-start gap-4">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-14 shrink-0 items-center justify-center rounded-card border bg-gradient-to-br",
                    "text-lg font-bold tracking-[-0.03em] shadow-card sm:size-16 sm:text-xl",
                    TILE_TONE[display.tone],
                  )}
                >
                  {initialsFrom(product.name)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-fg truncate text-base font-bold" title={product.name}>
                      {product.name}
                    </h2>
                    <StatusPill
                      tone={status.tone}
                      className="px-2.5 py-0.5 normal-case tracking-normal"
                    >
                      {status.label}
                    </StatusPill>
                  </div>
                  <p className="text-fg-muted mt-2 line-clamp-2 max-w-[56ch] text-sm leading-6">
                    {product.shortDescription ?? "No product summary is available yet."}
                  </p>
                </div>
              </div>

              <dl className="border-line-1 mt-5 grid gap-4 border-t pt-4 sm:grid-cols-3">
                <ProfileFact label="What it does" value={product.mainPurpose} />
                <ProfileFact label="For whom" value={product.primaryAudience} />
                <ProfileFact label="Founder's goal" value={product.founderGoal} />
              </dl>
            </div>

            <dl className="grid gap-2.5 text-xs sm:grid-cols-3 xl:grid-cols-1">
              <div className="text-fg-muted flex min-w-0 items-center gap-2.5">
                <GlobeIcon size={15} className="text-fg-meta shrink-0" />
                <dt className="sr-only">Product type</dt>
                <dd className="truncate">{product.category ?? "Product profile pending"}</dd>
              </div>
              <div className="text-fg-muted flex min-w-0 items-center gap-2.5">
                <CodeIcon size={15} className="text-fg-meta shrink-0" />
                <dt className="sr-only">Repository</dt>
                <dd className="truncate font-mono" title={product.repositoryFullName ?? undefined}>
                  {product.repositoryFullName ?? "No repository"}
                </dd>
              </div>
              <div className="text-fg-muted flex min-w-0 items-center gap-2.5">
                {product.repositoryPrivate === null || product.repositoryPrivate === undefined ? (
                  <BranchIcon size={15} className="text-fg-meta shrink-0" />
                ) : (
                  <LockIcon size={15} className="text-fg-meta shrink-0" />
                )}
                <dt className="sr-only">Repository details</dt>
                <dd className="truncate">
                  {product.repositoryPrivate === true
                    ? `Private${product.defaultBranch ? ` · ${product.defaultBranch}` : ""}`
                    : product.repositoryPrivate === false
                      ? `Public${product.defaultBranch ? ` · ${product.defaultBranch}` : ""}`
                      : product.defaultBranch
                        ? `Branch ${product.defaultBranch}`
                        : "Setup incomplete"}
                </dd>
              </div>
            </dl>

            <div className="border-line-1 flex items-center justify-between gap-6 border-t pt-5 xl:block xl:border-0 xl:pt-0">
              <div>
                <p className="text-fg-meta text-[0.6875rem]">Business signal</p>
                {product.scoreState === "scored" && product.score !== null ? (
                  <p className="mt-1 flex items-baseline gap-1 font-semibold tabular-nums">
                    <span className={cn("text-lg", statusToneText(SCORE_TONE[display.tone]))}>
                      {product.score}
                    </span>
                    <span className="text-fg-meta text-xs">/100</span>
                  </p>
                ) : (
                  <p className="text-fg-muted mt-1 text-xs">
                    {product.scoreState === "insufficient_coverage"
                      ? "Not enough evidence"
                      : "No data yet"}
                  </p>
                )}
                <p className="text-fg-meta mt-1 text-[0.6875rem] xl:hidden">
                  Analysed {formatDate(product.lastAnalysedAt) ?? "not yet"}
                </p>
              </div>

              <div className="w-28 xl:mt-2 xl:w-full">
                {series.readingCount > 0 && (
                  <Sparkline segments={series.segments} tone={tone} />
                )}
              </div>

              <p className="text-fg-meta mt-2 hidden text-[0.6875rem] xl:block">
                Analysed {formatDate(product.lastAnalysedAt) ?? "not yet"}
              </p>
            </div>

            <ArrowRightIcon
              size={19}
              className="text-fg-meta hidden transition-transform duration-200 group-hover:translate-x-1 group-hover:text-fg-body xl:block"
            />
          </div>
        </article>
      </Link>
    </li>
  );
}
