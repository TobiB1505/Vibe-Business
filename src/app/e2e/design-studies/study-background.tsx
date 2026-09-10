import type { CSSProperties } from "react";
import { ChevronDownIcon } from "@/components/ui/icons.generated";
import { buttonClasses } from "@/components/ui/button";
import type { Study } from "./studies";

/**
 * What the ground is for.
 *
 * ## The finding
 *
 * Three separate things are true and none of them was noticed until the
 * background was asked about directly.
 *
 * 1. **The product has no ground.** `globals.css` sets
 *    `body { background-color: var(--color-app) }` and stops. The twenty-five
 *    radial gradients in that file all belong to individual components. What a
 *    user sees behind every screen is one flat near-black field.
 * 2. **The palette's atmosphere is dead code.** `theme-v2.css` defines
 *    `.vibe-atmosphere` and `.vibe-grain`, and no `.tsx` in the repository
 *    wears either class. It was ported into the palette and never connected,
 *    so v2 has been drawing glass over the same flat field v1 does.
 * 3. **Only the studies have a ground**, in `studies.css`, written for one
 *    screen.
 *
 * ## Why this is not a decoration question
 *
 * `backdrop-filter` returns what is behind it. Behind a flat field it returns
 * the same flat field, which is why a first draft of the glass read as
 * translucent grey: every gradient was in the corners and the middle of the
 * page — where all the glass sits — had nothing under it.
 *
 * So the requirement is narrower than "make it pretty": **the light has to
 * change across the width of a pane.** A luminance ramp satisfies that. Five
 * coloured fields also satisfy it, and cost a great deal more.
 *
 * The four below differ in what the ground is *for*, not in how it is
 * decorated. Each is drawn under the same glass card, so the comparison is of
 * refraction rather than of wallpaper.
 *
 * ## What the numbers are, and a wrong turn they caught
 *
 * `measured` on each is the luminance ratio across the pane — a one-pixel
 * strip read out of a real screenshot, converted to relative luminance, taken
 * once left-to-right and once top-to-bottom.
 *
 * The first pass measured only the horizontal strip and made treatment 2 look
 * broken: 1.04×, which is a pane standing on nothing. Measuring the other axis
 * showed 4.75×, the largest vertical range of the four. A ramp is vertical, so
 * a horizontal cut through it is the one line where by construction it does
 * not change. Every treatment here gives a pane something to carry; what
 * differs is on which axis, and what the ground says while doing it.
 *
 * ## What is deliberately not varied here
 *
 * Movement. A drifting atmosphere is a real option and a separate decision —
 * folding "which shape" and "does it move" into four options would confound
 * both. Whatever wins here can be asked to move afterwards, and then it owes
 * the three motion obligations.
 */

/* ── The grounds ────────────────────────────────────────────────────── */

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Mint and a cold blue, at the chosen direction's strengths. */
const A1 = "rgb(0 229 160 / 0.15)";
const A2 = "rgb(70 130 200 / 0.10)";
const A3 = "rgb(0 229 160 / 0.045)";
const GROUND = "#06080a";

const GROUNDS: Record<string, CSSProperties> = {
  /* 1 · The study's field, verbatim. */
  study: {
    background: `
      radial-gradient(38rem 26rem at 26% 18%, ${A1}, transparent 68%),
      radial-gradient(30rem 22rem at 74% 42%, ${A2}, transparent 66%),
      radial-gradient(22rem 18rem at 46% 74%, ${A3}, transparent 70%),
      radial-gradient(64rem 46rem at 8% -10%, ${A1}, transparent 60%),
      radial-gradient(58rem 44rem at 96% 104%, ${A2}, transparent 62%),
      ${GROUND}`,
  },

  /* 2 · A luminance ramp and nothing else — the minimum that makes glass. */
  ramp: {
    background: `
      linear-gradient(180deg, rgb(255 255 255 / 0.055) 0%, rgb(255 255 255 / 0.012) 46%, transparent 78%),
      ${GROUND}`,
  },

  /* 3 · The ground carries what Vibe is doing. Shown in its "ready" colour. */
  state: {
    background: `
      radial-gradient(52rem 30rem at 50% -6%, rgb(0 229 160 / 0.13), transparent 62%),
      linear-gradient(180deg, rgb(255 255 255 / 0.03) 0%, transparent 60%),
      ${GROUND}`,
  },

  /* 4 · The ramp everywhere, one contained field where the primary card sits. */
  contained: {
    background: `
      radial-gradient(30rem 20rem at 34% 26%, ${A1}, transparent 66%),
      radial-gradient(26rem 18rem at 70% 34%, ${A2}, transparent 64%),
      linear-gradient(180deg, rgb(255 255 255 / 0.045) 0%, rgb(255 255 255 / 0.01) 52%, transparent 80%),
      ${GROUND}`,
  },
};

/* ── The pane that has to prove it ──────────────────────────────────── */

/**
 * One glass card, identical in all four, over the ground being argued about.
 *
 * The values are the palette's own: `--glass-blur` 24px, `--glass-sat` 100%,
 * a 4% fill and a 16% line. Nothing here is tuned per variant, because the
 * question is what the ground gives the pane, not how the pane is built.
 */
function GlassCard({ note }: { note: string }) {
  return (
    <div className="absolute inset-x-6 bottom-6 top-14 max-sm:inset-x-4">
      <div
        className="flex h-full flex-col justify-between rounded-card border p-5"
        style={{
          background: "rgb(255 255 255 / 0.04)",
          borderColor: "rgb(255 255 255 / 0.16)",
          backdropFilter: "blur(24px) saturate(100%)",
          boxShadow: "0 14px 36px -26px rgb(0 0 0 / 0.8)",
        }}
      >
        <div>
          <p className="eyebrow text-fg-meta">Worth doing</p>
          <p className="mt-2 max-w-[34ch] text-title font-semibold text-fg">
            Your code takes payments and your site offers no way to pay
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={buttonClasses({ variant: "ghost" })}>
            <ChevronDownIcon size={14} />2 sources
          </span>
          <span className="font-mono text-meta text-fg-meta">{note}</span>
        </div>
      </div>
    </div>
  );
}

