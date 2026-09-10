"use client";

import { useEffect, useState } from "react";
import { GithubMark } from "@/components/brand/provider-marks";
import { NovaPresence } from "@/components/nova/nova-presence";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { ArrowRightIcon, LockIcon } from "@/components/ui/dashboard-icons";
import { buttonClasses } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * What does the front door show, when the honest answer is "nothing yet"? (UI-34)
 *
 * ## The finding this study exists for
 *
 * The hero's showpiece is an empty state. Nine circles reading **Not assessed**
 * around a centre reading **—**, under the line **Scored 0 of 9 areas**. Every
 * word of it is true and required — `landing-contract.test.ts` bans an invented
 * score, and it is right to — but the page's single largest visual moment tells
 * a stranger that nothing has been assessed, nine times, in the first 1,965
 * pixels.
 *
 * That is the whole problem, and it is not a styling problem. A landing page
 * whose showcase is a blank form of its own product is asking to be believed on
 * the strength of a description.
 *
 * ## What else the audit measured
 *
 * **7,844px at 1440 and 10,985px at 390** — twenty-eight phone screens for
 * nine sections. **Two mint controls above the fold**: `Get started` in the
 * nav and the hero's own call to action, so the accent is spent twice before a
 * stranger has read a sentence. And the second design system **does not reach
 * the front door**: `/` is prerendered, so `data-vibe` is baked at build time
 * and the page a visitor sees is whatever palette the deployment was built
 * with, whatever `VIBE_PALETTE` says at run time. Measured, not assumed:
 * `/e2e/*` answered `v2` from the same server that served this page as `v1`.
 *
 * ## What the registries had, and why most of it is unusable here
 *
 * This is the one surface where `DESIGN.md` licenses the signature registries,
 * so the search was real. It came back with a consistent answer and Vibe cannot
 * take it: **the catalogue's version of a "wow" hero is invented credibility.**
 * 21st.dev's best-structured result pairs a live product preview with `4.9 ease
 * of use`, `4.8 support` and `loved by 30,000+ teams`; the next one offers
 * developer counts and an uptime figure. Every one of those is a number Vibe
 * would be making up, and the landing contract bans them by name.
 *
 * What *is* worth taking is the structure underneath: an asymmetric split with
 * the headline on one side and a real preview on the other, and a rail that
 * switches what the preview shows. That is treatment D, with the ratings
 * removed rather than restyled.
 *
 * So Vibe's "wow" has to come from the mechanism — showing the thing working —
 * rather than from borrowed trust. Each treatment below is a different answer
 * to *what can we show that is both impressive and true*.
 */

type Treatment = {
  key: string;
  name: string;
  claim: string;
  argument: string;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "a",
    name: "A · Nova spricht zuerst",
    claim: "Kein Diagramm. Die Mitfründerin, in voller Größe, und ein Satz von ihr.",
    argument:
      "Das eine, was kein Katalog hat, ist Nova: eine eigene Marke mit vier beobachteten Zuständen. Sie behauptet keine Zahl, also kann sie auch keine leere zeigen. Die Seite führt mit dem, was ein Gründer bekommt — jemanden, der mitdenkt — und der Beweis kommt weiter unten, wo Platz dafür ist.",
  },
  {
    key: "b",
    name: "B · Der Vorgang, nicht das Ergebnis",
    claim: "Statt neun leerer Kreise: die Analyse, während sie läuft.",
    argument:
      "Die neun Bereiche sind richtig — leer sind sie nur, weil noch kein Produkt verbunden ist. Also zeigt der Held nicht den Endstand, sondern den Weg dahin: Evidenz trifft ein, ein Bereich nach dem anderen löst sich auf. Es behauptet keinen Wert, es zeigt eine Fähigkeit. Bewegung mit allen drei Pflichten: reduzierte Bewegung, Pause im Hintergrund, reservierte Geometrie.",
  },
  {
    key: "c",
    name: "C · Vibe über Vibe",
    claim: "Ein echtes Ergebnis — von dem einen Produkt, über das Vibe sprechen darf.",
    argument:
      "Es gibt genau ein Produkt, dessen Zahlen Vibe zeigen darf, ohne jemanden zu erfinden: sich selbst. Ein echter Befund aus dem eigenen Audit, als solcher beschriftet. Das ist der einzige Weg zu einem gefüllten Zustand auf dieser Seite, der keine Erfindung ist — und er kostet: die Zahlen müssen echt sein und gepflegt werden.",
  },
  {
    key: "d",
    name: "D · Split mit Wechsel-Leiste",
    claim: "Struktur von 21st.dev, ohne die erfundenen Bewertungen.",
    argument:
      "Links die Schlagzeile, rechts eine Vorschau, und eine Leiste, die zwischen den vier echten Schritten umschaltet — Scan, Audit, Move, Agent. Der Katalog liefert genau diese Anordnung und packt Sternebewertungen daneben; hier bleibt die Anordnung und die erfundene Glaubwürdigkeit fällt weg.",
  },
];

const HEADLINE = "You built the product. Now build ";
const SUB =
  "Vibe Business understands what you built, finds what is holding the business back, prioritizes what to do next, and helps you execute it with AI.";

/** The two the product already promises, and nothing else. */
function Assurances() {
  return (
    <div className="text-fg-meta flex flex-wrap items-center gap-x-6 gap-y-2 text-caption">
      <span className="flex items-center gap-2">
        <LockIcon size={14} />
        Your approval before merge
      </span>
      <span className="flex items-center gap-2">
        <LockIcon size={14} />
        No stored copy of your code
      </span>
    </div>
  );
}

function Cta({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <MarketingCta href="/signup" assurance={compact ? undefined : "No credit card to start"}>
        <GithubMark size={18} />
        Start with your GitHub repo
        <ArrowRightIcon size={16} />
      </MarketingCta>
      <span className={buttonClasses({ variant: "secondary", size: "marketing" })}>
        See how it works
      </span>
    </div>
  );
}

/**
 * A · Nova leads.
 *
 * The mark at `hero` size is 132px and is the product's own asset. `still`
 * because a study is a picture; production would let her introduce once.
 */
function TreatmentA() {
  return (
    <div className="flex flex-col items-center gap-8 py-14 text-center">
      <NovaPresence state="idle" seed="vibe-landing" size="hero" still />

      <div className="flex flex-col items-center gap-5">
        <MonoLabel as="p" className="text-fg-meta">
          Nova · deine KI-Mitgründerin
        </MonoLabel>
        <h2 className="text-fg max-w-[18ch] text-hero font-bold tracking-[-0.04em]">
          {HEADLINE}
          <span className="text-mint">the business.</span>
        </h2>
        <p className="text-fg-prose max-w-[58ch] text-lead">{SUB}</p>
      </div>

      <Cta />
      <Assurances />
    </div>
  );
}

/** The nine areas, as the audit names them — resolving rather than empty. */
const AREAS = [
  "Offer",
  "Audience",
  "Acquisition",
  "Conversion",
  "Retention",
  "Revenue",
  "Measurement",
  "Scalability",
  "Readiness",
] as const;

/**
 * B · the analysis, running.
 *
 * ## Why this is not a fabricated result
 *
 * Nothing here states a score. What moves is *which area Vibe is reading*, and
 * the line under it says what that is. A stranger sees the capability without
 * being told an outcome — which is the distinction `DESIGN.md` draws between
 * ambience and a false state.
 *
 * ## The three obligations
 *
 * The cycle stops under `prefers-reduced-motion` and while the tab is hidden,
 * and every row holds its box whether or not it is the active one, so nothing
 * reflows as the sequence advances.
 */
function TreatmentB() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      timer ??= setInterval(() => setActive((index) => (index + 1) % AREAS.length), 900);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="grid items-center gap-12 py-14 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex flex-col gap-6">
        <h2 className="text-fg max-w-[16ch] text-hero font-bold tracking-[-0.04em]">
          {HEADLINE}
          <span className="text-mint">the business.</span>
        </h2>
        <p className="text-fg-prose max-w-[54ch] text-lead">{SUB}</p>
        <Cta />
        <Assurances />
      </div>

      <Surface level="card" padding="lg" className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <NovaPresence state="working" seed="vibe-landing" size="md" still />
          <span className="text-fg-secondary text-ui font-semibold">
            Vibe liest {AREAS[active]}
          </span>
        </div>

        <ul className="flex flex-col">
          {AREAS.map((area, index) => (
            <li
              key={area}
              className={cn(
                "flex items-center justify-between gap-4 py-2 transition-interactive",
                index > 0 && "border-line-2 border-t",
              )}
            >
              <span
                className={cn(
                  "text-caption transition-interactive",
                  index < active ? "text-fg-body" : index === active ? "text-mint" : "text-fg-meta",
                )}
              >
                {area}
              </span>
              {/*
                A fixed-width slot, so a row is the same height and the same
                width whether it holds a word or nothing. The sequence advances
                without anything on the page moving.
              */}
              <span className="w-24 shrink-0 text-right text-caption">
                {index < active ? (
                  <span className="text-fg-meta">gelesen</span>
                ) : index === active ? (
                  <span className="text-mint">liest…</span>
                ) : (
                  <span className="text-fg-faint">—</span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-fg-meta text-caption">
          Vorschau. Werte erscheinen erst, wenn Vibe Evidenz aus deinem Produkt hat.
        </p>
      </Surface>
    </div>
  );
}

/**
 * C · a real result, from the one product Vibe may speak for.
 *
 * The number and the finding are **placeholders, marked as such on the card
 * itself**, and would have to come from Vibe's own stored audit before this
 * could ship. That is the cost of the treatment and the reason it is drawn
 * rather than argued about — a study that printed an invented 63 under the
 * words "real numbers" would be the exact thing the landing contract exists to
 * stop. Labelled as Vibe's own product on the face of it too, so it can never
 * read as a customer's.
 */
function TreatmentC() {
  return (
    <div className="grid items-center gap-12 py-14 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col gap-6">
        <h2 className="text-fg max-w-[16ch] text-hero font-bold tracking-[-0.04em]">
          {HEADLINE}
          <span className="text-mint">the business.</span>
        </h2>
        <p className="text-fg-prose max-w-[54ch] text-lead">{SUB}</p>
        <Cta />
        <Assurances />
      </div>

      <Surface level="card" padding="lg" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <MonoLabel as="span" className="text-fg-meta">
              Vibe über Vibe
            </MonoLabel>
            <StatusPill tone="neutral">Eigenes Produkt</StatusPill>
          </span>
          <span className="text-fg-meta text-caption">analysiert 8. Sep 2026</span>
        </div>

        {/*
          A placeholder, and it says so on its own face.

          The treatment's whole argument is that this number would be real —
          Vibe's own stored audit, the one product it may speak for. A study
          cannot reach that audit, so what is drawn here is the *shape*, marked
          as a placeholder rather than dressed as a measurement. A study that
          printed an invented 63 under the words "real numbers" would be the
          exact thing the landing contract exists to stop.
        */}
        <div className="flex items-baseline gap-2">
          <span className="text-fg-faint text-display font-bold tabular-nums">00</span>
          <span className="text-fg-meta text-body">/100 Business-Signal</span>
        </div>

        <div className="border-line-2 flex flex-col gap-3 border-t pt-4">
          <MonoLabel as="p" className="text-fg-meta">
            Der oberste Befund
          </MonoLabel>
          <p className="text-fg-meta text-body leading-relaxed">
            Hier stünde der oberste Befund aus Vibes eigenem Audit — ein Satz, den das Produkt
            geschrieben hat, nicht einer, der für diese Seite ausgedacht wurde.
          </p>
          <span className={cn(buttonClasses({ variant: "secondary" }), "w-fit")}>
            Den ganzen Befund lesen
          </span>
        </div>

        <p className="text-fg-meta text-caption">
          <b className="text-amber">Platzhalter.</b> In der ausgelieferten Fassung kämen Zahl und
          Befund aus Vibes eigenem gespeicherten Audit — das ist der Preis dieser Variante: sie
          braucht echte Daten und deren Pflege, sonst ist sie genau die Erfindung, die sie vermeiden
          soll.
        </p>
      </Surface>
    </div>
  );
}

const STEPS = [
  { key: "scan", label: "Scan", line: "Vibe liest Repository und Live-Produkt." },
  { key: "audit", label: "Audit", line: "Neun Geschäftsbereiche, mit Belegen." },
  { key: "move", label: "Move", line: "Ein priorisierter Schritt, kein Bericht." },
  { key: "agent", label: "Agent", line: "Der Schritt wird gebaut — du gibst frei." },
] as const;

/** D · the split with a switching rail, minus the invented ratings. */
function TreatmentD() {
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;

  return (
    <div className="grid items-center gap-12 py-14 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="flex gap-5">
        <ul className="flex shrink-0 flex-col gap-1">
          {STEPS.map((item, index) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setStep(index)}
                aria-current={index === step ? "step" : undefined}
                className={cn(
                  buttonClasses({ variant: index === step ? "secondary" : "ghost" }),
                  "w-full justify-start",
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>

        <Surface level="card" padding="lg" className="flex min-h-56 flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            <NovaPresence state="working" seed="vibe-landing" size="md" still />
            <MonoLabel as="span" className="text-fg-meta">
              {current.label}
            </MonoLabel>
          </div>
          <p className="text-fg-body text-body leading-relaxed">{current.line}</p>
          <p className="text-fg-meta mt-auto text-caption">
            Vorschau. Was hier steht, entsteht aus deinem eigenen Produkt.
          </p>
        </Surface>
      </div>

      <div className="flex flex-col gap-6">
        <h2 className="text-fg max-w-[16ch] text-hero font-bold tracking-[-0.04em]">
          {HEADLINE}
          <span className="text-mint">the business.</span>
        </h2>
        <p className="text-fg-prose max-w-[54ch] text-lead">{SUB}</p>
        <Cta compact />
        <Assurances />
      </div>
    </div>
  );
}

const RENDER: Record<string, () => React.JSX.Element> = {
  a: TreatmentA,
  b: TreatmentB,
  c: TreatmentC,
  d: TreatmentD,
};

export function StudyLanding({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Landing</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Was zeigt die Haustür, wenn die ehrliche Antwort „noch nichts“ ist?
        </h1>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-lead">
          Gezeichnet in {study.name}. Der Held der Seite ist heute ein leerer Zustand: neun Kreise
          mit <b className="text-fg">Not assessed</b>, in der Mitte ein Strich, darunter{" "}
          <b className="text-fg">Scored 0 of 9 areas</b>. Jedes Wort davon ist wahr und vom
          Landing-Contract gefordert — und trotzdem sagt der größte visuelle Moment der Seite einem
          Fremden neunmal, dass nichts bewertet wurde.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Was das Audit gefunden hat</p>
        <h2 className="text-fg mt-3 text-title font-semibold">Vier Befunde, in v2 gemessen</h2>
        <ul className="text-fg-prose mt-4 flex max-w-[70ch] flex-col gap-2 text-caption">
          <li>
            <b className="text-coral">Major</b> · Das Schaustück des Helden ist ein leerer Zustand.
            1.965px für neun Kreise, die „Not assessed“ sagen.
          </li>
          <li>
            <b className="text-coral">Major</b> ·{" "}
            <b className="text-fg">v2 erreicht die Haustür nicht.</b>{" "}
            <code className="font-mono text-ui">/</code> ist vorgerendert, also wird{" "}
            <code className="font-mono text-ui">data-vibe</code> beim Build eingebacken. Derselbe
            Server lieferte <code className="font-mono text-ui">/e2e/*</code> als{" "}
            <b className="text-fg">v2</b> und diese Seite als <b className="text-fg">v1</b>.
          </li>
          <li>
            <b className="text-fg">Minor</b> · Zwei Mint-Controls über der Falz: „Get started“ in
            der Navigation und der Held-CTA.
          </li>
          <li>
            <b className="text-fg">Minor</b> · 7.844px bei 1440,{" "}
            <b className="text-fg">10.985px bei 390</b> — achtundzwanzig Handy-Bildschirme für neun
            Abschnitte.
          </li>
        </ul>
        <p className="text-fg-muted mt-4 max-w-[70ch] text-caption">
          <b className="text-fg">
            Was die Register hatten, und warum das meiste hier unbrauchbar ist
          </b>{" "}
          — die Katalog-Antwort auf „Wow-Held“ ist erfundene Glaubwürdigkeit. Das am besten gebaute
          Ergebnis von 21st.dev stellt neben die Produktvorschau <i>4.9 ease of use</i>,{" "}
          <i>4.8 support</i> und <i>loved by 30,000+ teams</i>; das nächste bietet Entwicklerzahlen
          und eine Uptime. Jede dieser Zahlen müsste Vibe erfinden, und der Landing-Contract
          verbietet sie namentlich. Brauchbar ist die Anordnung darunter — das ist D. Vibes „Wow“
          muss aus dem Mechanismus kommen, nicht aus geliehenem Vertrauen.
        </p>
      </div>

      {TREATMENTS.map((treatment) => (
        <section key={treatment.key} className="border-line-3 mt-10 border-t pt-8">
          <h2 className="text-fg text-title font-semibold">{treatment.name}</h2>
          <p className="text-fg-prose mt-3 max-w-[70ch] text-caption">{treatment.claim}</p>
          <p className="text-fg-muted mt-2 max-w-[70ch] text-caption">{treatment.argument}</p>
          <div className="mt-6">{RENDER[treatment.key]!()}</div>
        </section>
      ))}
    </div>
  );
}
