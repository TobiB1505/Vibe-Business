import { RatingChip } from "@/components/ui/status-pill";
import type { Study } from "./studies";

/**
 * Four treatments for the eyebrow label, side by side (S1 follow-up).
 *
 * ## Why this exists
 *
 * `MonoLabel` renders ordinary labels in JetBrains Mono, uppercase, at 0.16em
 * tracking — 289 times across 51 files. `DESIGN.md` says the opposite:
 * "Repository names, branches and SHAs may use mono, but ordinary scores and
 * labels stay in the interface family", and "technical identifiers use the
 * mono family sparingly". A product-identity line reading CONFIRMED BY YOU in
 * a monospace face is not a technical identifier; it is a sentence about what
 * a person did.
 *
 * `typography.tsx`'s own docblock is stale in the same direction. It still
 * names Space Grotesk as the interface face — a typeface `design-tokens.
 * test.ts` asserts is gone — and assigns "scores, counts, credits" to mono,
 * which `DESIGN.md` places in the interface family.
 *
 * So this is a contradiction inside the repository rather than a preference,
 * and it gets settled the way the direction was: by looking.
 *
 * ## Why nothing here changes a component
 *
 * These are rendered treatments, not an implementation. Whichever wins becomes
 * one token (`--font-label` and its tracking), set per palette, so v1 keeps
 * the mono eyebrow it shipped with and v2 gets the chosen one — 51 files
 * unedited either way.
 */

type Treatment = {
  key: string;
  name: string;
  argument: string;
  className: string;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "current",
    name: "1 · Mono, as today",
    argument:
      "JetBrains Mono, uppercase, 0.16em. What ships now, and what DESIGN.md says ordinary labels should not be.",
    className: "text-fg-meta font-mono text-[0.65625rem] tracking-[0.16em] uppercase",
  },
  {
    key: "sans-caps",
    name: "2 · Geist, uppercase, tighter",
    argument:
      "The same shape in the interface family. Keeps the eyebrow reading as a rule above a block; loses the machine-print association.",
    className: "text-fg-meta text-[0.6875rem] font-semibold tracking-[0.1em] uppercase",
  },
  {
    key: "sans-quiet",
    name: "3 · Geist, sentence case",
    argument:
      "No uppercase, no tracking. Reads as a quiet caption rather than a label, which is what most of these 289 uses actually are.",
    className: "text-fg-meta text-caption",
  },
  {
    key: "sans-medium",
    name: "4 · Geist, uppercase, near-normal tracking",
    argument:
      "Between 2 and 3: still a label, but set like type rather than like a terminal. Larger, so the bottom of the ramp stays legible.",
    className: "text-fg-secondary text-[0.75rem] font-medium tracking-[0.04em] uppercase",
  },
];

function Row({ treatment }: { treatment: Treatment }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-2 py-7">
      <div>
        <h2 className="text-ui font-semibold text-fg">{treatment.name}</h2>
        <p className="mt-1 max-w-[62ch] text-caption text-fg-muted">{treatment.argument}</p>
      </div>

      {/* The line the objection was raised about, in context. */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-nav border border-line-3 bg-surface-2 text-ui font-semibold text-fg"
        >
          P
        </span>
        <span className="text-title font-semibold text-fg">Payflow</span>
        <RatingChip>Developer tool</RatingChip>
        <span className={treatment.className}>Confirmed by you</span>
      </div>

      {/* And as a section rule, which is the other thing MonoLabel does. */}
      <div className="rounded-panel border border-line-2 bg-surface-1 p-5">
        <p className={treatment.className}>Business health</p>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-display font-semibold tabular-nums text-fg">62</span>
          <span className="text-caption text-fg-meta">Taking shape</span>
        </p>
      </div>

      {/* The case mono is genuinely for, unchanged in every treatment — the
          comparison is meaningless if it hides what the mono is protecting. */}
      <p className="text-caption text-fg-meta">
        Still mono either way: <code className="font-mono text-fg-secondary">2f05958</code> on{" "}
        <code className="font-mono text-fg-secondary">vibe/seo-foundations</code>
      </p>
    </section>
  );
}

export function StudyLabels({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-4">
        <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">
          Label treatments
        </p>
        <h1 className="mt-3 text-headline font-semibold text-fg">
          What an eyebrow should be set in
        </h1>
        <p className="mt-3 max-w-[64ch] text-lead text-fg-prose">
          Rendered in {study.name}. Whichever wins becomes a token, not 289 edits — v1 keeps the
          mono eyebrow it shipped with.
        </p>
      </header>

      {TREATMENTS.map((treatment) => (
        <Row key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}
