"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Study } from "./studies";

/**
 * The number, when the number is the point.
 *
 * ## What the measurement found
 *
 * Fifty places set `tabular-nums`. Most are fine — a count in a row, a
 * timestamp in a caption, a price in a sentence — and already sit on the type
 * scale. Ten are not: they are a *figure*, a number the screen is about, and
 * across those ten there are **eight sizes, four tracking values and two
 * weights**, none of them coordinated.
 *
 *   18.0  products stat tile          bold      default leading
 *   20.0  repositories stat tile      bold      default leading
 *   20.0  understanding stat tile     semibold  default leading
 *   20.0  business-map node (grid)    semibold  default leading
 *   21.6  business-map node (detail)  semibold  leading-none  -0.04em
 *   30.0  audit score                 semibold  leading-none  -0.04em
 *   36.0  Nova health score           bold      leading-none
 *   50.4  billing balance             bold      leading-none  -0.04em
 *   52.0  signal number               bold      leading-none  -0.06em
 *   62.4  business-map overall        semibold  leading-none  -0.065em
 *
 * Two things in that list are not a matter of taste.
 *
 * **The same object is two sizes.** A business-map node's score is 20px in the
 * grid and 21.6px in the detail view — same number, same component family,
 * different leading and different tracking. Nobody decided that.
 *
 * **The tracking does not scale.** −0.04em appears at 21.6px, at 30px and at
 * 50.4px, and then 52px takes −0.06em. Two figures one and a half pixels apart
 * are tracked fifty per cent differently. Optical tracking is a function of
 * size — bigger needs tighter — which is exactly the relationship a scale
 * encodes and a hand-written value cannot.
 *
 * ## Why a figure is not just large type
 *
 * A digit has no ascender and no descender. Every rule the type scale carries
 * is tuned for words that do: `--text-hero` reserves 1.04 line-height for
 * parts of a letterform a numeral never uses, so a figure set from it sits
 * visibly low in its own box and takes vertical space nothing occupies. Four
 * of the ten above have exactly that bug — they never got `leading-none`.
 *
 * That is the same optical problem `CreditAmount` already solved once, with a
 * −0.06em nudge, and the fix there was a component precisely because a call
 * site composing it by hand gets it wrong, and each one gets it wrong
 * differently. Ten call sites, eight answers.
 */

/* ── What is there now ─────────────────────────────────────────────── */

type Site = {
  what: string;
  px: number;
  /** `null` means the call site never set one, so the type step's applies. */
  leading: number | null;
  tracking: number | null;
  weight: "font-semibold" | "font-bold";
};

const TODAY: Site[] = [
  { what: "products · stat tile", px: 18, leading: null, tracking: null, weight: "font-bold" },
  { what: "repositories · stat tile", px: 20, leading: null, tracking: null, weight: "font-bold" },
  {
    what: "understanding · stat tile",
    px: 20,
    leading: null,
    tracking: null,
    weight: "font-semibold",
  },
  {
    what: "business map · node, grid",
    px: 20,
    leading: null,
    tracking: null,
    weight: "font-semibold",
  },
  {
    what: "business map · node, detail",
    px: 21.6,
    leading: 1,
    tracking: -0.04,
    weight: "font-semibold",
  },
  { what: "audit · area score", px: 30, leading: 1, tracking: -0.04, weight: "font-semibold" },
  { what: "Nova · health score", px: 36, leading: 1, tracking: -0.038, weight: "font-bold" },
  { what: "billing · balance", px: 50.4, leading: 1, tracking: -0.04, weight: "font-bold" },
  { what: "signal · number", px: 52, leading: 1, tracking: -0.06, weight: "font-bold" },
  {
    what: "business map · overall",
    px: 62.4,
    leading: 1,
    tracking: -0.065,
    weight: "font-semibold",
  },
];

function figure(px: number, leading: number | null, tracking: number | null): CSSProperties {
  return {
    fontSize: `${px}px`,
    lineHeight: leading ?? 1.25,
    letterSpacing: tracking !== null ? `${tracking}em` : undefined,
    fontVariantNumeric: "tabular-nums",
  };
}

