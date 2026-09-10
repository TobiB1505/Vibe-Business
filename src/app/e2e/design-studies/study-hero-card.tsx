"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GithubMark } from "@/components/brand/provider-marks";
import { NovaPresence } from "@/components/nova/nova-presence";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { ArrowRightIcon, LockIcon } from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * One card in the middle, and what stands behind it (UI-34, second pass).
 *
 * ## What was asked for
 *
 * An endless-scroll page whose blocks fade in as they arrive, a very prominent
 * centred hero card with a background behind it, and marketing blocks below.
 * The first four treatments answered *what the hero shows*; this one answers
 * *what the hero is*, which is the question that was actually being asked.
 *
 * So the card is identical in all four. Only the ground behind it changes,
 * which is the one variable under review — four treatments of the same card
 * with four different backgrounds compare a background; four different cards
 * would compare nothing.
 *
 * ## What the registries had, this time
 *
 * The first search asked for a "wow hero" and came back with invented
 * credibility. Asking for a **hero card** instead came back with mechanisms,
 * which is a different and much better answer:
 *
 * - **Focus Hero** (21st.dev) — a field of marks that all point at a central
 *   card. The background *means* something rather than decorating, and what it
 *   means happens to be Vibe's entire thesis: everything converges on one
 *   move. That is A.
 * - **Glowy Waves Hero** (21st.dev) and **Aurora Background** (Aceternity) —
 *   luminous bands drifting behind the content. Aceternity's is two repeating
 *   linear gradients at 300%/200% with an animated `background-position`,
 *   blurred and masked; the mechanism ports cleanly and its palette does not.
 *   That is B, in mint.
 * - **Border Beam** (Magic UI) — a beam travelling the border of a container,
 *   so the card is its own light source and the ground stays empty. That is C,
 *   rewritten as one conic gradient rather than the library's motion component.
 * - **GlowingHero background** (21st.dev) — one soft light behind the subject.
 *   Vibe already draws the grid; adding the light is four lines. That is D.
 *
 * Nothing is installed. Every one is a background reproduced by hand in Vibe's
 * tokens, in `studies.css`, where the three motion obligations are met in CSS
 * rather than promised in a comment.
 *
 * ## Why the scroll reveal is written here and not in `src/components`
 *
 * Because it has not been chosen. `Reveal` already exists for entrance on
 * mount; this is entrance on *arrival*, which is a different mechanism and a
 * new dependency on `IntersectionObserver` — the repository has none today.
 * It graduates with whichever direction survives.
 */

type Treatment = {
  key: string;
  name: string;
  claim: string;
  argument: string;
  /** The class the ground behind the card wears. */
  ground: string;
  /** Extra classes on the card itself, where the treatment lights the card. */
  card?: string;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "a",
    name: "A · Das Feld zeigt auf die Karte",
    claim: "Der Hintergrund bedeutet etwas: alles läuft auf eine Sache zu.",
    argument:
      "Von 21st.dev („Focus Hero“): ein Feld aus Marken, die alle auf die mittige Karte zeigen. Es dekoriert nicht, es sagt etwas — und zwar genau Vibes These: aus allem, was Vibe liest, wird ein Zug. Hier als Vibes eigenes Raster, zur Karte hin ausgeblendet. Statisch, also kostet es nichts und es gibt nichts zu reduzieren.",
    ground: "study-hero-field",
  },
  {
    key: "b",
    name: "B · Aurora",
    claim: "Leuchtbänder ziehen langsam hinter der Karte durch.",
    argument:
      "Von Aceternity portiert: zwei sich wiederholende Verläufe auf 300 % Breite, deren Position wandert, weichgezeichnet und zu einer Ellipse maskiert. Der Mechanismus überträgt sich sauber, die Farben nicht — hier in Mint. Das ist die atmosphärischste der vier und die einzige, die durchgehend animiert; unter reduzierter Bewegung steht sie still.",
    ground: "study-hero-aurora",
  },
  {
    key: "c",
    name: "C · Die Karte ist das Licht",
    claim: "Kein Hintergrund. Ein Lichtstrahl wandert über den Rand der Karte.",
    argument:
      "Von Magic UIs „Border Beam“, hier als ein einziger konischer Verlauf statt als Motion-Komponente. Der Boden bleibt leer, die Karte leuchtet selbst — das ist die zurückhaltendste Variante und die, die auf einem schwachen Display am wenigsten verliert.",
    ground: "",
    card: "study-hero-beam",
  },
  {
    key: "d",
    name: "D · Raster und ein Licht",
    claim: "Vibes eigenes Raster, mit einem weichen Schein hinter der Karte.",
    argument:
      "Das Raster gibt es schon — `.vibe-atmosphere` zeichnet es auf jeder Seite. Dazu ein Lichtfleck hinter der Karte, sonst nichts. Die billigste der vier und die einzige, die nichts Neues einführt: sie nimmt, was das Produkt bereits hat, und stellt eine Lampe dahinter.",
    ground: "study-hero-spot",
  },
];

