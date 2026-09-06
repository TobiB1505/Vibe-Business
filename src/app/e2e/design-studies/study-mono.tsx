import type { Study } from "./studies";

/**
 * The identifier face, before and after (S1 follow-up).
 *
 * ## What was decided
 *
 * `DESIGN.md` keeps mono for **repository names, branches and SHAs** —
 * machine identifiers a person compares character by character. Once the
 * eyebrow moved to the interface family, that is all mono still does, so the
 * question was which face makes those strings hardest to misread beside Geist.
 *
 * Four candidates were rendered on exactly these samples and compared at
 * review: IBM Plex Mono, DM Mono, Martian Mono and Source Code Pro. Geist Mono
 * was excluded by instruction. **DM Mono** was chosen — geometric and
 * low-contrast, built on the same construction logic as Geist, so an
 * identifier reads as the same voice as the interface, one notch more
 * technical.
 *
 * The four-way page is not kept. Three of its faces are deleted, and a
 * comparison whose samples render in a system fallback is worse than no
 * comparison. What stays is the before-and-after, which is the thing anybody
 * looking at this later actually needs.
 *
 * ## Why the samples are these samples
 *
 * A pangram flatters every monospace equally. What decides an identifier face
 * is the pairs a hex SHA puts in collision — `0`/`O`, `1`/`l`/`I`, `5`/`S`,
 * `8`/`B`, `2`/`Z`, `rn`/`m` — and whether a long lowercase branch name stays
 * even at the size it is actually read at.
 *
 * DM Mono's weakest pair is `1`/`l`, which was named before the choice was
 * made rather than discovered after it. It is on this page, at size, so the
 * cost of the decision stays visible next to its benefit.
 */

type Face = {
  key: string;
  name: string;
  argument: string;
  family: string;
};

const FACES: readonly Face[] = [
  {
    key: "v1",
    name: "Before · JetBrains Mono",
    argument:
      "What v1 ships. Wide, even, engineered for code at small sizes — and, until the eyebrow moved, the most-seen face in the product rather than a face used sparingly.",
    family: "var(--font-jetbrains-mono), ui-monospace, monospace",
  },
  {
    key: "v2",
    name: "After · DM Mono",
    argument:
      "Chosen at review from four. Geometric, low-contrast, the same construction logic as Geist. Latin and latin-ext only, with the JetBrains subsets behind it in the stack for the scripts it does not ship — so Greek does not land on a system font.",
    family: "var(--font-mono)",
  },
];

const COLLISIONS = "0O 1lI 5S 8B 2Z rn/m";

function Row({ face }: { face: Face }) {
  const mono = { fontFamily: face.family };
  return (
    <section className="flex flex-col gap-3 border-t border-line-2 py-7">
      <h2 className="text-ui font-semibold text-fg">{face.name}</h2>
      <p className="max-w-[64ch] text-caption text-fg-muted">{face.argument}</p>

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

        <dt className="eyebrow text-fg-meta">Collisions</dt>
        <dd className="text-title tracking-wide text-fg" style={mono}>
          {COLLISIONS}
        </dd>

        {/* Three places in the product set mono at semibold. DM Mono has no
            600, so CSS font matching resolves it to the 500 that is loaded
            rather than synthesising a faux bold. This is that row. */}
        <dt className="eyebrow text-fg-meta">At semibold</dt>
        <dd className="text-ui font-semibold text-fg-body" style={mono}>
          2f05958 · vibe/seo-foundations
        </dd>
      </dl>

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
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-4">
        <p className="eyebrow text-fg-meta">Identifier face</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">What a SHA is set in</h1>
        <p className="mt-3 max-w-[64ch] text-lead text-fg-prose">
          Rendered in {study.name}. The eyebrows on this page are the chosen treatment, so what is
          left in mono is what mono is actually for.
        </p>
      </header>

      {FACES.map((face) => (
        <Row key={face.key} face={face} />
      ))}
    </div>
  );
}
