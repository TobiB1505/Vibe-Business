import {
  buildAttentionItems,
  TIER_ORDER,
  type AttentionItem,
  type AttentionKind,
} from "@/modules/projects/attention";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { productDisplayName } from "@/modules/projects/display-name";

/**
 * The account dashboard, as one ranked list.
 *
 * ## What changed, and why the screen was rebuilt around this
 *
 * The dashboard used to be organised by **object**: a signal card, a grid of
 * product cards, a connect band. A founder arriving asks a different question —
 * *what do I do?* — and the product already answers it: `buildAttentionItems`
 * ranks every waiting decision by tier, and the screen was throwing that
 * ordering away into a grid.
 *
 * So the screen is now the ranking. One column, most urgent first, the head
 * expanded into the decision itself and everything below it a row. It has no
 * dead half at any width, it shows the tier, it reads the same with one product
 * or twenty, and a product raising two items appears twice — which
 * `attention.ts` says in its own comment is the point.
 *
 * ## Why settled products are entries too
 *
 * Because "nothing waiting" is a real answer and a founder needs to see that
 * their third product is fine, not absent. They sort last, after every tier,
 * and they carry no action beyond opening the product.
 *
 * ## Why this is a pure function in its own file
 *
 * The ordering is the screen. A composition that derived it inline could not be
 * tested without a browser, and the one thing worth asserting here — that a
 * blocked item never sorts below a settled product — is a property of the list,
 * not of any pixel.
 */

export type DeskEntry =
  | {
      kind: "item";
      /** Stable across renders: the attention item's own id. */
      id: string;
      project: DashboardProject;
      item: AttentionItem;
    }
  | {
      kind: "settled";
      id: string;
      project: DashboardProject;
      item: null;
    };

/** What the head's control answers, so the row for it is not drawn twice. */
export function headAnswers(entry: DeskEntry | undefined): AttentionKind | null {
  return entry && entry.kind === "item" ? entry.item.kind : null;
}

export function buildDesk(projects: DashboardProject[]): DeskEntry[] {
  const items = buildAttentionItems(projects);
  const byId = new Map(projects.map((project) => [project.id, project]));

  const raised = new Set(items.map((item) => item.projectId));

  const itemEntries: DeskEntry[] = items.flatMap((item) => {
    const project = byId.get(item.projectId);
    // An item whose project is not in the list cannot be rendered and must not
    // be silently dropped into a half-row; it simply does not exist.
    return project ? [{ kind: "item" as const, id: item.id, project, item }] : [];
  });

  /*
   * Settled products, strongest first.
   *
   * By score rather than by name: the list above is ordered by urgency, and a
   * calm tail ordered alphabetically would read as a second, unrelated
   * ordering. An unscored product with nothing waiting cannot happen — a
   * product that has never been audited raises `never_audited` — so every
   * entry here has a score, and `-1` is only a guard, never a rendered zero.
   */
  const settledEntries: DeskEntry[] = projects
    .filter((project) => !raised.has(project.id))
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        productDisplayName(a).localeCompare(productDisplayName(b)),
    )
    .map((project) => ({
      kind: "settled" as const,
      id: `${project.id}:settled`,
      project,
      item: null,
    }));

  return [...itemEntries, ...settledEntries];
}

/** Exported so a test can assert the tier order without re-deriving it. */
export function entryRank(entry: DeskEntry): number {
  return entry.kind === "item" ? TIER_ORDER[entry.item.tier] : Object.keys(TIER_ORDER).length;
}
