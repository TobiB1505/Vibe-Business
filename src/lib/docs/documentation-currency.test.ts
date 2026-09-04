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
 * `tsc` did not. Five thousand tests did not. The build did not. Now seven
 * things do — Sprint 0124 added the two that catch drift *inside* a document
 * rather than between documents: a module README naming a file that no longer
 * exists, and a decision that was superseded without its own page saying so.
 *
 * ## What this asserts, and what it cannot
 *
 * It asserts **structure**: that every record is reachable from its index, that
 * every index row points at something, that every relative link resolves, that
 * every decision is visible from the map, that a module README names files that
 * exist, that a superseded decision points at the one that superseded it, and
 * that a specific list of retired claims has not come back to the file it was
 * retired from.
 *
 * It cannot assert that any prose is **true**. A Decision Index row can name
 * the wrong layer and stay green. `RETIRED_CLAIMS` holds the drift Sprint 0056
 * found and is silent about drift it missed. Saying that here is what keeps a
 * green suite from being read as a guarantee of accuracy — the same discipline
 * rule 66 applies to `sandbox_validation_passed`.
 *
 * ## What is deliberately not asserted
 *
 * - **Module README presence.** Thirteen modules have none, and the count is
 *   not the argument. A README written to satisfy a test is the "list of
 *   intentions pretending to be documentation" that `docs/business/README.md`
 *   bans, and asserting presence would *bless* the dead stub directories rather
 *   than retire them. Sprint 0124 revisited this and kept the position: the new
 *   check below makes the READMEs that exist accurate, and manufactures none.
 *   Recorded as a gap in `docs/ROADMAP.md` instead.
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
/**
 * Every module README, as a repo-relative path.
 *
 * Section C used to read the repository root and `docs/` only, so a broken
 * link inside a module README resolved to nothing and failed nothing — while
 * section F, checking the same files, caught a wrong *filename* in the very
 * same sentence. The asymmetry was not a decision; the module READMEs simply
 * were not in the list.
 */
