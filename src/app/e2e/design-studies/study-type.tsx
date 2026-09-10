"use client";

import type { CSSProperties } from "react";
import type { Study } from "./studies";

/**
 * The heading scale: three ways to close it.
 *
 * ## What the measurement found
 *
 * Not that call sites ignore the scale. Counted across the product, 1134 of
 * 1381 type-size decisions already name a Vibe token — the small end is
 * genuinely done. What is left divides into two clean groups, and neither is
 * carelessness:
 *
 * 1. **One job, several sizes.** A panel's own heading — "Connected
 *    repositories", "What you told Vibe", "Why this move", "Delete your
 *    account" — is written at 16px twenty times, 18px five times and 19px
 *    eleven times. Same element, same job, three sizes, chosen by whatever
 *    was already on the screen.
 * 2. **A job with no size at all.** The line that speaks to the founder —
 *    "Vibe needs your input", "Vibe knows your product.", "Your product is
 *    still connected." — is written at 20px twelve times and 24px eight
 *    times. Vibe's scale has no step between `title` (19) and `headline`
 *    (28), so both numbers came from Tailwind's scale, which means nothing
 *    here.
 *
 * The same shape one step down: `--text-card-title` was created for the
 * heading inside a card and is used twice, while `text-body` does that job
 * twenty-eight times.
 *
 * ## Why these three and not a fresh ratio scale
 *
 * Because this repository has already rejected that argument twice, in
 * writing. `--text-body` is 0.875rem "because that is what `text-sm` is", and
 * `--text-card-title` takes 1.375 leading because that is what eleven call
 * sites already render — both docblocks say the same thing: naming a size must
 * be a rename that moves nothing, and picking a prettier number instead
 * re-typesets the product to match something nobody looked at.
 *
 * A modular scale from first principles would move every heading in the
 * product by one to four pixels to satisfy a ratio. So all three variants
 * below are built only from sizes the product already uses. What separates
 * them is how much *folding* they do:
 *
 *   T1  adds the missing rungs, folds nothing   — nothing moves
 *   T2  adds one rung, folds the duplicates     — 65 headings move 1–4px
 *   T3  adds no rung, folds everything          — 77 headings move, one by 8px
 */

/* ── The type scale each variant proposes ──────────────────────────── */

type Rung = {
  /** The token name it would carry. Existing ones are marked. */
  token: string;
  px: number;
  existing?: true;
  /** What this rung is for, in the product's own terms. */
  job: string;
  /** A real string from the product, at this size. */
  sample: string;
  weight?: string;
  tracking?: string;
};

const HERO: Rung = {
  token: "hero",
  px: 48,
  existing: true,
  job: "Marketing, once per page",
  sample: "Your product, understood.",
  weight: "font-semibold",
  tracking: "-0.04em",
};
const DISPLAY: Rung = {
  token: "display",
  px: 36,
  existing: true,
  job: "A moment the whole screen is about",
  sample: "Vibe knows your product.",
  weight: "font-semibold",
  tracking: "-0.038em",
};
const HEADLINE: Rung = {
  token: "headline",
  px: 28,
  existing: true,
  job: "The page's own name",
  sample: "Sign in",
  weight: "font-semibold",
  tracking: "-0.035em",
};

/**
 * T1 — name what ships, fold nothing.
 *
 * Every heading size the product uses gets a token, so 93 of the 98 Tailwind
 * classes become Vibe classes and not one pixel moves. It is the cheapest and
 * the most literal reading of this repository's own rule. (The five left over
 * are `text-3xl` twice and `text-xs` once, which are 30px and 12px — a size
 * nothing else uses, and `caption` under another name.)
 *
 * The cost is on the page: thirteen rungs, with 15 and 16 one pixel apart and
 * 19 and 20 one pixel apart. A scale whose neighbouring steps are
 * indistinguishable is not a scale, it is an inventory — and the next person
 * choosing between `title` and `moment` has exactly as little to go on as the
 * people who chose between `text-base`, `text-lg` and `text-title`.
 */
const T1: Rung[] = [
  HERO,
  DISPLAY,
  HEADLINE,
  { token: "feature", px: 24, job: "A moment, loud", sample: "Vibe needs your input" },
  { token: "moment", px: 20, job: "A moment, quiet", sample: "Vibe needs your input" },
  { token: "title", px: 19, existing: true, job: "A panel's name", sample: "Delete your account" },
  { token: "section", px: 18, job: "A panel's name, smaller", sample: "Connect your code" },
  { token: "panel", px: 16, job: "A panel's name, smallest", sample: "Connected repositories" },
  {
    token: "card-title",
    px: 15,
    existing: true,
    job: "A heading inside a card",
    sample: "Why this move",
  },
  { token: "body", px: 14, existing: true, job: "Prose", sample: "Why this move" },
];

