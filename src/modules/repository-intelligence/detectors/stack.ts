import {
  hasNodeDependency,
  nodeDependencySource,
  textManifestMentions,
  type DetectionContext,
} from "../context";
import { pathExtension } from "../path-policy";
import type { Detection, Evidence, PackageManagerId } from "../schema";

/**
 * Language and framework detection (Sprint 2 §12).
 *
 * Every rule is evidence-based: a declared dependency or a config file,
 * never prose. In particular README text is deliberately never consulted
 * — a README claiming "built with React" must not outweigh a
 * package.json that contains no React (Sprint 2 §12).
 */

function evidence(kind: Evidence["kind"], path: string, detail?: string): Evidence {
  return detail === undefined ? { kind, path } : { kind, path, detail };
}

function dependencyEvidence(context: DetectionContext, dependency: string): Evidence | null {
  const path = nodeDependencySource(context, dependency);
  return path ? evidence("manifest_dependency", path, dependency) : null;
}

// ---------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------

const SOURCE_EXTENSION_LANGUAGES: { id: string; name: string; extensions: string[] }[] = [
  { id: "typescript", name: "TypeScript", extensions: ["ts", "tsx", "mts", "cts"] },
  { id: "javascript", name: "JavaScript", extensions: ["js", "jsx", "mjs", "cjs"] },
  { id: "python", name: "Python", extensions: ["py"] },
  { id: "go", name: "Go", extensions: ["go"] },
  { id: "rust", name: "Rust", extensions: ["rs"] },
  { id: "php", name: "PHP", extensions: ["php"] },
  { id: "ruby", name: "Ruby", extensions: ["rb"] },
  { id: "java", name: "Java", extensions: ["java"] },
  { id: "csharp", name: "C#", extensions: ["cs"] },
];

/** Manifests that independently confirm a language regardless of file counts. */
const LANGUAGE_MANIFESTS: Record<string, { id: string; name: string }> = {
  "tsconfig.json": { id: "typescript", name: "TypeScript" },
  "go.mod": { id: "go", name: "Go" },
  "Cargo.toml": { id: "rust", name: "Rust" },
  "composer.json": { id: "php", name: "PHP" },
  Gemfile: { id: "ruby", name: "Ruby" },
  "pyproject.toml": { id: "python", name: "Python" },
  "requirements.txt": { id: "python", name: "Python" },
};

/**
 * Confidence reflects how much of the repository the language accounts
 * for: a handful of stray `.js` config files should not read as
 * "this is a JavaScript project" with the same weight as 200 `.ts` files.
 */
function confidenceFromFileCount(count: number, hasManifest: boolean): Detection["confidence"] {
  if (hasManifest && count >= 3) return "high";
  if (hasManifest || count >= 20) return "high";
  if (count >= 5) return "medium";
  return "low";
}

export function detectLanguages(context: DetectionContext): Detection[] {
  const extensionCounts = new Map<string, number>();
  const exampleByExtension = new Map<string, string>();

  for (const path of context.sourcePaths) {
    const extension = pathExtension(path);
    if (!extension) continue;
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
    if (!exampleByExtension.has(extension)) exampleByExtension.set(extension, path);
  }

  const detections: Detection[] = [];

  for (const language of SOURCE_EXTENSION_LANGUAGES) {
    const count = language.extensions.reduce(
      (total, extension) => total + (extensionCounts.get(extension) ?? 0),
      0,
    );

    const manifestEntry = Object.entries(LANGUAGE_MANIFESTS).find(
      ([basename, value]) => value.id === language.id && context.hasBasename(basename),
    );

    if (count === 0 && !manifestEntry) continue;

    const items: Evidence[] = [];
    if (manifestEntry) {
      const [basename] = manifestEntry;
      const manifestPath = context.findByBasename(new RegExp(`^${escapeRegExp(basename)}$`, "i"))[0];
      if (manifestPath) items.push(evidence("config_file", manifestPath));
    }
    for (const extension of language.extensions) {
      const example = exampleByExtension.get(extension);
      if (example) {
        items.push(evidence("file_path", example, `.${extension}`));
        break;
      }
    }

    detections.push({
      id: language.id,
      name: language.name,
      confidence: confidenceFromFileCount(count, Boolean(manifestEntry)),
      evidence: items,
    });
  }

  // Most-used language first so the UI leads with the dominant one.
  return detections.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
}

function confidenceRank(confidence: Detection["confidence"]): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------
// Frameworks
// ---------------------------------------------------------------------

type FrameworkRule = {
  id: string;
  name: string;
  /** Any of these dependencies is strong evidence. */
  dependencies?: string[];
  /** Config-file basenames (regex on basename) that corroborate. */
  configPattern?: RegExp;
  /** Non-Node manifests: a lowercase token to look for. */
  manifestToken?: string;
};

