/**
 * Where a project lives, in one place.
 *
 * ## What this fixes
 *
 * `/app/projects/${projectId}` was built from parts in three files that did
 * not know about each other: `project-shell.tsx`'s `projectSectionHref`,
 * `modules/projects/attention.ts`'s `projectHref`, and a private `homePath` in
 * Nova's dispatch. Only the first was tested. Three owners of one address is
 * three chances for a founder's link to point somewhere that no longer exists,
 * and the only reason it had not happened is that nobody had changed the shape.
 *
 * ## Why it is here and not in the shell
 *
 * `src/lib` sits below the features and the components, so a domain module may
 * read it (rule 86) — and `attention.ts` is a domain module that publishes
 * hrefs. The section *table* stays in `project-shell.tsx`, because a section
 * has a label and an icon and those are presentation; what moves here is the
 * part that is pure string arithmetic over a project id and a segment.
 *
 * ADR 0058's parameters are deliberately **not** here. `?plan=`, `?change=`
 * and `#planned-work` belong to `modules/action-plans/source.ts`, which owns
 * the sanitiser that reads them back; splitting a contract from its own
 * validator is how the two stop agreeing.
 */

/** A project's own address — the index, which is Nova. */
export function projectPath(projectId: string): string {
  return `/app/projects/${projectId}`;
}

/**
 * A section of a project, by URL segment.
 *
 * An empty segment is the index rather than a trailing slash, because the
 * index *is* a section — `PROJECT_SECTIONS[0]` carries `segment: ""` — and a
 * caller should not have to special-case it.
 */
export function projectSectionPath(projectId: string, segment: string): string {
  return segment ? `${projectPath(projectId)}/${segment}` : projectPath(projectId);
}

/**
 * A project's conversation, and one thread of it.
 *
 * Two functions because they answer two questions. `threadsPath` is *this
 * project's conversations* — the list, which is the shell's *Threads*
 * destination and where a founder goes to pick one up again. `threadPath` is
 * one exact thread, which is what a bookmark, a notification, a link from a
 * screen and a founder's own history want.
 *
 * Kept here beside the section paths rather than in the thread feature, for
 * the reason this file exists at all: an address with two owners is an address
 * that eventually points at two places.
 */
export function threadsPath(projectId: string): string {
  return `${projectPath(projectId)}/threads`;
}

export function threadPath(projectId: string, threadId: string): string {
  return `${threadsPath(projectId)}/${threadId}`;
}

/**
 * The anchor one prepared change is addressed by inside the Agent screen.
 *
 * A fragment rather than a route: a prepared change is one card in a list whose
 * point is that every artifact stays reachable. One function produces the id
 * and one produces the URL that targets it, so the link and the anchor cannot
 * drift.
 */
export function preparedChangeAnchorId(preparedChangeId: string): string {
  return `prepared-change-${preparedChangeId}`;
}

export function preparedChangeHref(preparedHref: string, preparedChangeId: string): string {
  return `${preparedHref}#${preparedChangeAnchorId(preparedChangeId)}`;
}
