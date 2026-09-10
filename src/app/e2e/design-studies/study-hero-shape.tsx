"use client";

import { GithubMark } from "@/components/brand/provider-marks";
import { NovaPresence } from "@/components/nova/nova-presence";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { ArrowRightIcon, BranchIcon, CheckIcon, LockIcon } from "@/components/ui/dashboard-icons";
import { buttonClasses } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * Four hero cards, built from scratch (UI-34, third pass).
 *
 * ## Why this study exists
 *
 * The previous one drew **one** card and put four backgrounds behind it, and
 * said so in its own docblock as though that were a method. It is a method for
 * choosing a background. It is not a method for designing a card, and a card
 * was what had been asked for — so the thing under review never got designed.
 *
 * What that one card was: a centred stack of mark, eyebrow, headline,
 * paragraph, button, two lock lines. That is the most generic hero arrangement
 * there is, and no amount of ground behind it changes that.
 *
 * So the variable is inverted here. **The ground is the same in all four** —
 * the grid that fades toward the centre — and every card is a different object
 * with a different internal structure, different proportions, and different
 * content. Not four skins. Four shapes.
 *
 * ## What each one is trying to be
 *
 * 1. **The console.** The card is a product window: a header bar with the
 *    project and its state, a body of lines arriving, the control at the foot.
 *    The headline lives *above* the card rather than inside it, so the card is
 *    a thing being shown rather than a poster.
 * 2. **Split.** The card is divided: the argument on the left with its one
 *    control, a live fragment of the product on the right. Asymmetric, and the
 *    only one where a reader's eye has two places to land.
 * 3. **The deck.** Three cards behind each other, the front one sharp and the
 *    two behind it cropped. Scan, audit, move — the sequence as depth, in one
 *    picture, without a diagram.
 * 4. **The window sill.** A very wide card: a narrow band of type across the
 *    top, and under it the product's own row shapes at full width. Closest to a
 *    framed screenshot, and the only one that is wider than it is tall.
 *
 * ## What is the same in all four, and why
 *
 * The words. The positioning line, the sentence under it, the one control and
 * the two assurances the product actually makes — because a comparison where
 * the copy also moves is a comparison of nothing. And no invented number,
 * rating or customer count appears in any of them; the landing contract bans
 * those by name and they are what the catalogue's "wow" heroes are made of.
 */

type Treatment = {
  key: string;
  name: string;
  claim: string;
  argument: string;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "1",
    name: "1 · Die Konsole",
    claim: "Die Karte ist ein Produktfenster. Die Überschrift steht darüber, nicht darin.",
    argument:
      "Kopfleiste mit Projekt und Zustand, darunter Zeilen, die eintreffen, unten der Knopf. Für Leute, die den ganzen Tag in einem Terminal sitzen, ist das die vertrauteste Form überhaupt — und sie zeigt das Produkt bei der Arbeit, statt es zu beschreiben. Die schmalste der vier.",
  },
  {
    key: "2",
    name: "2 · Zweigeteilt",
    claim: "Links das Argument mit dem Knopf, rechts ein Ausschnitt aus dem Produkt.",
    argument:
      "Die einzige, bei der das Auge zwei Landeplätze hat. Links wird gelesen, rechts wird geschaut — und weil rechts echte Produktoberfläche steht, muss die linke Seite nicht behaupten, was die rechte zeigt. Asymmetrisch 55/45.",
  },
  {
    key: "3",
    name: "3 · Das Deck",
    claim: "Drei Karten hintereinander. Die vordere scharf, die zwei dahinter angeschnitten.",
    argument:
      "Scan, Audit, Move — die Abfolge als Tiefe statt als Diagramm. Ein Bild sagt, dass es mehr als einen Schritt gibt, ohne drei Kästen nebeneinander zu stellen. Die auffälligste der vier und die, die am meisten Höhe kostet.",
  },
  {
    key: "4",
    name: "4 · Die Fensterbank",
    claim: "Sehr breit: oben ein Band aus Text, darunter über die volle Breite das Produkt.",
    argument:
      "Die einzige, die breiter als hoch ist. Oben ein schmaler Streifen mit Überschrift und Knopf, darunter über die ganze Breite die echten Zeilenformen aus der Produktliste. Am nächsten an einem gerahmten Screenshot — und am ehrlichsten darin, dass das Produkt eine Liste ist.",
  },
];