/**
 * Entrance on arrival.
 *
 * ## The three obligations
 *
 * **Reduced motion**: the observer is never created, and the content starts
 * visible. Not "animates faster" — absent.
 *
 * **Hidden tab**: `IntersectionObserver` does not fire for a document that is
 * not being rendered, so there is nothing to pause. That is the reason to use
 * it rather than a scroll listener, which fires regardless.
 *
 * **Reserved geometry**: what changes is `opacity` and a `translate3d`. The
 * element occupies its box from first paint, so nothing below it moves as it
 * arrives — which is what makes a long page of these scroll smoothly rather
 * than jumping under the reader's thumb.
 *
 * Once revealed, it stays revealed. A block that faded back out on the way up
 * would be a page that cannot be re-read.
 */
function ScrollReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Milliseconds, for a small stagger inside one block. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // No observer at all under reduced motion. The content is already visible
    // — `motion-reduce:` below does that in CSS — so there is nothing to
    // reveal and nothing to watch for. Setting state here instead would be a
    // synchronous setState in an effect, which is a cascading render for a
    // frame that had no reason to happen.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      // A little before the edge, so a block is already arriving rather than
      // starting the moment its first pixel appears.
      { rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : undefined }}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-vibe",
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        // The reduced-motion answer, in CSS rather than in state: the block is
        // simply where it belongs, with no transition to shorten.
        "motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The card, identical in every treatment.
 *
 * Prominent and centred, as asked. What it carries is what the current hero
 * carries — the positioning line, the sentence under it, one paid-for control
 * and the two assurances the product already makes — with Nova's mark above,
 * because she is the thing no catalogue supplies.
 */
function HeroCard({ className }: { className?: string }) {
  return (
    <Surface
      level="card"
      padding="none"
      className={cn(
        "relative mx-auto w-full max-w-3xl overflow-hidden rounded-stage",
        "flex flex-col items-center gap-7 px-10 py-14 text-center max-sm:px-6 max-sm:py-10",
        className,
      )}
    >
      <NovaPresence state="idle" seed="vibe-landing" size="lg" still />

      <div className="flex flex-col items-center gap-4">
        <MonoLabel as="p" className="text-fg-meta">
          Nova · deine KI-Mitgründerin
        </MonoLabel>
        <h2 className="text-fg max-w-[16ch] text-display font-bold tracking-[-0.04em]">
          You built the product. Now build <span className="text-mint">the business.</span>
        </h2>
        <p className="text-fg-prose max-w-[52ch] text-lead">
          Vibe Business understands what you built, finds what is holding the business back,
          prioritizes what to do next, and helps you execute it with AI.
        </p>
      </div>

      <MarketingCta href="/signup" assurance="No credit card to start">
        <GithubMark size={18} />
        Start with your GitHub repo
        <ArrowRightIcon size={16} />
      </MarketingCta>

      <div className="text-fg-meta flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-caption">
        <span className="flex items-center gap-2">
          <LockIcon size={14} />
          Your approval before merge
        </span>
        <span className="flex items-center gap-2">
          <LockIcon size={14} />
          No stored copy of your code
        </span>
      </div>
    </Surface>
  );
}

/** One treatment: the same card, on its own ground. */
function HeroStage({ treatment }: { treatment: Treatment }) {
  /*
    The beam wraps the card rather than being a class on it. It paints a conic
    gradient edge to edge and lays the page's own ground back over it, inset by
    the pixel that becomes the ring — so the card, which is glass, never has a
    gradient behind it to show through.
  */
  const card = <HeroCard />;

  return (
    <div className="relative isolate overflow-hidden rounded-card py-20 max-sm:py-12">
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 -z-10", treatment.ground)}
      />
      {treatment.card ? (
        <div className={cn("mx-auto w-full max-w-3xl", treatment.card)}>
          <div className="study-hero-beam-inner">{card}</div>
        </div>
      ) : (
        card
      )}
    </div>
  );
}

/**
 * What the scroll feels like, once.
 *
 * Drawn under the four rather than four times over, because the reveal is the
 * same mechanism whichever background wins and repeating it would make the
 * page four times as long for no comparison.
 */
