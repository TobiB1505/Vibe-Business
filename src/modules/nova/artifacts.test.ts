import { describe, expect, it } from "vitest";
import { deriveNovaFocus, type FocusCandidateKind, type NovaFocusFacts } from "./focus";
import { buildNovaHomeView } from "./home-view";
import { BLOCK_FOR_MOMENT, BLOCK_FOR_OPERATION, type BlockKind } from "./blocks";
import {
  ARTIFACT_FOR_BLOCK,
  ARTIFACT_KINDS,
  artifactForEntry,
  artifactRefId,
  isArtifactKind,
  parseArtifactRef,
  WORKSPACE_ARTIFACT_PARAM,
  WORKSPACE_ARTIFACT_REF_PARAM,
  type ArtifactRef,
} from "./artifacts";

/**
 * Every moment either opens the right artifact or opens none.
 *
 * ## Why this is derived and not a table of expectations
 *
 * Because a table of expectations is a fourth copy of the mapping, and the
 * point of three total records is that there is one. What has to hold is that
 * the *chain* agrees: the block a moment shows, the artifact that block is, and
 * the reference this function builds. So the assertion asks the first two and
 * checks the third against them — which fails when any link in the chain moves,
 * and cannot pass by being changed alongside one.
 *
 * ## Why the facts are built here
 *
 * The lab already owns twenty-one fact sets, under `src/app/e2e/design-studies/`,
 * and they say of themselves that nothing under `/app` imports them. A module
 * test reaching into the fixture route for its inputs would tie the two
 * together in the direction that makes the fixtures load-bearing. These are the
 * smallest facts that raise the four moments carrying an artifact with an id or
 * without one, which is the only part of the space this function can get wrong.
 */

const NO_FACTS: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: false, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [],
  questions: [],
  moves: [],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: false,
  repositoryReadOutdated: false,
  workspaceChoiceRequired: false,
  working: null,
};

function primary(facts: Partial<NovaFocusFacts>) {
  return buildNovaHomeView(deriveNovaFocus({ ...NO_FACTS, ...facts })).primary;
}

/** The artifact the chain says this moment is about, asked of the tables. */
function expected(kind: FocusCandidateKind) {
  return ARTIFACT_FOR_BLOCK[BLOCK_FOR_MOMENT[kind]];
}

describe("the artifact a moment is about", () => {
  it("opens the audit on the moment that shows one", () => {
    const entry = primary({ auditOutdated: true });
    expect(entry.kind).toBe("audit_outdated");
    expect(artifactForEntry(entry)).toEqual({ kind: "business_health" });
    expect(artifactForEntry(entry)?.kind).toBe(expected(entry.kind));
  });

  it("carries the Move's own id, so the plan opens on it", () => {
    const entry = primary({ moves: [{ id: "move_7", rank: 1, title: "Add a pricing page" }] });
    expect(artifactForEntry(entry)).toEqual({ kind: "opportunity", opportunityId: "move_7" });
    expect(artifactForEntry(entry)?.kind).toBe(expected(entry.kind));
  });

  it("carries the change's own id, so the Agent opens on it", () => {
    const entry = primary({
      changes: [
        {
          preparedChangeId: "change_7",
          stage: "review_required",
          headline: "Two files changed on a branch",
          createdAt: "2026-09-11T09:00:00.000Z",
        },
      ],
    });
    expect(artifactForEntry(entry)).toEqual({
      kind: "prepared_change",
      preparedChangeId: "change_7",
    });
    expect(artifactForEntry(entry)?.kind).toBe(expected(entry.kind));
  });

  /**
   * A moment whose block is a sentence has no artifact, and says so.
   *
   * `nothing_to_do` is the case a placeholder would be most tempting on: the
   * thread is quiet and a link would fill it. It stays empty, because the link
   * would be to a page that answers a question nobody asked.
   */
  it("gives a moment with no block no artifact", () => {
    const entry = primary({});
    expect(entry.kind).toBe("nothing_to_do");
    expect(expected(entry.kind)).toBeNull();
    expect(artifactForEntry(entry)).toBeNull();
  });

  it("gives a disconnected source no artifact either", () => {
    const entry = primary({ sourceDisconnected: true });
    expect(artifactForEntry(entry)).toBeNull();
  });
});

