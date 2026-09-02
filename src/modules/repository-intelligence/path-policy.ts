/**
 * Repository file-selection policy (Sprint 2 §8, §9).
 *
 * Three independent questions, deliberately kept separate:
 *   - is this path sensitive?   → never fetch its content, at all
 *   - is this path binary?      → never fetch (nothing to parse)
 *   - is this path generated?   → never fetch, and never treat as source
 *                                 (a `.next/` build output must not
 *                                 produce phantom routes)
 *
 * All matching is anchored against path *segments* and *basenames*, never
 * `path.includes(...)`. A substring rule would exclude harmless files
 * such as `docs/credentials-guide.md` or `src/lib/build-utils.ts`, which
 * both costs detection quality and makes the policy hard to reason about.
 *
 * Observing that a sensitive path *exists* in the tree is fine; only
 * content retrieval is forbidden.
 */

/**
 * Basenames that are sensitive no matter what extension they carry —
 * these names only ever denote credential material.
 */
const ALWAYS_SENSITIVE_PATTERNS: RegExp[] = [
  // .env, .env.local, .env.production — including .env.example: its
  // content is usually harmless, but a blanket rule is easier to audit,
  // and its mere presence in the tree is already usable as a signal.
  /^\.env($|\.)/i,
  /^id_rsa($|\.)/i,
  /^id_ed25519($|\.)/i,
  /^id_ecdsa($|\.)/i,
  /^id_dsa($|\.)/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.htpasswd$/i,
];

/**
 * Names built from words that are *usually* credential material but are
 * also ordinary English — `credentials`, `secrets`. Anchored to the start
 * of the basename with a separator, so `credentialsHelper.ts` is
 * unaffected, and exempted for documentation extensions so that a file
 * genuinely *about* credentials (`docs/credentials-guide.md`) is not
 * mistaken for credentials themselves.
 */
const AMBIGUOUS_SENSITIVE_PATTERNS: RegExp[] = [
  /^credentials?([.\-_]|$)/i,
  /^secrets?([.\-_]|$)/i,
  /^private[-_]?keys?([.\-_]|$)/i,
  /^service[-_]?accounts?([.\-_]|$)/i,
];

/** Extensions that mark a file as prose about a topic, not the artefact itself. */
const DOCUMENTATION_EXTENSIONS = new Set(["md", "mdx", "rst", "adoc", "markdown"]);

/** Final extensions that indicate key/certificate material. */
const SENSITIVE_EXTENSIONS = new Set(["pem", "key", "p12", "pfx", "jks", "keystore", "asc", "ppk"]);

/** Final extensions we never download: nothing text-parseable inside. */
const BINARY_EXTENSIONS = new Set([
  // images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "tiff",
  "tif",
  "ico",
  "icns",
  "svg",
  "psd",
  "ai",
  // video / audio
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "mp3",
  "wav",
  "flac",
  "ogg",
  "m4a",
  "aac",
  // fonts
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  // archives
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "jar",
  "war",
  // executables / compiled artefacts
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "o",
  "a",
  "class",
  "pyc",
  "pyo",
  "wasm",
  "node",
  // documents / data blobs
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // databases
  "db",
  "sqlite",
  "sqlite3",
  "mdb",
  "realm",
]);

/**
 * Directory names that hold dependencies, build output, or caches. Matched
 * as a whole path segment, so a legitimate `src/lib/dist-utils.ts` is not
 * affected.
 */
const GENERATED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".astro",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vercel",
  ".netlify",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".gradle",
  ".idea",
  ".vscode",
  "Pods",
  "DerivedData",
]);

export function pathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

export function pathBasename(path: string): string {
  const segments = pathSegments(path);
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

export function pathDepth(path: string): number {
  return pathSegments(path).length;
}

/** Final extension, lowercased, without the dot. Empty for dotfiles/extensionless names. */
export function pathExtension(path: string): string {
  const basename = pathBasename(path);
  const dotIndex = basename.lastIndexOf(".");
  // `> 0` so a leading-dot file like `.env` is treated as having no
  // extension rather than an extension of "env".
  if (dotIndex <= 0) return "";
  return basename.slice(dotIndex + 1).toLowerCase();
}

export function isSensitivePath(path: string): boolean {
  const basename = pathBasename(path);
  if (basename.length === 0) return false;

  if (ALWAYS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(basename))) return true;
  if (SENSITIVE_EXTENSIONS.has(pathExtension(path))) return true;

  if (AMBIGUOUS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(basename))) {
    return !DOCUMENTATION_EXTENSIONS.has(pathExtension(path));
  }

  return false;
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(pathExtension(path));
}

export function isGeneratedPath(path: string): boolean {
  return pathSegments(path).some((segment) => GENERATED_SEGMENTS.has(segment));
}

/**
 * The single gate every content fetch must pass. Deliberately expressed
 * as an allowlist of *outcomes* rather than scattered checks at call
 * sites, so there is exactly one place to audit.
 */
export function mayFetchContent(path: string): boolean {
  return !isSensitivePath(path) && !isBinaryPath(path) && !isGeneratedPath(path);
}

/** Paths eligible to be treated as first-party source (e.g. for route detection). */
export function isSourcePath(path: string): boolean {
  return !isGeneratedPath(path) && !isSensitivePath(path);
}
