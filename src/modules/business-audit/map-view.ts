import {
  BUSINESS_LENSES,
  type AuditSynthesis,
  type BusinessConclusion,
  type BusinessLens,
  type BusinessLensAssessment,
  type LensHealth,
  type LensMateriality,
} from "./schema";

/**
 * The Business Map view model (AUDIT UI-1, direction 1b).
 *
 * ## What this file refuses to do
 *
 * Invent intelligence. Direction 1b draws a business as one connected system,
 * and the temptation in a map is to draw the connections that make the picture
 * read well. Everything here is derived from what the audit actually said, and
 * where the data does not support a line, no line is drawn (§15, §25, §53).
 *
 * The one place that bites is 1b's best idea — "what this lens holds up".
 * A *directional* dependency is not in the contract: the audit records which
 * lenses a root problem spans, not which lens blocks which. So this exposes the
 * grounded half — lenses the audit itself put inside one root problem — and
 * calls it what it is. Drawing arrows would be a claim the model never made,
 * and a plausible arrow is worse than a missing one.
 *
 * ## Two axes, two channels
 *
 * `health` and `materiality` are independent and must stay that way on screen
 * (§3). Materiality decides where a node sits — the ring — and health decides
 * how it is drawn. A weak lens can therefore sit in the outer ring, which is
 * exactly the sentence CORE-2a.3.1 spent a sprint making the audit able to say.
 */

/** Rings, outward. Position carries *when*, never *how bad*. */
export const MAP_RINGS = ["now", "soon", "later"] as const;
export type MapRing = (typeof MAP_RINGS)[number];

/**
 * Where a lens sits.
 *
 * `not_material` and `unknown` are deliberately placed in the outer ring rather
 * than given rings of their own: both mean "not something to act on today", and
 * a fourth and fifth orbit would encode a precision the audit does not have.
 * The node's own label still says which it is, so nothing is lost — only the
 * geometry is simplified.
 */
export function ringFor(materiality: LensMateriality): MapRing {
  if (materiality === "now") return "now";
  if (materiality === "soon") return "soon";
  return "later";
}

export type LensNode = {
  lens: BusinessLens;
  /** Human label for the lens, since the key is internal vocabulary. */
  label: string;
  health: LensHealth;
  score: number | null;
  materiality: LensMateriality;
  ring: MapRing;
  summary: string;
  /** 1-based position in the blocker list, when this lens produced one. */
  blockerRank: number | null;
  /** Lenses the audit placed inside the same root problem as this one. */
  relatedLenses: BusinessLens[];
  /** What only the founder could answer here. Usually empty. */
  missingContext: string[];
  evidenceIds: string[];
  /** Angle in degrees around the centre, for the radial layout. */
  angle: number;
};

export const LENS_LABELS: Record<BusinessLens, string> = {
  offer: "Offer",
  audience: "Audience",
  revenue_economics: "Revenue & Economics",
  acquisition: "Acquisition",
  conversion: "Conversion",
  retention: "Retention",
  measurement: "Measurement",
  business_readiness: "Business Readiness",
  scalability: "Scalability",
};

/**
 * How a health value reads to someone who is not holding the schema.
 *
 * `blocked_by_missing_context` becomes "unknown" rather than "blocked", because
 * blocked sounds like a failure of the product. It is a failure of Vibe's
 * information, and §50 says so explicitly.
 */
export const HEALTH_LABELS: Record<LensHealth, string> = {
  strong: "Strong",
  adequate: "Adequate",
  weak: "Weak",
  unclear: "Unknown",
  blocked_by_missing_context: "Unknown",
};

export const MATERIALITY_LABELS: Record<LensMateriality, string> = {
  now: "Now",
  soon: "Soon",
  later: "Later",
  not_material: "Not relevant here",
  unknown: "Unknown",
};

/**
 * Where evidence came from, in the founder's terms (§22).
 *
 * Derived from the id prefix, which is a real property of the evidence pack
 * rather than a guess: `live.` is the public site, `repo.` the code, `auth.`
 * the signed-in scan, `intent.` the founder's own answers, and `profile.`
 * Vibe's derived understanding. An unrecognised prefix returns null, so a new
 * source shows no label instead of a wrong one.
 */
export function evidenceSource(evidenceId: string): string | null {
  const prefix = evidenceId.split(".")[0];
  switch (prefix) {
    case "live":
      return "from your live site";
    case "repo":
      return "from your code";
    case "auth":
      return "from your signed-in product";
    case "intent":
    // The same thing under an older name: `evidence.ts` emits `business.*`
    // where `evidence-v3.ts` emits `intent.*`, and a stored audit can carry
    // either. This table knew only the newer one, so every citation of a
    // founder's own answers on an older audit rendered with no source line at
    // all (UI-7 §2).
    case "business":
      return "from your answers";
    case "profile":
      return "from what Vibe understood";
    default:
      return null;
  }
}

/** Distinct sources behind a set of evidence ids. Order follows first use. */
export function evidenceSources(evidenceIds: readonly string[]): string[] {
  const seen: string[] = [];
  for (const id of evidenceIds) {
    const source = evidenceSource(id);
    if (source !== null && !seen.includes(source)) seen.push(source);
  }
  return seen;
}