type Ground = {
  key: keyof typeof GROUNDS;
  name: string;
  job: string;
  argument: string;
  cost: string;
  /** What the pane is standing on, in one phrase, printed on the card. */
  note: string;
  /** Luminance ratio across the pane: [left-to-right, top-to-bottom]. */
  measured: readonly [string, string];
};

const GROUND_LIST: readonly Ground[] = [
  {
    key: "study",
    measured: ["1.31×", "3.39×"],
    name: "1 · Das Feld aus der Studie",
    job: "Signatur",
    argument:
      "The chosen direction verbatim: five fixed fields, mint and a cold blue, three of them under the reading column rather than in the corners. It is the version the glass was designed against, and the one where a pane most obviously carries light that changes across its width.",
    cost: "It was drawn behind one screen. Vibe also has diff views, settings tables and agent logs, and five coloured fields behind a diff is noise behind data. And because it is identical on every route, it stops carrying information — a background that always says the same thing is wallpaper.",
    note: "5 fields · fixed",
  },
  {
    key: "ramp",
    measured: ["1.04×", "4.75×"],
    name: "2 · Nur ein Lichtverlauf",
    job: "Das Minimum, das Glas zu Glas macht",
    argument:
      "No colour at all — a single luminance ramp, brighter at the top, gone by the lower third, plus grain so it does not band. It satisfies the actual requirement (the light changes across a pane) with the least possible means, and it is legible behind dense content because there is nothing to compete with.",
    cost: "It has no signature. Every product with a dark theme has this, and nothing about it says Vibe. And it works on one axis only — 1.04× across a pane against 4.75× down it — so a wide, short card sits on almost nothing while a tall one sits on the most light of the four. It also runs out at the bottom of a long page.",
    note: "1 ramp · no hue",
  },
  {
    key: "state",
    measured: ["1.12×", "2.50×"],
    name: "3 · Der Grund trägt den Zustand",
    job: "Information",
    argument:
      "The atmosphere takes its colour from what Vibe is doing — mint when something is ready to look at, amber when a decision is waiting, neutral when nothing is. The only one of the four where the ground is information rather than decoration, which is what this repository asks of a structural device.",
    cost: "A ground that changes colour is a loud signal, and a whole screen turning amber reads as an error rather than as “your turn”. It also means the ground is never stable — the thing the entire interface is composited on moves with product state, and every colour has to stay legible under every surface.",
    note: "ready · mint",
  },
  {
    key: "contained",
    measured: ["1.18×", "5.72×"],
    name: "4 · Ruhig überall, stark unter dem Kopf",
    job: "Beides, nach Ort getrennt",
    argument:
      "Treatment 2's ramp as the product's ground, plus one contained field where the primary card sits and nowhere else. The screen a founder arrives on gets the expensive version; the diff view and the settings table get a quiet one. It is the by-role split again, applied to the ground.",
    cost: "Glass at the top of a page refracts more than glass below it, and on a long scroll you can see that inconsistency. It also needs a rule about which surfaces get the field — one more decision at the call site, and one more thing to get wrong.",
    note: "ramp + 1 field",
  },
];

function Row({ ground }: { ground: Ground }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-2 py-8">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-title font-semibold text-fg">{ground.name}</h2>
          <span className="eyebrow text-mint">{ground.job}</span>
        </div>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{ground.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{ground.cost}</p>
        <p className="mt-2 font-mono text-meta text-fg-meta">
          Licht über die Scheibe: {ground.measured[0]} quer · {ground.measured[1]} hoch
        </p>
      </div>

      {/* The ground and the pane in one contained frame, so four grounds can
          be compared on one page without four fixed layers fighting. */}
      <div
        className="relative h-72 overflow-hidden rounded-panel border border-line-2"
        style={GROUNDS[ground.key]}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: GRAIN, opacity: 0.035 }}
        />
        <GlassCard note={ground.note} />
      </div>
    </section>
  );
}

export function StudyBackground({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Der Grund</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">
          Was hinter dem Glas liegen soll
        </h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. A <code className="font-mono text-ui">backdrop-filter</code>{" "}
          returns what is behind it. Behind a flat field it returns the same flat field — which is
          why the requirement here is not “make it pretty” but{" "}
          <b className="text-fg">the light has to change across the width of a pane</b>.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          Three things were found on the way in, and the third is a defect. The product has no
          ground at all — <code className="font-mono text-ui">body</code> is one flat colour. The
          studies have one, written for a single screen. And{" "}
          <code className="font-mono text-ui">theme-v2.css</code> defines{" "}
          <code className="font-mono text-ui">.vibe-atmosphere</code> and{" "}
          <code className="font-mono text-ui">.vibe-grain</code> which no component wears, so v2 has
          been drawing its glass over the same flat field v1 does.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          The same card is drawn on all four, with the palette&rsquo;s own glass values and no
          per-variant tuning. Under each is the measured luminance ratio across its pane, read out
          of a screenshot rather than judged by eye — the first pass measured only the horizontal
          axis and made treatment 2 look broken, which is why both are printed. Movement is
          deliberately not varied: that is a second decision, and it owes the three motion
          obligations when it is taken.
        </p>
      </header>

      {GROUND_LIST.map((ground) => (
        <Row key={ground.key} ground={ground} />
      ))}
    </div>
  );
}
