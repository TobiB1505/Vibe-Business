import { AUTHENTICATED_SURFACE_LABELS } from "@/modules/authenticated-product-intelligence/schema";
import type { AuthenticatedSurfaceId } from "@/modules/authenticated-product-intelligence/schema";

/**
 * Human-readable resolution of a cited evidence id (Sprint 6 §12).
 *
 * An audit stores the ids it cited, not the pack it was given, so this resolves
 * from the id alone — which works because evidence ids are deliberately
 * self-describing (`auth.surface.billing_not_observed` says both what and
 * which way round).
 *
 * It exists so "Why?" can answer in the product's language instead of showing
 * an internal identifier, and it never reaches for the snapshot: no page paths,
 * no headings, no JSON. An id it does not recognise degrades to a readable
 * rendering of the id itself rather than to a guess.
 */

export type EvidenceIdDescription = {
  /** Which source the fact came from. */
  source: string;
  /** What the fact was about. */
  detail: string;
};

const SOURCE_LABELS: Record<string, string> = {
  repo: "Repository",
  live: "Public website",
  business: "Business context",
  auth: "Authenticated product",
};

const NOT_OBSERVED_SUFFIX = "_not_observed";

function humanize(value: string): string {
  const words = value.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isSurfaceId(value: string): value is AuthenticatedSurfaceId {
  return Object.hasOwn(AUTHENTICATED_SURFACE_LABELS, value);
}

export function describeEvidenceId(id: string): EvidenceIdDescription {
  const separator = id.indexOf(".");
  const prefix = separator === -1 ? "" : id.slice(0, separator);
  const rest = separator === -1 ? id : id.slice(separator + 1);
  const source = SOURCE_LABELS[prefix] ?? "Evidence";

  // Absence is stated as absence. Rendering `..._not_observed` as if it were a
  // detection would invert the meaning of the citation.
  const observed = !rest.endsWith(NOT_OBSERVED_SUFFIX);
  const body = observed ? rest : rest.slice(0, -NOT_OBSERVED_SUFFIX.length);

  if (prefix === "auth") {
    const surface = body.startsWith("surface.") ? body.slice("surface.".length) : null;
    if (surface !== null && isSurfaceId(surface)) {
      return {
        source,
        detail: observed
          ? `${AUTHENTICATED_SURFACE_LABELS[surface]} detected`
          : `${AUTHENTICATED_SURFACE_LABELS[surface]} not observed`,
      };
    }

    if (body.startsWith("action.")) {
      // Presence only, and the wording says so — a control on a page is not a
      // working feature (Sprint 6 §4).
      return { source, detail: `Action control present: ${humanize(body.slice("action.".length))}` };
    }
  }

  return { source, detail: observed ? humanize(body) : `${humanize(body)} — not observed` };
}
