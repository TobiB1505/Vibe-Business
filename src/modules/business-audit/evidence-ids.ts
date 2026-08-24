/**
 * The evidence id vocabulary, and how to read one under the pack that minted it.
 *
 * ## Why this module exists
 *
 * An evidence id is a citation. It is written into four durable places —
 * `business_opportunities.evidence_ids`, `action_plan_steps.evidence_ids`,
 * `business_readiness_audits.result` and `product_profiles.result` — and it is
 * read back years later by a screen, a risk classifier, a pricing class and a
 * validation depth. So the meaning of an id cannot be changed by editing the
 * code that mints it: every id already stored keeps whatever it meant when it
 * was written, and rewriting those rows would falsify a record of what a model
 * actually concluded.
 *
 * That is what makes this version-aware rather than a lookup table.
 *
 * ## The ambiguity being closed
 *
 * Through `business-evidence.v3`, `buildRepositoryEvidence` minted the same
 * `repo.surface.payments` whether it found a payments surface or not. Polarity
 * lived only in the pack's `label` — "Repository surface not detected:
 * Payments" — which is not carried on the citation. A reader given the id alone
 * could not tell presence from absence, and Sprint 0073 found the consequence
 * on screen: the "Why?" disclosure told founders their code contained a thing
 * Vibe had just recorded it does not contain.
 *
 * 0073 fixed the sentence and deliberately left the id alone, because renaming
 * it is this module.
 *
 * ## Polarity lives in the namespace, not in a suffix
 *
 * The obvious design — `repo.surface.payments_missing` — is wrong here, and the
 * reason is specific rather than aesthetic. `execution-contract/live-premise.ts`
 * selects the ids it will revalidate with `startsWith("live.")` **and**
 * `endsWith("_missing")`. Sprint 0072 narrowed that to defect ids on purpose:
 * a positive surface's absence is ambiguous — renamed, behind auth, or simply
 * not reached — and refusing a paid run on that guess is a worse failure than
 * the one being prevented.
 *
 * Giving `live.surface.*` a `_missing` variant would silently re-widen that
 * gate to exactly the ids 0072 excluded, and nothing would fail: paid runs
 * would just start being refused on ambiguous evidence. A separate namespace
 * has no such reach. It also avoids adding a fifth entry to the absence-suffix
 * vocabulary (`_missing`, `_not_observed`, `_not_found`, `.not_found`) that
 * 0073 already named as too many.
 *
 * There is a second, quieter benefit. Every existing prefix matcher over
 * `repo.surface.` — `validation/depth.ts`'s sensitive list,
 * `economy/execution-class.ts`, `execution-context/surface.ts` — keeps seeing
 * only *present* surfaces, unchanged. Where absence should also count, it has
 * to be added explicitly, which is a reviewable line rather than an accident of
 * string matching.
 */

/** Packs whose surface ids encode no polarity. A citation from one is ambiguous. */
const POLARITY_FREE_PACKS: readonly string[] = ["business-evidence.v1", "business-evidence.v2", "business-evidence.v3"];

export const SURFACE_NAMESPACES = {
  repo: { present: "repo.surface.", absent: "repo.surface_absent." },
  live: { present: "live.surface.", absent: "live.surface_absent." },
} as const;

export type SurfaceNamespace = keyof typeof SURFACE_NAMESPACES;

/**
 * What a surface citation says about the surface.
 *
 * `unknown` is not a failure and not a degraded reading — it is the honest
 * answer for a citation minted by a pack that did not record polarity. A
 * consumer that needs presence must treat it as "the check was made", which is
 * all the id ever supported.
 */
export type SurfacePolarity = "present" | "absent" | "unknown";

export type SurfaceCitation = {
  namespace: SurfaceNamespace;
  /** The bare surface id, with no namespace and no polarity attached. */
  surfaceId: string;
  polarity: SurfacePolarity;
};

/**
 * Reads a surface citation under the rules of the pack that minted it.
 *
 * Returns null for anything that is not a surface citation, which is most ids —
 * callers use that to fall through to their own handling rather than to detect
 * an error.
 *
 * `packVersion` is the version recorded on the row the citation came from, not
 * the current constant. Passing today's version for a stored citation is the
 * one way to misuse this function, and it is the mistake the whole module
 * exists to make hard: it would read a v3 id, which cannot express presence, as
 * though its silence meant presence.
 */
export function readSurfaceCitation(evidenceId: string, packVersion: string): SurfaceCitation | null {
  const polarityFree = POLARITY_FREE_PACKS.includes(packVersion);

  for (const namespace of ["repo", "live"] as const) {
    const { present, absent } = SURFACE_NAMESPACES[namespace];

    // Absent is checked first: `repo.surface_absent.` does not start with
    // `repo.surface.`, but reversing these would still be a latent trap for a
    // future namespace that does.
    if (evidenceId.startsWith(absent)) {
      return { namespace, surfaceId: evidenceId.slice(absent.length), polarity: "absent" };
    }

    if (evidenceId.startsWith(present)) {
      return {
        namespace,
        surfaceId: evidenceId.slice(present.length),
        polarity: polarityFree ? "unknown" : "present",
      };
    }
  }

  return null;
}

/** Mints the id for a surface whose presence is known. v4 packs only. */
export function surfaceEvidenceId(
  namespace: SurfaceNamespace,
  surfaceId: string,
  detected: boolean,
): string {
  const { present, absent } = SURFACE_NAMESPACES[namespace];
  return `${detected ? present : absent}${surfaceId}`;
}
