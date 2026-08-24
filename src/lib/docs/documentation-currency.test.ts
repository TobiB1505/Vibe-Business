import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 0056 — the structural half of [ADR 0039](docs/decisions/0039-documentation-currency.md).
 *
 * ## Why this exists
 *
 * The documentation drifted for roughly fifty sprints, and the reason is not
 * that nobody noticed. Sprint 0032 noticed: it found that `/login` and
 * `/signup` promise "Read-only access to start" while execution and merge both
 * write refs, wrote the finding down precisely as an open risk, and left it —
 * for twenty sprints. A finding without a failing check is a note.
 *
 * So the mechanism, not the vigilance, is what this file changes: **nothing in
 * this repository failed when a document stopped being true.** Lint did not.
 * `tsc` did not. Five thousand tests did not. The build did not. Now five
 * things do.
 *
 * ## What this asserts, and what it cannot
 *
 * It asserts **structure**: that every record is reachable from its index, that
 * every index row points at something, that every relative link resolves, that
 * every decision is visible from the map, and that a specific list of retired
 * claims has not come back to the file it was retired from.
 *
 * It cannot assert that any prose is **true**. A Decision Index row can name
 * the wrong layer and stay green. `RETIRED_CLAIMS` holds the drift Sprint 0056
 * found and is silent about drift it missed. Saying that here is what keeps a
 * green suite from being read as a guarantee of accuracy — the same discipline
 * rule 66 applies to `sandbox_validation_passed`.
 *
 * ## What is deliberately not asserted
 *
 * - **Module README presence.** Eleven modules have none. A README written to
 *   satisfy a test is the "list of intentions pretending to be documentation"
 *   that `docs/business/README.md` bans, and asserting presence would *bless*
 *   the three dead stub directories rather than retire them. Recorded as a gap
 *   in `docs/ROADMAP.md` instead.
 * - **No duplicate sprint numbers.** `0054` is used twice, and fixing it means
 *   renaming a file four documents link to.
 * - **Anchor validation.** A slugifier that disagrees with GitHub's would fail
 *   links that work.
 * - **Doc-to-code numeric couplings** — "18 rows", "n=5", "bounded at 3". Those
 *   belong beside the code they describe, not in a repo-wide docs test that
 *   would become a junk drawer.
 */

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs");
const SPRINTS = join(DOCS, "sprints");
const DECISIONS = join(DOCS, "decisions");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Every `.md` under `dir`, at any depth, relative to the repository root. */
function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [relative(ROOT, full)] : [];
  });
}