const FRAMEWORK_RULES: FrameworkRule[] = [
  { id: "nextjs", name: "Next.js", dependencies: ["next"], configPattern: /^next\.config\./i },
  { id: "react", name: "React", dependencies: ["react"] },
  { id: "vue", name: "Vue", dependencies: ["vue"] },
  { id: "nuxt", name: "Nuxt", dependencies: ["nuxt"], configPattern: /^nuxt\.config\./i },
  { id: "svelte", name: "Svelte", dependencies: ["svelte"], configPattern: /^svelte\.config\./i },
  { id: "sveltekit", name: "SvelteKit", dependencies: ["@sveltejs/kit"] },
  { id: "astro", name: "Astro", dependencies: ["astro"], configPattern: /^astro\.config\./i },
  { id: "remix", name: "Remix", dependencies: ["@remix-run/react"], configPattern: /^remix\.config\./i },
  { id: "vite", name: "Vite", dependencies: ["vite"], configPattern: /^vite\.config\./i },
  { id: "angular", name: "Angular", dependencies: ["@angular/core"] },
  { id: "express", name: "Express", dependencies: ["express"] },
  { id: "nestjs", name: "NestJS", dependencies: ["@nestjs/core"] },
  { id: "fastapi", name: "FastAPI", manifestToken: "fastapi" },
  { id: "django", name: "Django", manifestToken: "django" },
  { id: "flask", name: "Flask", manifestToken: "flask" },
  { id: "laravel", name: "Laravel", manifestToken: "laravel/framework" },
  { id: "rails", name: "Ruby on Rails", manifestToken: "rails" },
];

/**
 * A dependency plus its dedicated config file is the strongest signal we
 * have; either alone is still solid but reported as medium so the UI can
 * be honest about how sure we are.
 */
export function detectFrameworks(context: DetectionContext): Detection[] {
  const detections: Detection[] = [];

  for (const rule of FRAMEWORK_RULES) {
    const items: Evidence[] = [];

    for (const dependency of rule.dependencies ?? []) {
      if (hasNodeDependency(context, dependency)) {
        const item = dependencyEvidence(context, dependency);
        if (item) items.push(item);
      }
    }
    const hasDependency = items.length > 0;

    let hasConfig = false;
    if (rule.configPattern) {
      const configPath = context.findByBasename(rule.configPattern)[0];
      if (configPath) {
        items.push(evidence("config_file", configPath));
        hasConfig = true;
      }
    }

    let hasManifestToken = false;
    if (rule.manifestToken) {
      const manifestPath = textManifestMentions(context, rule.manifestToken);
      if (manifestPath) {
        items.push(evidence("manifest_dependency", manifestPath, rule.manifestToken));
        hasManifestToken = true;
      }
    }

    if (items.length === 0) continue;

    const confidence: Detection["confidence"] =
      (hasDependency && hasConfig) || hasManifestToken ? "high" : hasDependency ? "medium" : "low";

    detections.push({ id: rule.id, name: rule.name, confidence, evidence: items });
  }

  return detections.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
}

// ---------------------------------------------------------------------
// Package manager & runtime
// ---------------------------------------------------------------------

export function detectPackageManager(context: DetectionContext): PackageManagerId {
  // An explicit `packageManager` field is authoritative.
  const hint = context.rootPackageJson?.packageManagerHint;
  if (hint === "pnpm" || hint === "npm" || hint === "yarn" || hint === "bun") return hint;

  if (context.hasBasename("pnpm-lock.yaml") || context.hasBasename("pnpm-workspace.yaml")) return "pnpm";
  if (context.hasBasename("bun.lockb") || context.hasBasename("bun.lock")) return "bun";
  if (context.hasBasename("yarn.lock")) return "yarn";
  if (context.hasBasename("package-lock.json")) return "npm";
  return "unknown";
}

export function detectRuntime(context: DetectionContext): Detection[] {
  const detections: Detection[] = [];

  const nodeEngine = context.rootPackageJson?.engines?.node;
  if (nodeEngine) {
    detections.push({
      id: "node",
      name: `Node.js ${nodeEngine}`,
      confidence: "high",
      evidence: [evidence("manifest_field", "package.json", `engines.node ${nodeEngine}`)],
    });
  } else if (context.rootPackageJson) {
    detections.push({
      id: "node",
      name: "Node.js",
      confidence: "medium",
      evidence: [evidence("config_file", "package.json")],
    });
  }

  const dockerfile = context.findByBasename(/^dockerfile$/i)[0];
  if (dockerfile) {
    detections.push({
      id: "docker",
      name: "Docker",
      confidence: "high",
      evidence: [evidence("config_file", dockerfile)],
    });
  }

  return detections;
}