function Evidence() {
  return (
    <div className="border-line-2 bg-surface-1 rounded-well flex flex-wrap items-end gap-x-8 gap-y-7 border p-6">
      {TODAY.map((site) => (
        <div key={site.what} className="flex flex-col items-start gap-2">
          {/*
            A tinted box behind each figure, because half the point is the box
            it sits in: a figure without `leading-none` reserves descender
            space no digit uses, and that gap is invisible until something
            draws the edge of the line.
          */}
          <span
            className={`text-fg bg-mint-tint-soft ${site.weight}`}
            style={figure(site.px, site.leading, site.tracking)}
          >
            72
          </span>
          <span className="text-fg-meta font-mono text-meta">
            {site.px}px
            {site.tracking !== null && ` · ${site.tracking}em`}
            {site.leading === null && (
              /* Countable rather than squintable: the tint is the line box, so
                 this says how much of it no digit can reach. */
              <span className="text-amber"> · {(site.px * 1.25).toFixed(1)}px box</span>
            )}
          </span>
          <span className="text-fg-meta text-caption">{site.what}</span>
        </div>
      ))}
    </div>
  );
}

/* ── The three answers ─────────────────────────────────────────────── */

type Tier = { token: string; px: number; leading: number; tracking: number; note: string };

/**
 * M1 — snap to the type scale.
 *
 * No new token. The three tiers take `title`, `display` and `hero`, and a
 * `Figure` component adds `tabular-nums` and `leading-none` so no call site
 * has to remember them. Cheapest, and it keeps one scale in the product.
 *
 * What it does not fix: the tracking. A hero is −0.04em because that is right
 * for a word at 48px, and the product's own figures at that size are written
 * −0.06 and −0.065 — three people reached for tighter than the token gives,
 * independently. Overriding it in the component means the token is not
 * carrying it, which is the state this whole sweep has been removing.
 */
const M1: Tier[] = [
  { token: "title", px: 19, leading: 1, tracking: -0.02, note: "A stat tile" },
  { token: "display", px: 36, leading: 1, tracking: -0.038, note: "A panel's score" },
  { token: "hero", px: 48, leading: 1, tracking: -0.04, note: "The number a screen is about" },
];

/**
 * M2 — a numeric scale in the palette. **Recommended.**
 *
 * Three new tokens, each with `line-height: 1` and its own tracking, because a
 * figure is a different object from a word and the values a word needs are
 * wrong for it. Eight sizes become three, four tracking values become three
 * that actually scale with size, and the four missing `leading-none` cannot
 * happen again because the token carries it.
 *
 * The sizes are ones the product already writes: 20px is the modal stat tile,
 * 52px is the signal number exactly. 36px is `display`'s size on purpose —
 * same size, different object, the way `lead` and `card-title` are both
 * 15px and differ only in leading. That precedent is already in this
 * repository twice.
 */
const M2: Tier[] = [
  { token: "figure-sm", px: 20, leading: 1, tracking: -0.02, note: "A stat tile" },
  { token: "figure", px: 36, leading: 1, tracking: -0.045, note: "A panel's score" },
  { token: "figure-lg", px: 52, leading: 1, tracking: -0.06, note: "The number a screen is about" },
];

/**
 * M3 — one figure, prominence from context.
 *
 * The claim: eight sizes exist because each screen tried to signal importance
 * with size, and size is the wrong tool — a stat tile is small because its
 * tile is small, and a hero score is prominent because it sits alone with
 * space around it. One figure size everywhere; the layout does the ranking.
 *
 * It is the only one that removes the decision entirely rather than reducing
 * it to three. The risk is real and visible below: a 36px number in a small
 * stat tile crowds its own box, and the screen whose whole subject is one
 * score loses the thing that made it the subject.
 */
const M3: Tier[] = [
  { token: "figure", px: 36, leading: 1, tracking: -0.045, note: "Every figure" },
];

/* ── Rendering ─────────────────────────────────────────────────────── */

/** A stat tile: a small number over what it counts. */
function StatTile({ tier }: { tier: Tier }) {
  return (
    <div className="border-line-2 bg-surface-2 rounded-well border p-4">
      <span
        className="text-fg block font-bold"
        style={figure(tier.px, tier.leading, tier.tracking)}
      >
        7
      </span>
      <p className="text-fg-meta mt-2 text-caption">connected repositories</p>
    </div>
  );
}