/**
 * T2 — one rung per job. **Recommended.**
 *
 * The three sizes doing the panel-heading job become one, and the two doing
 * the moment job become one. The scale grows by a single token — the moment,
 * which genuinely has no name today — and shrinks by the two accidents.
 *
 * Every move is upward and small: 16→19 and 18→19 for a panel heading, 20→24
 * for a moment, 14→15 for a card heading. Nothing shrinks, so no line rewraps
 * into a place it did not fit before.
 *
 * The tightest pair left is 24 and 28. They are defensible because they are
 * rarely on one screen — a moment lives inside a panel and a headline names
 * the page — but it is the one place this scale is still asking the reader to
 * tell four pixels apart.
 */
const T2: Rung[] = [
  HERO,
  DISPLAY,
  HEADLINE,
  {
    token: "moment",
    px: 24,
    job: "The line that speaks to the founder",
    sample: "Vibe needs your input",
  },
  {
    token: "title",
    px: 19,
    existing: true,
    job: "A panel's name",
    sample: "Connected repositories",
  },
  {
    token: "card-title",
    px: 15,
    existing: true,
    job: "A heading inside a card",
    sample: "Why this move",
  },
  {
    token: "body",
    px: 14,
    existing: true,
    job: "Prose",
    sample: "The payments integration exists…",
  },
];

/**
 * T3 — add nothing, fold everything.
 *
 * The claim: a moment heading *is* the page's headline. "Vibe needs your
 * input" is what that screen is about, whether the markup calls it an `h1` or
 * an `h2` inside a panel — so it takes `headline` and the scale does not grow
 * at all. Five display rungs, each a clear step, and no new decision for
 * anybody to get wrong.
 *
 * It is the boldest and the only one with a real risk: 20→28 is a 40% jump on
 * twelve elements, several of which sit inside a panel that also carries a
 * `title`. If a moment and a panel name ever share a screen at 28 and 19, the
 * panel stops looking like a panel.
 */
const T3: Rung[] = [
  HERO,
  DISPLAY,
  { ...HEADLINE, job: "The page's name, and its moment", sample: "Vibe needs your input" },
  {
    token: "title",
    px: 19,
    existing: true,
    job: "A panel's name",
    sample: "Connected repositories",
  },
  {
    token: "card-title",
    px: 15,
    existing: true,
    job: "A heading inside a card",
    sample: "Why this move",
  },
  {
    token: "body",
    px: 14,
    existing: true,
    job: "Prose",
    sample: "The payments integration exists…",
  },
];

/* ── Rendering ─────────────────────────────────────────────────────── */

function px(size: number, tracking?: string): CSSProperties {
  return {
    fontSize: `${size}px`,
    lineHeight: size >= 28 ? 1.12 : size >= 19 ? 1.28 : 1.4,
    letterSpacing: tracking ?? (size >= 19 ? "-0.02em" : undefined),
  };
}