function moduleReadmes(): string[] {
  const modules = join(ROOT, "src/modules");
  return readdirSync(modules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(modules, entry.name, "README.md"))
    .filter((path) => existsSync(path))
    .map((path) => relative(ROOT, path));
}

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
    ...moduleReadmes(),
  ];

  it("finds the documents it is supposed to be checking", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("includes the module READMEs", () => {
    expect(files.filter((f) => f.startsWith("src/modules/")).length).toBeGreaterThan(20);
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
    path: "PRODUCT.md",
    claim: "Deep Scan is not wired to them",
    retiredBy:
      "ADR 0061 — `launch-v1` prices an additional Deep Scan at 25 Credits and it is " +
      "purchasable. The refusal it describes is still reachable and now means what it says: " +
      "no policy prices an additional scan. History may quote the old sentence; §12.1 may not.",
  },
  {
    path: "src/modules/economy/README.md",
    claim: "Nothing outside this module imports it",
    retiredBy:
      "ADR 0061 — three primitives are now readable from outside (execution-class, " +
      "infrastructure-rates, sandbox-cost), none of which decides an amount. " +
      "`sprint-0054-safety.test.ts` enforces that exact list; the estimator stays unreachable.",
  },
  {
    path: "src/modules/coding-agent/README.md",
    claim: "No customer can start an agent",
    retiredBy:
      "ADR 0061 — `EXECUTION_BUDGET_POLICIES` carries `launch-v1-budget`, with a budget per " +
      "execution pricing class. Rule 78's bar was a measured cost; sixteen delivered dogfood " +
      "runs met it. What the sentence was protecting — that no price ships without one — holds.",
  },
  {
    path: "ARCHITECTURE.md",
    claim: "restores the exact filesystem artifact captured from a passing validation",
    retiredBy:
      "Sprint 0114, ADR 0064 — a preview clones the prepared commit and runs a development " +
      "server beside validation. No artifact is captured, restored or retained; ADR 0016 still " +
      "describes what it decided at the time and may quote this.",
  },
  {
    path: "src/modules/approvals/README.md",
    claim: "The evidence takes one of two forms",
    retiredBy:
      "Sprint 0114, ADR 0065 — three: a diff, a diff plus the preview session of the same " +
      "commit, and a review artifact on historical rows only. The diff is in every new form.",
  },
  {
    path: "README.md",
    claim: "captures a before/after comparison",
    retiredBy:
      "Sprint 0114, ADR 0065 — no browser session photographs a preview any more. The before " +
      "half is a link to the customer's live site as it is now, and the after half is the " +
      "running preview itself.",
  },
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
    path: "PRODUCT.md",
    claim: "which remain the scored technical record",
    retiredBy:
      "ADR 0050 — the five dimensions left the audit contract. The nine lenses carry the " +
      "scores, and the overall figure is the mean over scored lenses.",
  },
  {
    path: "ARCHITECTURE.md",
    claim: "(Product, Monetization, Distribution, Conversion, Retention)",
    retiredBy:
      "ADR 0050 — the audit is structured around the nine business lenses. The five names " +
      "survive only in records and in stored v6/v7 audits, which stay readable under their " +
      "own contract.",
  },
  {
    path: "UX-CONTRACT.md",
    claim: "ordered events every 2.5 seconds",
    retiredBy:
      "VB-044 — the Product Scan poll is 1.8 seconds and has been for some time. The contract " +
      "now names the constant it is describing, so the next change to the interval has one " +
      "obvious place to look rather than two numbers to notice disagreeing.",
  },
  {
    path: "CLAUDE.md",
    claim: "only `src/modules/operations/` may use it",
    retiredBy:
      "VB-044 — rule 53's wording lagged the boundary the tests enforce. The service-role " +
      "client is also held by five reviewed sites that have no session to scope a client " +
      "with, each recorded in REVIEWED_SITES with its reason. A rule that forbids what the " +
      "repository does teaches a reader to disbelieve the rules.",
  },
  {
    path: "src/modules/business-audit/README.md",
    claim: "once per\ndimension key",
    retiredBy:
      "ADR 0050 — the wire schema carries lenses, not dimensions. The grammar lesson " +
      "(declare each item shape once) survives; the dimension block does not.",
  },
  {
    path: "src/modules/action-plans/README.md",
    claim: "the five scored dimensions",
    retiredBy:
      "ADR 0050 §5 — the planner's evidence selection excludes the audit's *other lens " +
      "assessments*; there is no dimension layer left to exclude.",
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
  {
    path: "ARCHITECTURE.md",
    claim: "prices Business Audit at 55",
    retiredBy:
      "ADR 0062 \u2014 the whole card was derived against a Sonnet 5 rise to $3/$15 that Anthropic " +
      "withdrew before it took effect. 35 / 20 / 20, re-derived by the same rule at the rates that " +
      "actually apply. ADR 0061 keeps the sentence in a dated correction; \u00a73.11 may not.",
  },
  {
    path: "ARCHITECTURE.md",
    claim: "the same instant Anthropic's September Sonnet rates do",
    retiredBy:
      "ADR 0062 \u2014 there are no September Sonnet rates. `LAUNCH_V1_EFFECTIVE_FROM` still says " +
      "2026-09-01 because moving it would backdate or delay for no reason, but it is the launch " +
      "date now, not a mirror of a provider event.",
  },
  {
    path: "src/modules/credits/README.md",
    claim: "| Business Audit | 55 | measured |",
    retiredBy: "ADR 0062 \u2014 as ARCHITECTURE.md. The price table is 35 / 20 / 20.",
  },
  {
    path: "docs/business/CREDIT_RATE_CARD_LAUNCH_V1.md",
    claim: "Cost/delivered (Sept rates)",
    retiredBy:
      "ADR 0062 \u2014 every dollar figure in the derivation was a measured cost restated at rates " +
      "that never arrived, presented in a table beside genuinely measured ones. There is one set " +
      "of Sonnet rates and the column no longer needs qualifying.",
  },
  {
    path: "src/modules/ai/pricing.ts",
    claim: "claude-sonnet-5-standard-2026-09",
    retiredBy:
      "ADR 0062 \u2014 the cancelled row is deleted rather than held, so nothing in the price book " +
      "may name it again. `pricing.test.ts` enforces this against the array itself; this entry " +
      "enforces it against the prose. `economy/intelligence/model-version.ts` still carries the " +
      "string in an append-only record of what v1 was issued under, which is history, not a price.",
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

/* ---------------------------------------------------------------------------
 * F — a module README names files that exist
 * ------------------------------------------------------------------------ */

/**
 * Sprint 0124.
 *
 * ## The drift this catches, which nothing else could
 *
 * Section C already resolves every markdown *link*. A module README's most
 * load-bearing content is not links, though — it is the table that says which
 * file answers which question, and those are backticked filenames. Two of them
 * had been pointing at files that no longer exist: `execution-contract`'s
 * `freshness.ts`, renamed to `live-premise.ts` sprints ago, and `projects`'s
 * `disconnect.ts`, retired by ADR 0056. Both survived every check in this file
 * and every grep anybody ran, because a name in backticks is prose.
 *
 * ## Why the fallback is repo-wide rather than module-local
 *
 * READMEs legitimately name their neighbours — `action-plans` explains itself
 * partly in terms of `business-audit/conclusions.ts`, and `coding-agent` cites
 * `credits/retail.ts` from the economy module. Requiring every name to live
 * inside its own module would make eleven true sentences fail.
 *
 * So the rule is the weakest one that still catches the defect: **a file named
 * in a module README exists somewhere under `src/`.** It cannot notice a name
 * that resolves to the wrong module's file of the same name — `store.ts` exists
 * seven times over — and saying that here is what stops a green run from being
 * read as "every reference is correct".
 *
 * ## What is deliberately not asserted, still
 *
 * **Module README presence**, for the reason the header gives: a README written
 * to satisfy a test is the "list of intentions pretending to be documentation"
 * that `docs/business/README.md` bans. This check makes the READMEs that exist
 * accurate; it does not manufacture more of them.
 */
describe("every file a module README names exists", () => {
  /** Every file under `src/`, at any depth, as a repo-relative path. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? sourceFiles(full) : [relative(ROOT, full)];
    });
  }

  const files = new Set(sourceFiles(join(ROOT, "src")).map((p) => p.split("\\").join("/")));

  /**
   * A backticked `.ts`/`.tsx` name, or a path ending in one.
   *
   * `NNNN` is excluded because `economy/README.md` names the *pattern*
   * `sprint-NNNN-safety.test.ts` — a rule about what each sprint adds, not a
   * claim that one file is called that.
   */
  function namedFiles(source: string): string[] {
    return [...source.matchAll(/`([A-Za-z0-9_][A-Za-z0-9_./-]*\.tsx?)`/g)]
      .map((match) => match[1])
      .filter((name) => !name.includes("NNNN"));
  }

  const readmes = readdirSync(join(ROOT, "src/modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("src/modules", entry.name, "README.md"))
    .filter((path) => existsSync(join(ROOT, path)));

  it("finds the module READMEs it is supposed to be checking", () => {
    expect(readmes.length).toBeGreaterThan(15);
  });

  it("resolves every named file", () => {
    const unresolved = readmes.flatMap((readme) => {
      const moduleDir = dirname(readme);
      return namedFiles(read(join(ROOT, readme)))
        .filter(
          (name) =>
            !files.has(`${moduleDir}/${name}`) &&
            ![...files].some((path) => path === name || path.endsWith(`/${name}`)),
        )
        .map((name) => `${readme} names ${name}`);
    });

    expect(
      unresolved,
      `A module README names a file that does not exist. Either the file was ` +
        `renamed and the README was not, or it was deleted:\n${unresolved.join("\n")}`,
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * G — a superseded decision says so on its own page
 * ------------------------------------------------------------------------ */

/**
 * Sprint 0124.
 *
 * ## The asymmetry this closes
 *
 * When ADR B supersedes or amends ADR A, B always says so — that is the first
 * line anybody writes. A said nothing, in ten cases out of thirteen. So a
 * reader who opens ADR 0016 sees `Status: Accepted` and four sections that
 * stopped being true when 0064 shipped, and the only place recording that is a
 * page they have no reason to open.
 *
 * Rule 83 is explicit that a record is not rewritten to match the present. This
 * does not rewrite one: the original text stands untouched, and the status line
 * gains a dated pointer — the form ADR 0027 already used for 0029.
 *
 * ## Why the detector reads the claiming ADR's header
 *
 * Because the claim is the fact. Three ADRs open with "Supersedes: nothing.
 * Extends [X]" or "Supersedes / amends: none. Complements [X]", and reading the
 * link without reading the sentence turns each of those into a demand for a
 * back-reference to a supersession that was explicitly disclaimed. The two
 * exclusions below — `by`, and `nothing`/`none` — are what separates "B
 * supersedes A" from "B is amended by A" and from "B supersedes nothing".
 */
describe("a superseded decision says so on its own page", () => {
  const STATUS_LINE = /^\s*[-*]?\s*\*{0,2}status\*{0,2}\s*:/i;

  const adrs = readdirSync(DECISIONS)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort();

  /** The lines before the first `## `, which is where every ADR states this. */
  function header(file: string): string {
    const lines = read(join(DECISIONS, file)).split("\n");
    const end = lines.findIndex((line) => line.startsWith("## "));
    return lines.slice(0, end === -1 ? lines.length : end).join("\n");
  }

  const headers = new Map(adrs.map((file) => [file.slice(0, 4), header(file)]));

  /** Numbers this ADR claims to supersede, amend or replace. */
  function claims(number: string, head: string): string[] {
    const found = new Set<string>();

    for (const match of head.matchAll(/\b(supersedes|amends|replaces)\b([^\n]*)/gi)) {
      const rest = match[2];
      for (const link of rest.matchAll(/\[(?:ADR\s*)?(\d{4})\]/g)) {
        const before = rest.slice(0, link.index ?? 0);
        // "amended **by** [X]" is X claiming this one, not the reverse; and
        // "supersedes **nothing**. Extends [X]" claims nothing at all.
        if (/\bby\b/i.test(before) || /\b(nothing|none)\b/i.test(before)) continue;
        if (link[1] !== number) found.add(link[1]);
      }
    }

    return [...found].sort();
  }

  it("finds the supersession claims it is supposed to be checking", () => {
    const total = [...headers].flatMap(([number, head]) => claims(number, head));
    expect(total.length).toBeGreaterThan(5);
  });

  it("names the newer decision on the older decision's status line", () => {
    const silent: string[] = [];

    for (const [number, head] of headers) {
      for (const target of claims(number, head)) {
        const targetHead = headers.get(target);
        if (targetHead === undefined) continue;

        const status = targetHead.split("\n").find((line) => STATUS_LINE.test(line)) ?? "";
        if (!status.includes(number)) {
          silent.push(`ADR ${target} does not mention ADR ${number}, which supersedes or amends it`);
        }
      }
    }

    expect(
      silent,
      `A reader who opens the older decision cannot tell that part of it no longer ` +
        `holds. Add a pointer to its Status line — the original text stays ` +
        `(rule 83):\n${silent.join("\n")}`,
    ).toEqual([]);
  });

  it("gives every decision a status line at all", () => {
    const without = adrs.filter((file) => !header(file).split("\n").some((l) => STATUS_LINE.test(l)));
    expect(without, `These ADRs state no status: ${without.join(", ")}`).toEqual([]);
  });
});