/** Markdown link targets, minus the anchor, minus anything not a local path. */
function relativeLinkTargets(source: string): string[] {
  return [...source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1].split("#")[0])
    .filter((target) => target.length > 0)
    .filter((target) => !/^(?:https?:|mailto:|tel:|data:|#|\/)/.test(target));
}

/* ---------------------------------------------------------------------------
 * A — the sprint record is reachable, in both directions
 * ------------------------------------------------------------------------ */

describe("every sprint record is reachable from the sprint index", () => {
  const indexPath = join(SPRINTS, "README.md");
  const index = read(indexPath);
  const documents = readdirSync(SPRINTS).filter((f) => f.endsWith(".md") && f !== "README.md");
  const linked = new Set(relativeLinkTargets(index));

  it("finds the sprint documents it is supposed to be checking", () => {
    // The guard on the guard: a walk that silently found nothing would pass
    // every assertion below while covering none of them.
    expect(documents.length).toBeGreaterThan(50);
  });

  it("links every sprint document from the index", () => {
    const missing = documents.filter((f) => !linked.has(f));
    expect(
      missing,
      `These sprint records exist and no row in docs/sprints/README.md points at them, ` +
        `so they are invisible to anyone reading the index: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("points every index row at a file that exists", () => {
    const dangling = [...linked].filter(
      (target) => /^\d/.test(target) && !existsSync(join(SPRINTS, target)),
    );
    expect(
      dangling,
      `docs/sprints/README.md links these, and they do not exist: ${dangling.join(", ")}`,
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * B — the decision record is indexed, and its numbering is unambiguous
 * ------------------------------------------------------------------------ */

describe("every decision is indexed, once, under its own number", () => {
  const adrs = readdirSync(DECISIONS)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort();
  const index = read(join(DECISIONS, "README.md"));
  const linked = new Set(relativeLinkTargets(index));

  it("finds the ADRs it is supposed to be checking", () => {
    expect(adrs.length).toBeGreaterThan(30);
  });

  it("gives every ADR an index row", () => {
    const missing = adrs.filter((f) => !linked.has(f));
    expect(
      missing,
      `These ADRs have no row in docs/decisions/README.md: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("uses each number exactly once", () => {
    const seen = new Map<string, string[]>();
    for (const file of adrs) {
      const number = file.slice(0, 4);
      seen.set(number, [...(seen.get(number) ?? []), file]);
    }
    const duplicated = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(
      duplicated.map(([number, files]) => `${number}: ${files.join(" + ")}`),
      "Two ADRs sharing a number means every reference to that number is ambiguous",
    ).toEqual([]);
  });

  /**
   * Two heading styles coexist and both are house style: `# 0009 - Title` and
   * `# ADR 0010 — Title`. Reformatting fourteen records to unify them would be
   * a cosmetic edit to immutable documents, so the pattern accepts both. What
   * is checked is the number, which is the part that can be wrong.
   */
  it("matches each ADR's heading number to its filename", () => {
    const mismatched = adrs.flatMap((file) => {
      const heading = read(join(DECISIONS, file)).match(/^#\s*(?:ADR\s+)?(\d{4})\b/m);
      if (!heading) return [`${file}: no numbered "#" heading`];
      return heading[1] === file.slice(0, 4) ? [] : [`${file}: heading says ${heading[1]}`];
    });
    expect(
      mismatched,
      "A heading number that disagrees with its filename makes every citation of that ADR ambiguous",
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * C — every relative link resolves
 * ------------------------------------------------------------------------ */

describe("every relative link in the documentation resolves", () => {
  const files = [
    ...readdirSync(ROOT).filter((f) => f.endsWith(".md")),
    ...markdownFiles(DOCS),
  ];

  it("finds the documents it is supposed to be checking", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("resolves every target", () => {
    const broken = files.flatMap((file) => {
      const base = dirname(join(ROOT, file));
      return relativeLinkTargets(read(join(ROOT, file)))
        .filter((target) => !existsSync(resolve(base, target)))
        .map((target) => `${file} → ${target}`);
    });
    expect(
      broken,
      "A link that does not resolve is the cheapest possible kind of false statement, " +
        "and it is also how a ROADMAP entry whose evidence path was deleted gets caught",
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * D — retired claims do not come back
 * ------------------------------------------------------------------------ */

/**
 * The forcing function, and the only assertion here that is about *meaning*.
 *
 * ## Why this is scoped per file rather than repository-wide
 *
 * A global substring ban would break this repository, and not incidentally —
 * it would break it on exactly the documents that are working correctly.
 * `docs/sprints/0032-uis1-first-ten-minutes.md` quotes the read-only assurance
 * as the defect it found. ADR 0024 quotes `ARCHITECTURE.md` §3.11's credit
 * sentence as the state it supersedes. Both are records doing their job.
 *
 * **History may say it; a current-state document may not.** That distinction is
 * this assertion's whole design, and it is why every entry names one path.
 *
 * `retiredBy` is not decoration: it is what tells the next person whether the
 * claim is false, or merely differently phrased now. When a claim becomes true
 * again — a permission changes, a feature ships — the entry is deleted, and the
 * commit that deletes it is the record of that.
 */
const RETIRED_CLAIMS: readonly { path: string; claim: string; retiredBy: string }[] = [
  {
    path: "src/app/login/page.tsx",
    claim: "Read-only access to start",
    retiredBy:
      "Sprint 0056 — execution creates blobs, trees, commits and refs, and an approved merge " +
      "fast-forwards the default branch. Both are gated on Contents: write. Describe behaviour, " +
      "not the grant.",
  },
  {
    path: "src/app/signup/page.tsx",
    claim: "Read-only access to start",
    retiredBy: "Sprint 0056 — as src/app/login/page.tsx.",
  },
  {
    path: "src/app/app/(account)/page.tsx",
    claim: "Read-only access to start",
    retiredBy: "Sprint 0056 — as src/app/login/page.tsx.",
  },
  {
    path: "docs/setup/github-app.md",
    claim: "Do not set Contents: Read and write",
    retiredBy:
      "Sprint 0056 — following that instruction provisions an App on which every execution and " +
      "every merge fails. Contents: Read and write is required, and has been since Sprint 11.",
  },
  {
    path: "ARCHITECTURE.md",
    claim: "no margin, credits, or billing exist yet",
    retiredBy: "Sprint 0056 — ADR 0024 and ADR 0025. The ledger, lots, Stripe and settlement exist.",
  },
  {
    path: "ARCHITECTURE.md",
    claim: "Implementation has not yet started",
    retiredBy: "Sprint 0056 — fifty-four sprints had shipped when this sentence was removed.",
  },
  {
    path: "PRODUCT.md",
    claim: "the core loop described in PRODUCT.md is not built yet",
    retiredBy:
      "Sprint 0056 — the landing page removed this sentence about itself before PRODUCT.md did.",
  },
  {
    path: "CLAUDE.md",
    claim: "No background job technology has been chosen",
    retiredBy: "Sprint 0056, rule 24 — ADR 0013: operations run as Vercel Workflows.",
  },
  {
    path: "src/modules/execution/README.md",
    claim: "never writes to a repository",
    retiredBy:
      "Sprint 0056 — this module is the thing that writes. What it never does is *execute* " +
      "repository code, which is a different guarantee and the one ADR 0006 actually makes.",
  },
  {
    path: "src/modules/execution-contract/README.md",
    claim: "does not exist",
    retiredBy: "Sprint 0056 — src/modules/coding-agent/ is roughly fifty files.",
  },
  {
    path: "docs/ROADMAP.md",
    claim: "**Repository state:**",
    retiredBy:
      "Sprint 0080 — a commit pin is an audit's header, and an audit is never edited after the " +
      "reading it records. A register is rewritten every time an entry closes, so the pin was false " +
      "by the next merge and stayed false through roughly ten sprints. Banning the label rather than " +
      "the stale hash is deliberate: a refreshed pin is the same defect with a newer number.",
  },
];

describe("a retired claim does not come back", () => {
  it("names a file that exists for every entry", () => {
    const missing = RETIRED_CLAIMS.filter((entry) => !existsSync(join(ROOT, entry.path)));
    expect(
      missing.map((entry) => entry.path),
      "An entry pointing at a deleted file silently stops guarding anything",
    ).toEqual([]);
  });

  it.each(RETIRED_CLAIMS)("$path no longer says: $claim", ({ path, claim, retiredBy }) => {
    // Normalize the quotes a formatter may have changed underneath the claim.
    const haystack = read(join(ROOT, path)).replace(/[‘’“”]/g, "'");
    const needle = claim.replace(/[‘’“”]/g, "'");
    expect(
      haystack.includes(needle),
      `${path} contains a claim that was retired: "${claim}".\n\nWhy it was retired: ${retiredBy}\n\n` +
        `If it is true again, delete the entry from RETIRED_CLAIMS in this file — that deletion ` +
        `is the record. If it is not, the sentence is a defect (CLAUDE.md rule 83).`,
    ).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * E — no decision is invisible from the map
 * ------------------------------------------------------------------------ */

/**
 * Alone, this assertion would be unaffordable: twenty-seven ADRs were absent
 * from `ARCHITECTURE.md` when it was written, and forcing each into prose is a
 * cost nobody would pay. Paired with §8's mechanical Decision Index it costs two
 * lines per future ADR — and it converts a silent permanent decay (the fortieth
 * ADR would have been invisible too) into an obligation something checks.
 *
 * It checks that an ADR is *mentioned*, never that the sentence mentioning it is
 * true.
 */
describe("every decision is visible from ARCHITECTURE.md", () => {
  const architecture = read(join(ROOT, "ARCHITECTURE.md"));
  const numbers = readdirSync(DECISIONS)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .map((f) => f.slice(0, 4))
    .sort();

  it("finds the ADR numbers it is supposed to be checking", () => {
    expect(numbers.length).toBeGreaterThan(30);
  });

  it("mentions every ADR number", () => {
    const absent = numbers.filter((n) => !architecture.includes(n));
    expect(
      absent,
      `These decisions exist and ARCHITECTURE.md does not reference them, so they are ` +
        `invisible from the map: ${absent.join(", ")}. Add a row to §8 Decision Index.`,
    ).toEqual([]);
  });
});