describe("what a block opens", () => {
  it("decides every block kind, and names only kinds that exist", () => {
    const kinds = new Set<string>(ARTIFACT_KINDS);

    for (const [block, artifact] of Object.entries(ARTIFACT_FOR_BLOCK)) {
      if (artifact !== null) expect(kinds, block).toContain(artifact);
    }
  });

  /**
   * Every block the product can actually draw is decided here.
   *
   * The compiler already makes the record total over `BlockKind`. What it
   * cannot say is that the union and the two tables that produce it still
   * agree — so this asks the producers: every block a moment raises and every
   * block a run in flight raises is a row here. `blocks.ts` exports no list of
   * its kinds, and inventing one beside the union would be the copy these
   * records exist to avoid; the values of the two total tables *are* the list.
   */
  it("covers every block the product can draw", () => {
    const reachable = new Set<BlockKind>([
      ...Object.values(BLOCK_FOR_MOMENT),
      ...Object.values(BLOCK_FOR_OPERATION),
    ]);

    for (const block of reachable) {
      expect(Object.keys(ARTIFACT_FOR_BLOCK), block).toContain(block);
    }
    expect(reachable.size).toBeGreaterThan(1);
  });

  /**
   * A run is an event, not an object.
   *
   * `progress` draws the named stages of something still happening and `none`
   * draws nothing at all. Neither has a page that shows more than the thread
   * does, so a link on either would take a founder away from the only surface
   * telling them anything. Written down because "it has no artifact yet" and
   * "it has no artifact" look identical in a table.
   */
  it("gives a run in flight no address", () => {
    expect(ARTIFACT_FOR_BLOCK.progress).toBeNull();
    expect(ARTIFACT_FOR_BLOCK.none).toBeNull();
  });
});

describe("the artifact union", () => {
  it("names every kind once", () => {
    expect(new Set(ARTIFACT_KINDS).size).toBe(ARTIFACT_KINDS.length);
    expect(ARTIFACT_KINDS.length).toBeGreaterThan(5);
  });
});

/**
 * The workspace's address, and what it refuses (ADR 0109 §4, Slice 7).
 *
 * A query string is whatever somebody typed, and this is the one place a typed
 * string becomes a member of a closed union. Everything downstream — the pane,
 * the chip, the registry — takes an `ArtifactRef` and can therefore assume the
 * kind exists and the reference is present where the address interpolates one.
 */
describe("reading an artifact out of an address", () => {
  it("accepts every kind that has no reference", () => {
    const refless = ARTIFACT_KINDS.filter(
      (kind) => kind !== "opportunity" && kind !== "prepared_change",
    );

    for (const kind of refless) {
      expect(parseArtifactRef(kind, undefined), kind).toEqual({ kind });
    }
  });

  it.each([
    ["opportunity", "opportunityId"],
    ["prepared_change", "preparedChangeId"],
  ])("accepts %s with its reference", (kind, field) => {
    expect(parseArtifactRef(kind, "abc")).toEqual({ kind, [field]: "abc" });
  });

  /**
   * The empty frame ADR 0109 §4 refuses. `?artifact=opportunity` with no `ref`
   * would open the pane on "a Move" with no Move — so it opens on nothing, and
   * the pane says what it is for instead.
   */
  it.each(["opportunity", "prepared_change"])(
    "refuses %s without the reference its address needs",
    (kind) => {
      expect(parseArtifactRef(kind, undefined)).toBeNull();
      expect(parseArtifactRef(kind, "")).toBeNull();
    },
  );

  it.each([
    ["a kind that is not one of the eight", "preview"],
    ["a kind that was never one", "invoice"],
    ["something that is not a kind at all", "../../etc/passwd"],
  ])("refuses %s", (_name, kind) => {
    expect(parseArtifactRef(kind, "abc")).toBeNull();
  });

  it("refuses an absent parameter", () => {
    expect(parseArtifactRef(undefined, undefined)).toBeNull();
  });

  it("agrees with the membership test the thread schema uses", () => {
    for (const kind of ARTIFACT_KINDS) expect(isArtifactKind(kind)).toBe(true);
    expect(isArtifactKind("preview")).toBe(false);
  });
});

describe("the reference an artifact carries", () => {
  it.each<[ArtifactRef, string | null]>([
    [{ kind: "business_health" }, null],
    [{ kind: "opportunity", opportunityId: "opp_1" }, "opp_1"],
    [{ kind: "prepared_change", preparedChangeId: "chg_1" }, "chg_1"],
  ])("reads %o", (artifact, expected) => {
    expect(artifactRefId(artifact)).toBe(expected);
  });

  /**
   * Round-tripping is the property that matters: what `artifactRefId` produces
   * is what `parseArtifactRef` is handed back out of a URL, so the two have to
   * agree for every kind. Total over the union, so a ninth fails here.
   */
  it("round-trips every kind through the address", () => {
    for (const kind of ARTIFACT_KINDS) {
      const artifact = parseArtifactRef(kind, "ref_1");
      expect(artifact, kind).not.toBeNull();
      expect(parseArtifactRef(kind, artifactRefId(artifact!) ?? undefined), kind).toEqual(artifact);
    }
  });
});

describe("the parameter names", () => {
  /**
   * Two parameters rather than one packed string, and they are asserted because
   * every link in the product spells them and a rename would silently stop
   * every existing address resolving.
   */
  it("are the two the addresses spell", () => {
    expect(WORKSPACE_ARTIFACT_PARAM).toBe("artifact");
    expect(WORKSPACE_ARTIFACT_REF_PARAM).toBe("ref");
  });
});
