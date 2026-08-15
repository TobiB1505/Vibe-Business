import { mayFetchContent, pathBasename, pathDepth } from "./path-policy";
import type { AnalysisBudgets } from "./budgets";
import type { TreeEntry } from "./reader";

/**
 * Deterministic high-value file discovery and selection (Sprint 2 §10).
 *
 * Two distinct questions, deliberately separated:
 *
 *  - **Discovery**: which high-value files *exist*? Answered from the
 *    tree alone, for free. Most detections only need existence —
 *    `next.config.ts` being present is the whole signal; its contents add
 *    nothing.
 *  - **Fetching**: which files must actually be downloaded and parsed?
 *    Only dependency manifests, because a dependency list cannot be
 *    inferred from a filename.
 *
 * Keeping these apart is what makes analysis cheap: a typical repository
 * needs one or two content fetches rather than dozens, while detection
 * quality is unchanged. It also shrinks the amount of untrusted
 * repository text that ever enters the process (Sprint 2 §2, §28).
 *
 * Adding a new ecosystem means adding rows to the tables below — no
 * plugin framework, no dynamic loading.
 */

export type CandidatePriority = 1 | 2 | 3;

export type Candidate = {
  path: string;
  priority: CandidatePriority;
  size?: number;
};

type Rule = {
  priority: CandidatePriority;
  /** True only for manifests whose *contents* a parser consumes. */
  fetchContent: boolean;
};

/** Exact basenames recognised as high-value. */
const EXACT_BASENAMES: Record<string, Rule> = {
  // Dependency manifests — the only files we actually download.
  "package.json": { priority: 1, fetchContent: true },
  "pyproject.toml": { priority: 1, fetchContent: true },
  "requirements.txt": { priority: 1, fetchContent: true },
  Pipfile: { priority: 2, fetchContent: true },
  "composer.json": { priority: 1, fetchContent: true },
  Gemfile: { priority: 1, fetchContent: true },
  "go.mod": { priority: 1, fetchContent: true },
  "Cargo.toml": { priority: 1, fetchContent: true },

  // Existence-only signals.
  "tsconfig.json": { priority: 2, fetchContent: false },
  "jsconfig.json": { priority: 3, fetchContent: false },
  "vercel.json": { priority: 2, fetchContent: false },
  "pnpm-workspace.yaml": { priority: 2, fetchContent: false },
  "turbo.json": { priority: 2, fetchContent: false },
  "nx.json": { priority: 3, fetchContent: false },
  "lerna.json": { priority: 3, fetchContent: false },
  "manage.py": { priority: 2, fetchContent: false },
  Dockerfile: { priority: 2, fetchContent: false },
  "render.yaml": { priority: 2, fetchContent: false },
  "fly.toml": { priority: 2, fetchContent: false },
  "netlify.toml": { priority: 2, fetchContent: false },
  "railway.json": { priority: 2, fetchContent: false },
  "railway.toml": { priority: 2, fetchContent: false },
  Procfile: { priority: 2, fetchContent: false },
  "schema.prisma": { priority: 2, fetchContent: false },
  "robots.txt": { priority: 3, fetchContent: false },
  "sitemap.xml": { priority: 3, fetchContent: false },
  "manifest.json": { priority: 3, fetchContent: false },
  "site.webmanifest": { priority: 3, fetchContent: false },
};

/**
 * Stylesheets and theme files whose *contents* carry design tokens
 * (CORE-1 §12, §13).
 *
 * These are the second family of files worth downloading, and for the same
 * reason manifests are: a brand colour cannot be inferred from a filename.
 * Priority 3 keeps them behind every dependency manifest, so a repository
 * tight against `maxFileFetches` still gets its stack detected correctly and
 * simply reports no brand tokens.
 *
 * Deliberately a short, named list rather than "every .css file": a design
 * system's tokens live in one or two well-known files, and downloading a
 * hundred component stylesheets would multiply cost for nothing.
 */
const STYLE_BASENAMES: Record<string, Rule> = {
  "globals.css": { priority: 3, fetchContent: true },
  "global.css": { priority: 3, fetchContent: true },
  "app.css": { priority: 3, fetchContent: true },
  "index.css": { priority: 3, fetchContent: true },
  "main.css": { priority: 3, fetchContent: true },
  "styles.css": { priority: 3, fetchContent: true },
  "style.css": { priority: 3, fetchContent: true },
  "theme.css": { priority: 3, fetchContent: true },
  "tokens.css": { priority: 3, fetchContent: true },
  "variables.css": { priority: 3, fetchContent: true },
  "root.css": { priority: 3, fetchContent: true },
};

