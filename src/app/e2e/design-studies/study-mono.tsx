import localFont from "next/font/local";
import type { Study } from "./studies";

/**
 * Four replacements for JetBrains Mono, on the strings mono actually exists
 * for (S1 follow-up).
 *
 * ## What is being decided, and what is not
 *
 * `DESIGN.md` reserves mono for **repository names, branches and SHAs** —
 * machine identifiers a person compares character by character, and the only
 * uses left once the eyebrow moves to the interface family. So the question
 * here is narrow: which face makes `2f05958` and `vibe/seo-foundations`
 * easiest to read and hardest to misread, beside Geist.
 *
 * That makes the sample the whole test. A pangram would flatter every
 * candidate equally and answer nothing. What matters is the pairs a hex SHA
 * puts in collision — `0`/`O`, `1`/`l`/`I`, `5`/`S`, `8`/`B`, `2`/`Z`, `rn`/`m`
 * — and whether a long lowercase branch name stays even at 11px.
 *
 * ## Candidates
 *
 * Geist Mono is excluded by instruction. Every candidate below is a free,
 * self-hostable licence and shipped by Fontsource, so it can follow the same
 * one-call-per-writing-system pattern the mono already uses.
 *
 * Loaded latin-only at one weight: three of these five get deleted, and
 * subsetting a face nobody chose is work spent on a file that will not exist.
 */

const plex = localFont({
  src: "../../fonts/cand-plex-mono-latin.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-cand-plex",
});
const dm = localFont({
  src: "../../fonts/cand-dm-mono-latin.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-cand-dm",
});
const martian = localFont({
  src: "../../fonts/cand-martian-mono-latin.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-cand-martian",
});
const sourceCodePro = localFont({
  src: "../../fonts/cand-source-code-pro-latin.woff2",
  weight: "200 900",
  display: "swap",
  variable: "--font-cand-scp",
});

export const MONO_CANDIDATE_CLASSES = [
  plex.variable,
  dm.variable,
  martian.variable,
  sourceCodePro.variable,
].join(" ");

type Candidate = {
  key: string;
  name: string;
  argument: string;
  /** The stack, so the sample renders in the face and nothing else. */
  family: string;
  licence: string;
};

const CANDIDATES: readonly Candidate[] = [
  {
    key: "current",
    name: "0 · JetBrains Mono",
    argument:
      "What ships today, kept in the comparison as the reference. Wide, even, engineered for code at small sizes — and after the eyebrow moves, it stops being the most-seen face in the product and becomes a face used sparingly.",
    family: "var(--font-jetbrains-mono), ui-monospace, monospace",
    licence: "OFL",
  },
  {
    key: "plex",
    name: "1 · IBM Plex Mono",
    argument:
      "Humanist. Real character in the letterforms — a true single-storey a, a slab-ish g — which makes an identifier feel authored rather than emitted. The warmest of the four beside Geist's neutrality.",
    family: "var(--font-cand-plex), ui-monospace, monospace",
    licence: "OFL",
  },
  {
    key: "dm",
    name: "2 · DM Mono",
    argument:
      "Geometric and low-contrast, built on the same construction logic as Geist. The closest pairing here: an identifier reads as the same voice as the interface, one notch more technical.",
    family: "var(--font-cand-dm), ui-monospace, monospace",
    licence: "OFL",
  },
  {
    key: "martian",
    name: "3 · Martian Mono",
    argument:
      "Wide, mechanical, unmistakably machine output. The most distinctive of the four and the one that most clearly separates identifier from prose — at the cost of horizontal space, which a 40-character SHA has none of.",
    family: "var(--font-cand-martian), ui-monospace, monospace",
    licence: "OFL",
  },
  {
    key: "scp",
    name: "4 · Source Code Pro",
    argument:
      "The neutral workhorse. Least opinionated, most legible at 11px, and the only candidate that ships Greek — the one script Geist gives up, so the mono would cover it.",
    family: "var(--font-cand-scp), ui-monospace, monospace",
    licence: "OFL",
  },
];

/** The characters a hex SHA and a branch name actually put in collision. */
const COLLISIONS = "0O 1lI 5S 8B 2Z rn/m";

function Row({ candidate }: { candidate: Candidate }) {
  const mono = { fontFamily: candidate.family };
  return (
    <section className="flex flex-col gap-3 border-t border-line-2 py-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-ui font-semibold text-fg">{candidate.name}</h2>
        <span className="text-caption text-fg-disabled">{candidate.licence}</span>
      </div>
      <p className="max-w-[64ch] text-caption text-fg-muted">{candidate.argument}</p>

      <dl className="mt-1 grid gap-x-6 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="eyebrow text-fg-meta">Short SHA</dt>
        <dd className="text-ui text-fg-body" style={mono}>
          2f05958
        </dd>

        <dt className="eyebrow text-fg-meta">Full SHA</dt>
        <dd className="text-caption break-all text-fg-secondary" style={mono}>
          2f05958e3410deaeb97029861abc05889139b4a7
        </dd>

        <dt className="eyebrow text-fg-meta">Branch</dt>
        <dd className="text-ui text-fg-body" style={mono}>
          vibe/seo-foundations
        </dd>

        <dt className="eyebrow text-fg-meta">Repository</dt>
        <dd className="text-ui text-fg-body" style={mono}>
          TobiB1505/Vibe-Business
        </dd>

        <dt className="eyebrow text-fg-meta">Path</dt>
        <dd className="text-ui text-fg-secondary" style={mono}>
          src/modules/nova/home-view.ts
        </dd>

        {/* The pairs that decide it. A face that fails here fails on the one
            job mono is kept for: being compared character by character. */}
        <dt className="eyebrow text-fg-meta">Collisions</dt>
        <dd className="text-title tracking-wide text-fg" style={mono}>
          {COLLISIONS}
        </dd>
      </dl>

      {/* In place, at the size it is actually read at. */}
      <p className="mt-2 rounded-panel border border-line-2 bg-surface-1 px-4 py-3 text-caption text-fg-prose">
        Merged{" "}
        <span className="text-fg-body" style={mono}>
          2f05958
        </span>{" "}
        into{" "}
        <span className="text-fg-body" style={mono}>
          main
        </span>{" "}
        from{" "}
        <span className="text-fg-body" style={mono}>
          vibe/seo-foundations
        </span>
        .
      </p>
    </section>
  );
}

export function StudyMono({ study }: { study: Study }) {
  return (
    <div
      className={`mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4 ${MONO_CANDIDATE_CLASSES}`}
    >
      <header className="pb-4">
        <p className="eyebrow text-fg-meta">Identifier face</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">What a SHA should be set in</h1>
        <p className="mt-3 max-w-[64ch] text-lead text-fg-prose">
          Rendered in {study.name}, beside Geist. The eyebrows on this page are already the chosen
          treatment, so what is left in mono is what mono is actually for.
        </p>
      </header>

      {CANDIDATES.map((candidate) => (
        <Row key={candidate.key} candidate={candidate} />
      ))}
    </div>
  );
}