function Ladder({ rungs }: { rungs: Rung[] }) {
  return (
    <div className="flex flex-col">
      {rungs.map((rung) => (
        <div
          key={rung.token + rung.px}
          className="border-line-1 flex items-baseline gap-6 border-b py-3 last:border-b-0"
        >
          <span className="text-fg-meta w-40 shrink-0 font-mono text-meta">
            text-{rung.token}
            <span className="text-fg-disabled"> · {rung.px}px</span>
            {!rung.existing && <span className="text-mint"> new</span>}
          </span>
          <span
            className={`text-fg min-w-0 flex-1 truncate ${rung.weight ?? "font-semibold"}`}
            style={px(rung.px, rung.tracking)}
          >
            {rung.sample}
          </span>
          <span className="text-fg-meta hidden w-56 shrink-0 text-caption lg:block">
            {rung.job}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The same screen, three times.
 *
 * A ladder shows the sizes; it does not show whether they *work*, because a
 * scale is only ever read as intervals between things that sit near each
 * other. This composes one real screen — a page heading, a panel with its own
 * name, a moment inside it, a card heading and prose — so the question becomes
 * the right one: does the hierarchy read.
 */
function Screen({ rungs }: { rungs: Rung[] }) {
  const at = (token: string) =>
    rungs.find((rung) => rung.token === token) ?? rungs[rungs.length - 1];
  const moment = rungs.find((r) => r.token === "moment") ?? at("headline");
  const panel = rungs.find((r) => r.token === "panel") ?? at("title");
  const card = at("card-title");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-fg font-semibold" style={px(at("headline").px, at("headline").tracking)}>
        Landing Pro
      </h1>

      <div className="border-line-3 bg-surface-2 rounded-panel flex flex-col gap-4 border p-5">
        <h2 className="text-fg font-semibold" style={px(panel.px)}>
          Connected repositories
        </h2>
        <div className="border-mint/40 bg-mint-tint-soft rounded-well flex flex-col gap-2 border p-4">
          <h3 className="text-fg font-semibold" style={px(moment.px, moment.tracking)}>
            Vibe needs your input
          </h3>
          <p className="text-fg-muted text-body">
            Vibe found a payments integration in the repository and no pricing page on the live
            site. Someone who wants to buy has nowhere to do it.
          </p>
        </div>
        <div className="border-line-2 bg-surface-1 rounded-well flex flex-col gap-1 border p-4">
          <h4 className="text-fg font-semibold" style={px(card.px)}>
            Why this move
          </h4>
          <p className="text-fg-muted text-body">
            The integration is built and earns nothing until a customer can reach it.
          </p>
        </div>
      </div>
    </div>
  );
}

function Variant({
  label,
  thesis,
  cost,
  rungs,
}: {
  label: string;
  thesis: string;
  cost: string;
  rungs: Rung[];
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg text-title font-semibold">{label}</h2>
        <p className="text-fg-muted max-w-3xl text-body">{thesis}</p>
        <p className="text-fg-meta max-w-3xl text-caption">{cost}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
        <div className="border-line-2 bg-surface-1 rounded-well border px-5 py-2">
          <Ladder rungs={rungs} />
        </div>
        <div className="border-line-2 bg-surface-1 rounded-well border p-5">
          <Screen rungs={rungs} />
        </div>
      </div>
    </section>
  );
}

/* ── The evidence ──────────────────────────────────────────────────── */

/** One job, and every size the product currently writes it at. */
const JOBS: { job: string; sample: string; sizes: { px: number; uses: number; via: string }[] }[] =
  [
    {
      job: "A panel's own name",
      sample: "Connected repositories",
      sizes: [
        { px: 16, uses: 20, via: "text-base" },
        { px: 18, uses: 5, via: "text-lg" },
        { px: 19, uses: 11, via: "text-title" },
      ],
    },
    {
      job: "The line that speaks to the founder",
      sample: "Vibe needs your input",
      sizes: [
        { px: 20, uses: 12, via: "text-xl" },
        { px: 24, uses: 8, via: "text-2xl" },
      ],
    },
    {
      job: "A heading inside a card",
      sample: "Why this move",
      sizes: [
        { px: 14, uses: 28, via: "text-body" },
        { px: 15, uses: 2, via: "text-card-title" },
      ],
    },
  ];

function Evidence() {
  return (
    <div className="flex flex-col gap-6">
      {JOBS.map((entry) => (
        <div key={entry.job} className="flex flex-col gap-3">
          <p className="text-fg-secondary text-ui font-medium">{entry.job}</p>
          <div className="border-line-2 bg-surface-1 rounded-well flex flex-wrap items-end gap-x-10 gap-y-4 border p-5">
            {entry.sizes.map((size) => (
              <div key={size.px} className="flex flex-col gap-1">
                <span className="text-fg font-semibold" style={px(size.px)}>
                  {entry.sample}
                </span>
                <span className="text-fg-meta font-mono text-meta">
                  {size.px}px · {size.via} · {size.uses}×
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── The study ─────────────────────────────────────────────────────── */

export function StudyType({ study }: { study: Study }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-14">
      <header className="flex flex-col gap-2">
        <p className="text-fg-meta text-caption tracking-wide uppercase">Type — {study.name}</p>
        <h1 className="text-display text-fg font-semibold">Closing the heading scale</h1>
        <p className="text-fg-muted max-w-3xl text-body">
          1134 of 1381 type sizes already name a Vibe token. The 247 that do not are not call sites
          drifting — they are one job written at three sizes, and one job the scale has no size for
          at all.
        </p>
      </header>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-fg text-title font-semibold">What is actually there</h2>
          <p className="text-fg-muted max-w-3xl text-body">
            The same string, at every size the product currently writes it at. Nobody chose these
            intervals; each was typed next to whatever was already on the screen.
          </p>
        </div>
        <Evidence />
      </section>

      <Variant
        label="T1 — name what ships, fold nothing"
        thesis="Give every size in use a token. The 98 Tailwind classes become Vibe classes and not one pixel moves."
        cost="Ten rungs, with 15/16 and 19/20 a pixel apart. The scale is fixed; the practice is not — the next person still has nothing to choose between title, section and panel."
        rungs={T1}
      />

      <Variant
        label="T2 — one rung per job · recommended"
        thesis="Three panel-heading sizes become one; two moment sizes become one. The scale gains the one token it genuinely lacks and loses the two accidents."
        cost="65 headings move, all upward, by 1–4px. Nothing shrinks, so nothing rewraps. The tightest pair left is moment 24 against headline 28."
        rungs={T2}
      />

      <Variant
        label="T3 — add nothing, fold everything"
        thesis="A moment heading is the page's headline, whatever the markup calls it. No new token at all: five display rungs, each a clear step."
        cost="73 headings move. 20→28 is a 40% jump on twelve elements, several inside a panel that also carries a title — and a moment nested two levels deep then reads at the page name's size."
        rungs={T3}
      />
    </main>
  );
}
