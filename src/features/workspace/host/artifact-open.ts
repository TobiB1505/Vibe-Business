import { PROJECT_SECTIONS, PROJECT_SUBSECTIONS } from "@/features/shell/project-shell";
import type { ArtifactRef } from "@/modules/nova/artifacts";
import { artifactHref, ARTIFACT_SEGMENT } from "../registry/artifacts";

/**
 * How a founder leaves the conversation for the thing itself.
 *
 * ## What the workspace is, before it is a column
 *
 * [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §4 says the artifact is the pane beside the thread on a desktop and the
 * bottom sheet below `lg`. Neither is here yet, and the reason is geometry
 * rather than appetite: at 1280 the project rail takes 256px and Nova's work
 * column takes 300 more, which leaves the thread about 640 — a third column
 * splits that into two unreadable ones, and a prepared change's review gate in
 * 300px is not a smaller version of the screen, it is a different one.
 *
 * The rail is what has to go first, and it goes in Slice 7, which is the slice
 * that owns the navigation. So this slice ships the half of §4 that does not
 * need a column: **the address**. An artifact in the thread now names where it
 * is read in full, which is the sentence *"its full-page address is how a
 * founder leaves the conversation for it"* — and it was true of nothing before,
 * because no block in the thread carried a link at all.
 *
 * ## Why the label is looked up and not written here
 *
 * Because it is already written twice — `PROJECT_SECTIONS.label` for the rail
 * and `WORKSPACE_SECTION_HEADINGS.title` for the page — and a third copy in the
 * registry would be the drift `WORKSPACE_SECTION_HEADINGS` exists to record
 * having already happened. The registry holds the **segment**, which is the
 * address; the name of the destination belongs to the table that names
 * destinations.
 *
 * A segment naming no section throws rather than returning a link labelled with
 * a URL fragment. It is unreachable twice over: `ARTIFACT_SEGMENT` is typed
 * against both section tables, so the compiler refuses one, and
 * `artifacts.test.ts` asks the same question of the values. The branch says so
 * rather than quietly producing something, which is what an unreachable branch
 * is for.
 */
export type ArtifactOpen = {
  /** The artifact's full-page address, parameters and fragment included. */
  href: string;
  /** What that destination calls itself, from the section table. */
  label: string;
};

export function artifactOpen(projectId: string, artifact: ArtifactRef): ArtifactOpen {
  return {
    href: artifactHref(projectId, artifact),
    label: sectionLabel(ARTIFACT_SEGMENT[artifact.kind]),
  };
}

function sectionLabel(segment: string): string {
  const section = PROJECT_SECTIONS.find((candidate) => candidate.segment === segment);
  if (section) return section.label;

  const subsection = PROJECT_SUBSECTIONS.find((candidate) => candidate.segment === segment);
  if (subsection) return subsection.label;

  throw new Error(`No workspace section is addressed by "${segment}"`);
}