const BLOCKS = [
  {
    label: "Schritt 1",
    title: "Vibe liest, was du gebaut hast",
    body: "Repository und Live-Produkt, unter festen Budgets. Keine Kopie deines Codes bleibt liegen.",
  },
  {
    label: "Schritt 2",
    title: "Neun Geschäftsbereiche, mit Belegen",
    body: "Jede Aussage zeigt, worauf sie sich stützt. Was Vibe nicht beurteilen kann, bleibt leer statt null.",
  },
  {
    label: "Schritt 3",
    title: "Ein Zug, kein Bericht",
    body: "Aus dem Audit wird der eine Schritt, der als Nächstes zählt — mit dem, was er kostet, bevor du drückst.",
  },
  {
    label: "Schritt 4",
    title: "Der Agent baut ihn, du gibst frei",
    body: "Vibe schreibt auf einen eigenen Branch. Auf deinen Default-Branch kommt nichts ohne deine Freigabe.",
  },
] as const;

function ScrollDemo() {
  return (
    <div className="flex flex-col gap-6">
      {BLOCKS.map((block, index) => (
        <ScrollReveal key={block.label} delay={index === 0 ? 0 : 60}>
          <Surface
            level="panel"
            padding="lg"
            className="flex flex-wrap items-baseline gap-x-8 gap-y-3"
          >
            <MonoLabel as="p" className="text-mint w-24 shrink-0">
              {block.label}
            </MonoLabel>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h3 className="text-fg text-title font-semibold">{block.title}</h3>
              <p className="text-fg-prose max-w-[64ch] text-body leading-relaxed">{block.body}</p>
            </div>
          </Surface>
        </ScrollReveal>
      ))}
    </div>
  );
}

export function StudyHeroCard({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Landing · zweiter Durchgang</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Eine Karte in der Mitte — und was dahinter steht
        </h1>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-lead">
          Gezeichnet in {study.name}. Die Karte ist in allen vier <b className="text-fg">gleich</b>.
          Nur der Grund dahinter wechselt, denn genau das ist die Frage. Darunter einmal, wie sich
          das Scrollen anfühlt.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Was die Register diesmal hatten</p>
        <h2 className="text-fg mt-3 text-title font-semibold">
          Nach „Hero-Card“ zu fragen brachte Mechanismen statt erfundener Zahlen
        </h2>
        <ul className="text-fg-prose mt-4 flex max-w-[70ch] flex-col gap-2 text-caption">
          <li>
            <b className="text-fg">Focus Hero</b> (21st.dev) — ein Feld aus Marken, die alle auf
            eine mittige Karte zeigen. Der Hintergrund bedeutet etwas. → A
          </li>
          <li>
            <b className="text-fg">Aurora Background</b> (Aceternity) und{" "}
            <b className="text-fg">Glowy Waves</b> (21st.dev) — zwei wandernde Verläufe auf 300 %
            Breite, weichgezeichnet und maskiert. Mechanismus portierbar, Farben nicht. → B
          </li>
          <li>
            <b className="text-fg">Border Beam</b> (Magic UI) — ein Strahl auf dem Rand, die Karte
            leuchtet selbst. Hier als ein konischer Verlauf statt als Bibliothek. → C
          </li>
          <li>
            <b className="text-fg">GlowingHero</b> (21st.dev) — ein weiches Licht hinter dem Motiv.
            Das Raster hat Vibe schon. → D
          </li>
        </ul>
        <p className="text-fg-muted mt-4 max-w-[70ch] text-caption">
          Nichts installiert. Jeder Hintergrund ist von Hand in Vibes Tokens nachgebaut, in{" "}
          <code className="font-mono text-ui">studies.css</code>, wo die drei Bewegungs-Pflichten in
          CSS stehen statt in einem Kommentar: unter reduzierter Bewegung steht alles still, nichts
          verändert Geometrie, und der Scroll-Reveal benutzt{" "}
          <code className="font-mono text-ui">IntersectionObserver</code> — der in einem
          Hintergrund-Tab gar nicht erst feuert.
        </p>
      </div>

      {TREATMENTS.map((treatment) => (
        <section key={treatment.key} className="border-line-3 mt-10 border-t pt-8">
          <h2 className="text-fg text-title font-semibold">{treatment.name}</h2>
          <p className="text-fg-prose mt-3 max-w-[70ch] text-caption">{treatment.claim}</p>
          <p className="text-fg-muted mt-2 max-w-[70ch] text-caption">{treatment.argument}</p>
          <div className="mt-6">
            <HeroStage treatment={treatment} />
          </div>
        </section>
      ))}

      <section className="border-line-3 mt-10 border-t pt-8">
        <h2 className="text-fg text-title font-semibold">Und so scrollt es weiter</h2>
        <p className="text-fg-prose mt-3 max-w-[70ch] text-caption">
          Jeder Block kommt beim Erreichen herein und bleibt dann. Einer, der beim Hochscrollen
          wieder verschwände, wäre eine Seite, die man nicht zweimal lesen kann.
        </p>
        <div className="mt-6">
          <ScrollDemo />
        </div>
      </section>
    </div>
  );
}
