/**
 * Files the run tried to change and policy refused (audit R30).
 *
 * They are not in the change — that is what being refused means — so the diff
 * cannot show them, and their absence is indistinguishable from never having
 * been touched. On the surface a person approves from, that difference matters:
 * a founder who asked for a change to their environment file and sees no
 * mention of it should learn that Vibe declined, not conclude it forgot.
 *
 * Vibe's own observation of the run, never the agent's account of itself
 * (CLAUDE.md rule 77). A refusal is a fact about the run rather than a fault,
 * so this states it and offers nothing to press.
 */
export function WithheldPaths({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="withheld-paths">
      <p className="text-fg-secondary text-ui">
        {paths.length === 1
          ? "One file the run was not allowed to change:"
          : `${paths.length} files the run was not allowed to change:`}
      </p>
      <ul className="flex flex-col gap-1">
        {paths.map((path) => (
          <li key={path} className="text-fg-muted font-mono text-meta break-all">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}