/** A panel's score: the number beside what it scores. */
function PanelScore({ tier }: { tier: Tier }) {
  return (
    <div className="border-line-2 bg-surface-2 rounded-well flex items-center gap-4 border p-4">
      <span
        className="text-mint font-semibold"
        style={figure(tier.px, tier.leading, tier.tracking)}
      >
        72
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-fg text-card-title font-medium">Acquisition</span>
        <span className="text-fg-meta text-caption">4 of 6 signals present</span>
      </div>
    </div>
  );
}

/** The number a screen is about. */
function HeroScore({ tier }: { tier: Tier }) {
  return (
    <div className="border-line-3 bg-surface-1 rounded-well flex flex-col items-center gap-2 border px-4 py-7">
      <span className="text-fg font-bold" style={figure(tier.px, tier.leading, tier.tracking)}>
        68
      </span>
      <p className="text-fg-meta text-caption">Business health</p>
    </div>
  );
}

function Variant({
  label,
  thesis,
  cost,
  tiers,
}: {
  label: string;
  thesis: string;
  cost: string;
  tiers: Tier[];
}) {
  // M3 has one tier and uses it everywhere; the others step through theirs.
  const at = (index: number) => tiers[Math.min(index, tiers.length - 1)];
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg text-title font-semibold">{label}</h2>
        <p className="text-fg-muted max-w-3xl text-body">{thesis}</p>
        <p className="text-fg-meta max-w-3xl text-caption">{cost}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="border-line-2 bg-surface-1 rounded-well flex flex-col gap-3 border p-5">
          {tiers.map((tier) => (
            <div key={tier.token} className="flex items-baseline gap-4">
              <span className="text-fg-meta w-32 shrink-0 font-mono text-meta">
                text-{tier.token}
                <span className="text-fg-disabled"> · {tier.px}px</span>
              </span>
              <span
                className="text-fg font-bold"
                style={figure(tier.px, tier.leading, tier.tracking)}
              >
                72
              </span>
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile tier={at(0)} />
          <PanelScore tier={at(1)} />
          <HeroScore tier={at(2)} />
        </div>
      </div>
    </section>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg text-title font-semibold">{title}</h2>
        <p className="text-fg-muted max-w-3xl text-body">{lead}</p>
      </div>
      {children}
    </section>
  );
}

/* ── The study ─────────────────────────────────────────────────────── */

export function StudyFigure({ study }: { study: Study }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-14">
      <header className="flex flex-col gap-2">
        <p className="text-fg-meta text-caption tracking-wide uppercase">Figures — {study.name}</p>
        <h1 className="text-display text-fg font-semibold">The number, when it is the point</h1>
        <p className="text-fg-muted max-w-3xl text-body">
          Ten places set a number as the subject of a screen. Between them: eight sizes, four
          tracking values, two weights, and four that never got the one property a digit actually
          needs.
        </p>
      </header>

      <Section
        title="What is actually there"
        lead="The same figure, at every size the product writes it at, on a tint so the line box is visible. Where the box is taller than the digits, the call site never set leading-none — a numeral has no descender, and that space is reserved for one anyway."
      >
        <Evidence />
      </Section>

      <Variant
        label="M1 — snap to the type scale"
        thesis="No new token. Stat, score and hero take title, display and hero; a Figure component adds tabular-nums and leading-none so no call site has to remember them."
        cost="The tracking stays tuned for words. hero is −0.04em, and three people independently wrote −0.06 or tighter at that size — overriding it in the component means the token is not carrying it."
        tiers={M1}
      />

      <Variant
        label="M2 — a numeric scale in the palette · recommended"
        thesis="Three tokens with line-height 1 and their own tracking, because a digit has no ascender or descender and the values a word needs are wrong for it. Eight sizes become three; four tracking values become three that scale with size."
        cost="Three new tokens, and figure at 36px is display's size under a second name — deliberately, the way lead and card-title are both 15px and differ only in leading."
        tiers={M2}
      />

      <Variant
        label="M3 — one figure, prominence from context"
        thesis="Eight sizes exist because each screen used size to signal importance. One size everywhere; the layout does the ranking — a stat tile is small because its tile is, a hero score is prominent because it sits alone."
        cost="The only one that removes the decision rather than reducing it. It also crowds the stat tile and takes the subject away from the screen whose subject was one number."
        tiers={M3}
      />
    </main>
  );
}