/**
 * How many distinct observations this audit rests on.
 *
 * Counted from the evidence actually cited across every lens and conclusion,
 * not from the size of the pack. 1b's header carries this number to say "this
 * judgment came from a real analysis", and it would say the opposite if it
 * counted things the audit never used.
 */
export function countSignals(synthesis: AuditSynthesis): number {
  const cited = new Set<string>();
  for (const lens of synthesis.lenses) for (const id of lens.evidenceIds) cited.add(id);
  for (const conclusion of [...synthesis.blockers, ...synthesis.strengths]) {
    for (const id of conclusion.evidenceIds) cited.add(id);
  }
  return cited.size;
}

/**
 * A connection between two lenses, and the reason it exists.
 *
 * Only ever produced from a root problem the audit itself wrote. `rootProblem`
 * travels with the edge so the UI can say *why* two areas are linked instead of
 * leaving a line to be interpreted.
 */
export type LensConnection = {
  from: BusinessLens;
  to: BusinessLens;
  /** Headline of the conclusion that ties them together. */
  reason: string;
};

/**
 * Every pair of lenses the audit put inside one conclusion.
 *
 * Undirected, because the data is undirected. 1b draws "Revenue holds up
 * Scalability"; the contract supports only "Revenue and Scalability are the
 * same problem". Rendering the second as if it were the first would be exactly
 * the invented intelligence §25 forbids.
 */
export function connectionsFrom(conclusions: readonly BusinessConclusion[]): LensConnection[] {
  const edges: LensConnection[] = [];
  const seen = new Set<string>();

  for (const conclusion of conclusions) {
    for (let i = 0; i < conclusion.lenses.length; i += 1) {
      for (let j = i + 1; j < conclusion.lenses.length; j += 1) {
        const [from, to] = [conclusion.lenses[i]!, conclusion.lenses[j]!].sort() as [
          BusinessLens,
          BusinessLens,
        ];
        const key = `${from}:${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from, to, reason: conclusion.headline });
      }
    }
  }

  return edges;
}

export type BusinessMap = {
  nodes: LensNode[];
  connections: LensConnection[];
  /** Distinct evidence references behind the whole audit. */
  signalCount: number;
  /** Lens count actually assessed, for the header's "9 lenses". */
  assessedCount: number;
};

/**
 * Angles are fixed per lens, not derived from the data.
 *
 * A layout that reshuffled as materiality changed would make two audits of the
 * same business unrecognisable to each other — and the re-audit loop depends on
 * a founder seeing a node *move inward*. Position around the circle is
 * identity; distance from the centre is the judgment.
 */
const ANGLE_STEP = 360 / BUSINESS_LENSES.length;

export function buildBusinessMap(synthesis: AuditSynthesis): BusinessMap {
  const byLens = new Map(synthesis.lenses.map((entry) => [entry.lens, entry]));
  const connections = connectionsFrom([...synthesis.blockers, ...synthesis.strengths]);

  const blockerRankOf = new Map<BusinessLens, number>();
  synthesis.blockers.forEach((blocker, index) => {
    for (const lens of blocker.lenses) {
      if (!blockerRankOf.has(lens)) blockerRankOf.set(lens, index + 1);
    }
  });

  const nodes = BUSINESS_LENSES.map((lens, index): LensNode => {
    const assessment: BusinessLensAssessment | undefined = byLens.get(lens);
    const materiality = assessment?.materiality ?? "unknown";

    return {
      lens,
      label: LENS_LABELS[lens],
      // An unassessed lens reads as unknown rather than being hidden: nine
      // areas are the framework, and a missing one is information too.
      health: assessment?.health ?? "unclear",
      score: assessment?.score ?? null,
      materiality,
      ring: ringFor(materiality),
      summary: assessment?.summary ?? "",
      blockerRank: blockerRankOf.get(lens) ?? null,
      relatedLenses: connections
        .filter((edge) => edge.from === lens || edge.to === lens)
        .map((edge) => (edge.from === lens ? edge.to : edge.from)),
      missingContext: assessment?.missingContext ?? [],
      evidenceIds: assessment?.evidenceIds ?? [],
      // Starts at the top and runs clockwise, so the first lens is where a
      // reader's eye already is.
      angle: index * ANGLE_STEP - 90,
    };
  });

  return {
    nodes,
    connections,
    signalCount: countSignals(synthesis),
    assessedCount: synthesis.lenses.length,
  };
}

/**
 * Lenses grouped by ring, for the mobile representation (§17, §46, §64).
 *
 * The same information architecture as the radial map, in reading order. A
 * shrunken circle at 375px is a picture of a business nobody can read, and the
 * priority buckets carry the identical judgment without the geometry.
 */
export function lensesByRing(map: BusinessMap): { ring: MapRing; nodes: LensNode[] }[] {
  return MAP_RINGS.map((ring) => ({
    ring,
    nodes: map.nodes.filter((node) => node.ring === ring),
  })).filter((group) => group.nodes.length > 0);
}
