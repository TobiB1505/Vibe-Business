/**
 * Parses `.env.local`, `dotenv`-compatibly enough for the probe harness
 * (Sprint 0055).
 *
 * ## Why this exists instead of a dependency
 *
 * Next.js reads `.env.local` for `pnpm dev` using its own bundled `dotenv`.
 * Vitest does not, and nothing in this repo's probe tooling did either — every
 * `pnpm agent:calibrate` invocation meant pasting five or six secrets onto the
 * command line, where they land in shell history. Ten invocations for one
 * calibration sprint is ten chances to leak a key.
 *
 * No dependency is added; the file already exists and its own format —
 * `KEY=value`, optional quotes, comments, blank lines — is small enough to
 * parse correctly, and "correctly" turned out to need two rounds to get right,
 * which is exactly why this now has a colocated test rather than living inline
 * in a config file no test ever touched.
 *
 * ## The two failures this already caused, in production use
 *
 * 1. **An empty pre-set variable defeated the file.** The first version
 *    skipped a key whenever it was already `!== undefined` in `process.env`.
 *    A shell profile or tool that pre-declares a name as `""` — common for
 *    `NEXT_PUBLIC_*` names — made the probe fail with "required" even though
 *    the file held the real value. Fixed by treating an empty string as unset.
 *
 * 2. **A multiline quoted value was truncated to its first line.** The first
 *    version split the whole file on `\n` before parsing, so a value like
 *    `GITHUB_APP_PRIVATE_KEY="-----BEGIN...\n...\n-----END-----"` — genuine
 *    newlines inside quotes, the shape `docs/setup/github-app.md` shows as
 *    valid — kept only `"-----BEGIN RSA PRIVATE KEY-----`, no closing quote,
 *    no END line. `github.ts`'s own validation caught it and reported exactly
 *    that: "missing its END line — the value looks truncated." The value
 *    parsed correctly; the file never reached it complete.
 */

export type ParsedEnvLine = { key: string; value: string };

/**
 * Parses `dotenv`-style content. Quote-aware and multiline-aware: a value
 * opened with `"` or `'` is not considered complete until a line ends with the
 * matching quote, however many lines that takes.
 *
 * Deliberately does not interpret `\n` escapes inside a value — `github.ts`
 * does that itself for `GITHUB_APP_PRIVATE_KEY`, and unescaping here would
 * hand it a key it then mangles a second time.
 */
export function parseEnvFile(content: string): readonly ParsedEnvLine[] {
  const lines = content.split("\n");
  const entries: ParsedEnvLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    if (key === "") continue;

    const rest = line.slice(separator + 1);
    const restLeadingTrimmed = rest.replace(/^[ \t]+/, "");
    const quote = restLeadingTrimmed.startsWith('"') || restLeadingTrimmed.startsWith("'")
      ? restLeadingTrimmed[0]
      : null;

    if (!quote) {
      entries.push({ key, value: rest.trim() });
      continue;
    }

    let collected = restLeadingTrimmed.slice(1);
    let closed = collected.endsWith(quote) && collected.length > 0;

    while (!closed && i + 1 < lines.length) {
      i += 1;
      const next = lines[i] ?? "";
      collected += `\n${next}`;
      closed = next.endsWith(quote);
    }

    entries.push({ key, value: closed ? collected.slice(0, -1) : collected });
  }

  return entries;
}

/**
 * Applies parsed entries to an environment object, in place, without
 * overwriting a variable that already carries a real value.
 *
 * An empty string counts as unset. A required credential is never meant to be
 * `""`, and a shell or profile script that pre-declares the name empty must
 * not silently defeat the file — that was the first of the two bugs above.
 */
export function applyEnv(
  entries: readonly ParsedEnvLine[],
  env: Record<string, string | undefined>,
): void {
  for (const entry of entries) {
    if (env[entry.key]) continue;
    env[entry.key] = entry.value;
  }
}
