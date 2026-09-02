/**
 * Where the browser suite finds Chromium.
 *
 * Playwright locates its browser by a version-stamped directory name: version
 * 1.62.1 looks for `chromium-1234` and nothing else. A container that ships a
 * different build — this repository's own agent image ships `chromium-1194` —
 * therefore has a working Chromium that Playwright will not use, and
 * `pnpm test:e2e` fails with "Executable doesn't exist" while the executable
 * sits one directory away. Eight consecutive sprint records recorded "no E2E
 * run — the same container limitation" for exactly this reason.
 *
 * The rule below is the narrow one: **the registry always wins.** An override
 * is produced only when the version-stamped path Playwright asked for does not
 * exist, which is never the case on a machine or a CI runner that ran
 * `playwright install`. A resolver that preferred a fallback would silently
 * pin a stale browser in CI, which is a worse problem than the one it solves.
 */

/** Injected so the decision is testable without a filesystem. */
export type BrowserLookup = {
  /** What Playwright's own registry asked for, or `null` if it cannot say. */
  registryPath: string | null;
  /** `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, when an operator names one. */
  named?: string | undefined;
  /** `PLAYWRIGHT_BROWSERS_PATH`, the root the image installs under. */
  browsersRoot?: string | undefined;
  exists: (path: string) => boolean;
};

/**
 * The executable to hand Playwright, or `undefined` to leave it alone.
 *
 * `undefined` covers two cases on purpose: the registry browser is present
 * (nothing to fix), and no candidate exists at all (Playwright's own
 * "run `playwright install`" message is the correct thing for a developer to
 * read, and inventing a path here would replace it with a worse one).
 */
export function resolveChromiumExecutable(lookup: BrowserLookup): string | undefined {
  const { registryPath, named, browsersRoot, exists } = lookup;

  if (registryPath !== null && exists(registryPath)) return undefined;

  const candidates = [named, browsersRoot ? `${browsersRoot}/chromium` : undefined];

  return candidates.find(
    (candidate): candidate is string => Boolean(candidate) && exists(candidate!),
  );
}
