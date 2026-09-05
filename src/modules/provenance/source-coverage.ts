import type { RetailOperationKind } from "@/modules/credits/retail";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { completenessReasonsClause } from "@/modules/repository-intelligence/completeness-labels";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import { describeIncompleteness } from "@/modules/live-product-intelligence/human-view";
import type { AuthenticatedProductIntelligenceSnapshot } from "@/modules/authenticated-product-intelligence/schema";

/**
 * What Vibe's understanding rests on, per source (audit C8, R6).
 *
 * ## Why this is a module and not four objects on a page
 *
 * It was four objects on a page — about a hundred lines of nested ternaries in
 * `product/page.tsx` producing label, state, sentence, link and action for the
 * repository, the live product, the Deep Scan and the founder's own words. The
 * Provenance Strip needs the same four facts under every priced control, and
 * Home needs them again; assembled inline they would be assembled three times,
 * and the third copy would disagree with the first.
 *
 * ## What a source has to be able to say
 *
 * Four things, and the last two are the ones the page could not say at all:
 *
 *  - **state** — `ready`, `partial`, `failed`, `none`, `running`. `partial` is
 *    its own state rather than a shade of ready: a source that was read and
 *    could not be finished supports a weaker claim than one that was.
 *  - **why**, when it stopped short, in a founder's words. Never an enum.
 *  - **how much was measured** — files, pages. A count the analyzer recorded,
 *    never estimated here, and absent when nothing measured it.
 *  - **when**, so a founder can tell a stale reading from a current one.
 *
 * ## The remedy names an operation, and never a price
 *
 * `operation` is what the remedy would start; `CostDisclosure` resolves what
 * that costs from the rate card in force. A price copied into a view model is
 * a price that goes stale silently, and this product has one place where a
 * retail price is decided.
 */

export type SourceCoverageId = "repository" | "live" | "deep_scan" | "founder";

export type SourceCoverageState = "ready" | "partial" | "failed" | "none" | "running";

export type SourceCoverageRemedy = {
  label: string;
  href: string;
  /** Null when starting it costs nothing. Never a price copied by hand. */
  operation: RetailOperationKind | null;
};

export type SourceCoverage = {
  source: SourceCoverageId;
  /** The founder's name for it, never the module's. */
  label: string;
  state: SourceCoverageState;
  /** One sentence: what Vibe did, or did not. */
  detail: string;
  /** Why it stopped short, already worded. Empty unless `state` is partial. */
  reasons: string[];
  /** What the analyzer counted. Absent rather than zero when unmeasured. */
  measured: { files?: number; pages?: number };
  /** When the reading was taken. Null when there has not been one. */
  at: string | null;
  remedy: SourceCoverageRemedy | null;
};

/** What a source's own reading looked like, from the caller that read it. */
export type SourceReading<T> = {
  result: T | null;
  completedAt?: string | null;
  /** True while a run for this source is in flight. */
  running?: boolean;
  /** True when the last attempt ended in failure and left no usable result. */
  failed?: boolean;
};

export function buildSourceCoverage(input: {
  repository: SourceReading<RepositoryIntelligenceSnapshot>;
  live: SourceReading<LiveProductIntelligenceSnapshot>;
  deepScan: SourceReading<AuthenticatedProductIntelligenceSnapshot> & {
    /** Pages the scan reported, which the snapshot itself does not carry. */
    pagesInspected?: number | null;
  };
  founder: { told: boolean; at: string | null };
  hrefs: {
    scan: string;
    deepScan: string;
    settings: string;
    founderIntent: string;
    connectRepository: string;
    addWebsite: string;
  };
  /** Absent means the project has never been given one. */
  connected: { repository: boolean; productionUrl: boolean };
}): SourceCoverage[] {
  return [
    repositoryCoverage(input),
    liveCoverage(input),
    deepScanCoverage(input),
    founderCoverage(input),
  ];
}

function repositoryCoverage({
  repository,
  hrefs,
  connected,
}: Parameters<typeof buildSourceCoverage>[0]): SourceCoverage {
  const label = "Your code";
  const base = { source: "repository" as const, label, reasons: [], measured: {}, at: null };

  if (repository.running) {
    return { ...base, state: "running", detail: "Vibe is reading your code now.", remedy: null };
  }

  const snapshot = repository.result;
  if (snapshot) {
    const partial = snapshot.completeness.status !== "complete";
    const clause = completenessReasonsClause(snapshot.completeness.reasons);
    return {
      ...base,
      state: partial ? "partial" : "ready",
      detail: partial
        ? "Vibe read your repository, but did not finish it."
        : "Vibe has read what your repository builds.",
      reasons: partial && clause !== "" ? [clause] : [],
      measured: { files: snapshot.metrics.filesFetched },
      at: repository.completedAt ?? null,
      remedy: { label: "Scan again", href: hrefs.scan, operation: "product_understanding" },
    };
  }

  if (repository.failed) {
    return {
      ...base,
      state: "failed",
      detail: "Vibe couldn't read your code last time.",
      remedy: { label: "Scan again", href: hrefs.scan, operation: "product_understanding" },
    };
  }

  return connected.repository
    ? {
        ...base,
        state: "none",
        detail: "Vibe hasn't read your code yet.",
        remedy: { label: "Scan my product", href: hrefs.scan, operation: "product_understanding" },
      }
    : {
        ...base,
        state: "none",
        detail: "No repository is connected yet.",
        // Connecting one is account work, not an analysis, and costs nothing.
        remedy: { label: "Connect a repository", href: hrefs.connectRepository, operation: null },
      };
}

