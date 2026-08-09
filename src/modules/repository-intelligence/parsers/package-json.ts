/**
 * package.json parsing (Sprint 2 §11).
 *
 * Treated strictly as DATA: fields are read, nothing is executed, and no
 * script *body* is retained — only script names, because a command line
 * is both a possible injection surface for later AI consumers and not
 * needed for any Sprint 2 detection.
 */

export type ParsedPackageJson = {
  name: string | null;
  private: boolean;
  /** Script names only — never the command bodies (see above). */
  scriptNames: string[];
  dependencies: string[];
  devDependencies: string[];
  /** Union of both, for detectors that don't care which section. */
  allDependencies: string[];
  engines: Record<string, string>;
  /** Raw `workspaces` entries, if the field is present. */
  workspaces: string[];
  /** From the `packageManager` field, e.g. "pnpm@9.0.0" → "pnpm". */
  packageManagerHint: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringKeys(value: unknown): string[] {
  return Object.keys(asRecord(value));
}

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(asRecord(value))) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

function parseWorkspaces(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  // npm/yarn also allow the object form: { packages: [...] }
  const packages = asRecord(value).packages;
  return Array.isArray(packages)
    ? packages.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Returns null when the content is not valid JSON — the caller records a warning. */
export function parsePackageJson(content: string): ParsedPackageJson | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }

  const record = asRecord(raw);
  if (Object.keys(record).length === 0) return null;

  const dependencies = stringKeys(record.dependencies);
  const devDependencies = stringKeys(record.devDependencies);
  const packageManager = typeof record.packageManager === "string" ? record.packageManager : null;

  return {
    name: typeof record.name === "string" ? record.name : null,
    private: record.private === true,
    scriptNames: stringKeys(record.scripts),
    dependencies,
    devDependencies,
    allDependencies: [...new Set([...dependencies, ...devDependencies])],
    engines: stringRecord(record.engines),
    workspaces: parseWorkspaces(record.workspaces),
    packageManagerHint: packageManager ? packageManager.split("@")[0] || null : null,
  };
}