/** Basename patterns for families with variable extensions — all existence-only. */
const PATTERN_RULES: { pattern: RegExp; rule: Rule }[] = [
  { pattern: /^next\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 1, fetchContent: false } },
  { pattern: /^vite\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 1, fetchContent: false } },
  { pattern: /^astro\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 1, fetchContent: false } },
  { pattern: /^svelte\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 1, fetchContent: false } },
  { pattern: /^nuxt\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 1, fetchContent: false } },
  { pattern: /^remix\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 1, fetchContent: false } },
  // Fetched from CORE-1 onwards: a Tailwind config is where a project that
  // does not use CSS custom properties declares its palette instead.
  { pattern: /^tailwind\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 3, fetchContent: true } },
  { pattern: /^drizzle\.config\.(js|cjs|mjs|ts|mts)$/i, rule: { priority: 2, fetchContent: false } },
  { pattern: /^docker-compose(\.[\w-]+)?\.(yml|yaml)$/i, rule: { priority: 2, fetchContent: false } },
  { pattern: /^readme(\.[\w]+)?$/i, rule: { priority: 2, fetchContent: false } },
  { pattern: /^license(\.[\w]+)?$/i, rule: { priority: 3, fetchContent: false } },
];

/** Exact repository-relative paths worth recognising regardless of basename. */
const EXACT_PATHS: Record<string, Rule> = {
  "supabase/config.toml": { priority: 2, fetchContent: false },
  "prisma/schema.prisma": { priority: 2, fetchContent: false },
};

function classify(path: string): Rule | null {
  const exactPath = EXACT_PATHS[path];
  if (exactPath) return exactPath;

  const basename = pathBasename(path);
  const exact = EXACT_BASENAMES[basename];
  if (exact) return exact;

  const style = STYLE_BASENAMES[basename.toLowerCase()];
  if (style) return style;

  const pattern = PATTERN_RULES.find((entry) => entry.pattern.test(basename));
  return pattern ? pattern.rule : null;
}

/**
 * Root-level manifests are far more meaningful than the same filename
 * buried deep inside an unrelated folder, so shallower paths win ties.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const depthDelta = pathDepth(a.path) - pathDepth(b.path);
  if (depthDelta !== 0) return depthDelta;
  return a.path.localeCompare(b.path);
}

export type CandidateSelection = {
  /** Every high-value path present in the tree, ranked. Evidence source. */
  discovered: Candidate[];
  /** The subset whose content will be downloaded, after budget trimming. */
  toFetch: Candidate[];
  /** True when more manifests needed fetching than the budget allowed. */
  truncatedByBudget: boolean;
};

/**
 * Ranks the high-value files in a tree and decides which to download.
 *
 * Every returned candidate has already passed `mayFetchContent`, so
 * sensitive, binary and generated paths can never reach a fetch — the
 * budget trim happens afterwards and cannot reintroduce them.
 */
export function selectCandidates(entries: TreeEntry[], budgets: AnalysisBudgets): CandidateSelection {
  const discovered: Candidate[] = [];
  const fetchable: Candidate[] = [];

  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    if (pathDepth(entry.path) > budgets.maxPathDepth) continue;
    if (!mayFetchContent(entry.path)) continue;

    const rule = classify(entry.path);
    if (rule === null) continue;

    const candidate: Candidate = { path: entry.path, priority: rule.priority, size: entry.size };
    discovered.push(candidate);

    // Oversized manifests are still *discovered* (their existence is
    // valid evidence) but never downloaded.
    const tooLarge = typeof entry.size === "number" && entry.size > budgets.maxBytesPerFile;
    if (rule.fetchContent && !tooLarge) fetchable.push(candidate);
  }

  discovered.sort(compareCandidates);
  fetchable.sort(compareCandidates);

  const limit = budgets.maxFileFetches;
  return {
    discovered,
    toFetch: fetchable.slice(0, limit),
    truncatedByBudget: fetchable.length > limit,
  };
}