function liveCoverage({
  live,
  hrefs,
  connected,
}: Parameters<typeof buildSourceCoverage>[0]): SourceCoverage {
  const label = "Your public product";
  const base = { source: "live" as const, label, reasons: [], measured: {}, at: null };

  if (live.running) {
    return { ...base, state: "running", detail: "Vibe is visiting your product now.", remedy: null };
  }

  const snapshot = live.result;
  if (snapshot) {
    const incomplete = describeIncompleteness(snapshot);
    return {
      ...base,
      state: incomplete === null ? "ready" : "partial",
      detail:
        incomplete === null
          ? "Vibe has visited what a first-time visitor reaches."
          : "Vibe visited your product, but couldn't read all of it.",
      reasons: incomplete === null ? [] : [incomplete],
      measured: { pages: snapshot.metrics.pagesFetched },
      at: live.completedAt ?? null,
      remedy: { label: "Scan again", href: hrefs.scan, operation: "product_understanding" },
    };
  }

  if (live.failed) {
    return {
      ...base,
      state: "failed",
      detail: "Vibe couldn't reach your product last time.",
      remedy: { label: "Scan again", href: hrefs.scan, operation: "product_understanding" },
    };
  }

  return connected.productionUrl
    ? {
        ...base,
        state: "none",
        detail: "Vibe hasn't visited your product yet.",
        remedy: { label: "Scan my product", href: hrefs.scan, operation: "product_understanding" },
      }
    : {
        ...base,
        state: "none",
        detail: "No production website is set yet.",
        remedy: { label: "Add your website", href: hrefs.addWebsite, operation: null },
      };
}

function deepScanCoverage({
  deepScan,
  hrefs,
}: Parameters<typeof buildSourceCoverage>[0]): SourceCoverage {
  const label = "Your signed-in product";
  const base = { source: "deep_scan" as const, label, reasons: [], measured: {}, at: null };

  if (deepScan.running) {
    return {
      ...base,
      state: "running",
      detail: "Vibe is signing in to your product now.",
      remedy: null,
    };
  }

  if (deepScan.result) {
    return {
      ...base,
      state: "ready",
      detail: "Vibe has seen what your product looks like after signing in.",
      measured:
        typeof deepScan.pagesInspected === "number" ? { pages: deepScan.pagesInspected } : {},
      at: deepScan.completedAt ?? null,
      remedy: { label: "Deep Scan", href: hrefs.deepScan, operation: "deep_scan" },
    };
  }

  return {
    ...base,
    state: deepScan.failed ? "failed" : "none",
    detail: deepScan.failed
      ? "Vibe couldn't get past your sign-in last time."
      : "Vibe hasn't seen past your sign-in yet.",
    remedy: { label: "Deep Scan", href: hrefs.deepScan, operation: "deep_scan" },
  };
}

function founderCoverage({
  founder,
  hrefs,
}: Parameters<typeof buildSourceCoverage>[0]): SourceCoverage {
  const label = "What you told Vibe";
  const base = { source: "founder" as const, label, reasons: [], measured: {} };

  return founder.told
    ? {
        ...base,
        state: "ready",
        detail: "Your own words about the business, which outrank anything derived.",
        at: founder.at,
        // Telling Vibe more is a form, not an analysis. There is nothing to price.
        remedy: { label: "Update what you told Vibe", href: hrefs.founderIntent, operation: null },
      }
    : {
        ...base,
        state: "none",
        at: null,
        detail: "You haven't told Vibe anything about the business yet.",
        remedy: { label: "Tell Vibe", href: hrefs.founderIntent, operation: null },
      };
}

/**
 * The first source that is not `ready`, which is what a strip leads with.
 *
 * A strip has one line, and the useful thing to spend it on is the gap rather
 * than the three sources that are fine. Null when everything is ready.
 */
export function firstCoverageGap(sources: readonly SourceCoverage[]): SourceCoverage | null {
  return sources.find((source) => source.state !== "ready") ?? null;
}