const HEADLINE_A = "You built the product. Now build ";
const HEADLINE_B = "the business.";
const SUB =
  "Vibe versteht, was du gebaut hast, findet, was das Geschäft aufhält, und baut den nächsten Schritt — mit deiner Freigabe.";

function Cta({ compact = false }: { compact?: boolean }) {
  return (
    <MarketingCta href="/signup" assurance={compact ? undefined : "Keine Kreditkarte nötig"}>
      <GithubMark size={18} />
      Mit deinem GitHub-Repo starten
      <ArrowRightIcon size={16} />
    </MarketingCta>
  );
}

function Assurances({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "text-fg-meta flex flex-wrap items-center gap-x-5 gap-y-2 text-caption",
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <LockIcon size={13} />
        Deine Freigabe vor jedem Merge
      </span>
      <span className="flex items-center gap-2">
        <LockIcon size={13} />
        Keine Kopie deines Codes
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ 1 */

/**
 * The console.
 *
 * A window chrome rather than a poster: the bar names the project and its
 * state, and the body is the product's own log shape. What it must never do is
 * print a score — these are things Vibe *did*, not judgements it reached.
 */
const LOG = [
  { mark: "done", text: "vibe-business gelesen", meta: "41 Dateien" },
  { mark: "done", text: "Live-Produkt gelesen", meta: "8 Seiten" },
  { mark: "done", text: "Neun Bereiche bewertet", meta: "mit Belegen" },
  { mark: "now", text: "Nächster Zug wird vorbereitet", meta: null },
] as const;

function HeroConsole() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-fg max-w-[20ch] text-hero font-bold tracking-[-0.04em]">
          {HEADLINE_A}
          <span className="text-mint">{HEADLINE_B}</span>
        </h2>
        <p className="text-fg-prose max-w-[46ch] text-lead">{SUB}</p>
      </div>

      <div className="border-line-3 study-hero-object shadow-stage w-full overflow-hidden rounded-card border">
        <div className="border-line-2 bg-surface-3 flex items-center gap-3 border-b px-4 py-2.5">
          <NovaPresence state="working" seed="vibe-hero" size="sm" still />
          <span className="text-fg-body font-mono text-caption">TobiB1505/vibe-business</span>
          <StatusPill tone="active" className="ml-auto">
            Liest
          </StatusPill>
        </div>

        <ul className="flex flex-col px-4 py-3">
          {LOG.map((line, index) => (
            <li
              key={line.text}
              className={cn(
                "flex items-center gap-3 py-2 font-mono text-caption",
                index > 0 && "border-line-1 border-t",
              )}
            >
              {line.mark === "done" ? (
                <CheckIcon size={14} className="text-mint shrink-0" />
              ) : (
                <BranchIcon size={14} className="text-fg-meta shrink-0" />
              )}
              <span className={line.mark === "done" ? "text-fg-body" : "text-fg-meta"}>
                {line.text}
              </span>
              {line.meta && <span className="text-fg-meta ml-auto">{line.meta}</span>}
            </li>
          ))}
        </ul>

        <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t px-4 py-4">
          <Cta compact />
          <Assurances className="flex-col items-start gap-y-1" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 2 */

/** Split: the argument on the left, a fragment of the product on the right. */
function HeroSplit() {
  return (
    <div className="border-line-3 study-hero-object shadow-stage mx-auto w-full max-w-5xl overflow-hidden rounded-stage border">
      <div className="grid lg:grid-cols-[55fr_45fr]">
        <div className="flex flex-col justify-center gap-6 px-10 py-12 max-sm:px-6 max-sm:py-9">
          <h2 className="text-fg max-w-[13ch] text-display font-bold tracking-[-0.04em]">
            {HEADLINE_A}
            <span className="text-mint">{HEADLINE_B}</span>
          </h2>
          <p className="text-fg-prose max-w-[44ch] text-lead">{SUB}</p>
          <Cta />
          <Assurances />
        </div>

        {/*
          The right half is the product, not a picture of one: the same row
          shapes the products page draws, at the same rhythm. It is cropped by
          the card's edge on purpose — a fragment reads as a window into
          something larger, where a complete miniature reads as a diagram.
        */}
        <div className="border-line-2 bg-surface-3 flex flex-col gap-3 border-l p-8 max-lg:border-l-0 max-lg:border-t max-sm:p-6">
          <MonoLabel as="p" className="text-fg-meta">
            Was Nova als Nächstes vorschlägt
          </MonoLabel>

          <div className="border-line-2 bg-surface-2 flex flex-col gap-3 rounded-card border p-4">
            <div className="flex items-center gap-3">
              <NovaPresence state="idle" seed="vibe-hero" size="sm" still />
              <StatusPill tone="problem">Braucht dich</StatusPill>
            </div>
            <p className="text-fg-body text-body leading-relaxed">
              Die Preisseite nennt drei Pläne und keinen Preis.
            </p>
            <span className={cn(buttonClasses({ variant: "secondary" }), "w-fit")}>
              Den Zug ansehen
            </span>
          </div>

          <div className="border-line-2 bg-surface-2 flex items-center gap-3 rounded-card border p-4 opacity-60">
            <span className="text-fg-meta font-mono text-caption">2</span>
            <span className="text-fg-muted truncate text-caption">
              Onboarding endet ohne nächsten Schritt
            </span>
          </div>

          <div className="border-line-2 bg-surface-2 flex items-center gap-3 rounded-card border p-4 opacity-30">
            <span className="text-fg-meta font-mono text-caption">3</span>
            <span className="text-fg-muted truncate text-caption">Keine Analytics verdrahtet</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 3 */

/** The deck: the sequence as depth. */
const DECK = [
  { label: "Scan", line: "Repository und Live-Produkt gelesen." },
  { label: "Audit", line: "Neun Bereiche, mit Belegen." },
] as const;

function HeroDeck() {
  return (
    <div className="relative mx-auto w-full max-w-3xl pt-[4.5rem]">
      {/*
        The two behind, drawn first and cropped by their own offsets. They are
        `aria-hidden` because a screen reader meeting three stacked headings
        would meet a sequence the page is showing rather than saying — the
        front card carries every word that matters.
      */}
      {DECK.map((card, index) => (
        <div
          key={card.label}
          aria-hidden
          style={{
            transform: `translateY(${-(index + 1) * 40}px) scale(${1 - (index + 1) * 0.05})`,
          }}
          className={cn(
            "border-line-2 study-hero-object-back absolute inset-x-0 top-[4.5rem] rounded-stage border px-8 py-3.5",
            index === 0 ? "z-10 opacity-70" : "z-0 opacity-35",
          )}
        >
          <div className="flex items-center gap-3">
            <MonoLabel as="span" className="text-fg-meta">
              {card.label}
            </MonoLabel>
            <span className="text-fg-muted truncate text-caption">{card.line}</span>
          </div>
        </div>
      ))}

      <div className="border-line-3 study-hero-object shadow-stage relative z-20 flex flex-col items-center gap-7 rounded-stage border px-10 py-12 text-center max-sm:px-6 max-sm:py-9">
        <MonoLabel as="p" className="text-mint">
          Move · Schritt drei
        </MonoLabel>
        <h2 className="text-fg max-w-[18ch] text-display font-bold tracking-[-0.04em]">
          {HEADLINE_A}
          <span className="text-mint">{HEADLINE_B}</span>
        </h2>
        <p className="text-fg-prose max-w-[46ch] text-lead">{SUB}</p>
        <Cta />
        <Assurances className="justify-center" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 4 */

/** The window sill: wider than it is tall, with the product's own rows in it. */
const SILL = [
  { name: "Payflow", state: "Braucht dich", tone: "problem" as const, signal: "46" },
  { name: "Quietly Fine", state: "Aktuell", tone: "success" as const, signal: "71" },
  { name: "Half Set Up", state: "Noch nicht analysiert", tone: "neutral" as const, signal: "—" },
];

function HeroSill() {
  return (
    <div className="border-line-3 study-hero-object shadow-stage mx-auto w-full max-w-6xl overflow-hidden rounded-stage border">
      <div className="flex flex-wrap items-end justify-between gap-6 px-10 pt-11 pb-9 max-sm:px-6 max-sm:pt-8">
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="text-fg max-w-[18ch] text-display font-bold tracking-[-0.04em]">
            {HEADLINE_A}
            <span className="text-mint">{HEADLINE_B}</span>
          </h2>
          <p className="text-fg-prose max-w-[50ch] text-lead">{SUB}</p>
        </div>
        <div className="flex flex-col gap-3">
          <Cta />
          <Assurances />
        </div>
      </div>

      {/*
        The sill itself: the products list, at its real proportions, cropped by
        the bottom edge so it reads as the top of something rather than as a
        complete list of three.
      */}
      <div className="border-line-2 bg-surface-3 border-t">
        <ul className="flex flex-col px-4">
          {SILL.map((row, index) => (
            <li
              key={row.name}
              className={cn(
                "flex items-center gap-4 px-4 py-4 max-sm:flex-wrap max-sm:gap-y-2.5",
                index > 0 && "border-line-2 border-t",
                index === SILL.length - 1 && "opacity-45",
              )}
            >
              {/*
                Mark and name are one flex item, so a phone wraps where the
                products page wraps: they take the first line together and the
                state and signal go under them. Without it the pill — which
                never shrinks — truncated "Payflow" to "P…", which is the one
                thing on the row anybody is reading.
              */}
              <span className="flex min-w-0 flex-1 items-center gap-4 max-sm:basis-full">
                <span
                  aria-hidden
                  className="border-line-strong bg-surface-hover text-fg-body flex size-9 shrink-0 items-center justify-center rounded-nav border text-caption font-bold"
                >
                  {row.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="text-fg min-w-0 flex-1 truncate text-ui font-semibold">
                  {row.name}
                </span>
              </span>
              <StatusPill tone={row.tone} className="shrink-0">
                {row.state}
              </StatusPill>
              <span className="text-fg-body w-14 shrink-0 text-right font-mono text-ui">
                {row.signal}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const RENDER: Record<string, () => React.JSX.Element> = {
  "1": HeroConsole,
  "2": HeroSplit,
  "3": HeroDeck,
  "4": HeroSill,
};

export function StudyHeroShape({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Landing · dritter Durchgang</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">Vier Karten, vier Aufbauten</h1>
        <p className="text-fg-prose mt-3 max-w-[70ch] text-lead">
          Gezeichnet in {study.name}. Der letzte Durchgang hat <b className="text-fg">eine</b> Karte
          gebaut und vier Tapeten dahinter gehängt — und das im Kommentar auch noch als Methode
          verkauft. Das ist eine Methode, um einen Hintergrund zu wählen, und keine, um eine Karte
          zu entwerfen. Hier ist es umgekehrt:{" "}
          <b className="text-fg">der Grund ist überall gleich</b>, und jede Karte ist ein anderes
          Ding.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Was gleich bleibt, damit der Vergleich einer ist</p>
        <p className="text-fg-muted mt-3 max-w-[70ch] text-caption">
          Die Worte: dieselbe Positionierung, derselbe Satz darunter, derselbe eine Knopf, dieselben
          zwei Zusagen. Und in keiner der vier steht eine erfundene Zahl, Bewertung oder Kundenzahl
          — der Landing-Contract verbietet sie namentlich, und genau daraus bestehen die
          „Wow“-Helden aus den Katalogen.
        </p>
      </div>

      {TREATMENTS.map((treatment) => (
        <section key={treatment.key} className="border-line-3 mt-10 border-t pt-8">
          <h2 className="text-fg text-title font-semibold">{treatment.name}</h2>
          <p className="text-fg-prose mt-3 max-w-[70ch] text-caption">{treatment.claim}</p>
          <p className="text-fg-muted mt-2 max-w-[70ch] text-caption">{treatment.argument}</p>
          <div className="relative isolate mt-6 overflow-hidden rounded-card px-8 py-16 max-sm:px-3 max-sm:py-10">
            <div
              aria-hidden
              className="study-hero-field pointer-events-none absolute inset-0 -z-10"
            />
            {RENDER[treatment.key]!()}
          </div>
        </section>
      ))}
    </div>
  );
}
