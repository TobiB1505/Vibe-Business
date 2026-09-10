import { GithubMark } from "@/components/brand/provider-marks";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { LockIcon } from "@/components/ui/dashboard-icons";
import { inputClassName } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * What shape is a page that holds two facts? (UI-32)
 *
 * ## What the audit found
 *
 * Measured at 1280 and at 390, in v2, on `profile-named` and
 * `profile-no-github`.
 *
 * **Two mint primaries on one page, and the loud one is the small one.**
 * `Save` on the name field and `Connect GitHub` are both `variant="primary"`,
 * so the page spends its emphasis twice — and the field that changes what Nova
 * calls you outranks the connection the whole product runs on. `DESIGN.md`
 * allows one primary per view.
 *
 * **Four objects, four different densities, for two facts.** A 138px card
 * holding a name and an address, a 248px card holding one input, a 153px panel
 * holding one row, a 183px section holding three bullets. The page is 1001px
 * tall and every object is a different *kind* of object.
 *
 * **The section labels are inconsistent about where they live.** `YOUR NAME`
 * and `CONNECTIONS` sit above their surfaces; `WHAT VIBE DOES NOT KEEP` sits
 * inside its own. Same component, same level, two placements.
 *
 * **The name form is three lines of chrome around one input.** Label, field,
 * hint, button — 248px for a field a founder touches once.
 *
 * **A bullet list drawn by hand.** `bg-fg-faint mt-2 size-1 rounded-full` is a
 * marker nothing else in the product draws, in the one panel whose subject is
 * that Vibe keeps nothing.
 *
 * **The identity card is the emptiest object and the largest.** Without a
 * GitHub connection it is a 72px circle reading `FO` beside
 * `founder@example.com` — 138px of card for one string, and the circle says a
 * word fragment rather than a person's initials.
 *
 * ## What the registries had
 *
 * ReUI returns nothing free for a profile or settings shape — thirteen
 * premium blocks and no free match, the same answer it gave for buttons.
 * 21st.dev had two worth reading: an **Account Settings Fieldset**, which is
 * the form on the ground with no card at all and one save at the foot (the
 * shape behind D), and a **Glass Account Settings Card**, one large pane with
 * smaller cards nested inside it (the shape behind A, minus the nesting).
 * Neither is installed: both are compositions, and a composition is the thing
 * this study is choosing rather than a component to fetch.
 *
 * ## What every treatment fixes, so the choice is about shape
 *
 * One primary, and it is the connection. One placement for the section label.
 * No hand-drawn bullet. And the identity is never a card whose only content is
 * the thing the page header already says.
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
    name: "A · Eine Karte",
    claim: "Die ganze Seite ist ein Objekt. Innen: eine Person, dann Zeilen mit Haarlinien.",
    argument:
      "Vibe speichert zwei Dinge über einen Menschen. Vier Kästen für zwei Fakten ist der Befund — also gibt es einen Kasten. Die Person ist die Kopfzeile, Name und GitHub sind zwei Zeilen darunter, und was Vibe nicht behält steht als Fußzeile derselben Karte. Nichts ist verschachtelt.",
  },
  {
    key: "b",
    name: "B · Der Name ist die Seite",
    claim: "Das Einzige, was man hier ändern kann, führt — in voller Größe, direkt editierbar.",
    argument:
      "Die Frage dieser Seite lautet: Wie soll Nova dich nennen? Also ist das Feld die Überschrift, nicht ein Formular unter einer Überschrift. Alles andere wird leise: GitHub eine Zeile, das Nicht-Gespeicherte ein Satz statt eines Panels mit Aufzählung.",
  },
  {
    key: "c",
    name: "C · Zwei Spalten",
    claim: "Links wer du bist, rechts woher Vibe das weiß.",
    argument:
      "Die Seite beantwortet zwei Fragen, und heute stehen sie abwechselnd untereinander. Getrennt gelesen: links die Identität und ihr einziges Feld, rechts die Quellen — GitHub, die Adresse, und die Liste dessen, was Vibe nicht führt. Die zweite Spalte ist durchgehend leise.",
  },
  {
    key: "d",
    name: "D · Nur Zeilen",
    claim: "Keine Karte. Eine Liste auf dem Grund, wie eine Systemeinstellung.",
    argument:
      "Einstellungen sind eine Liste. Die heutige Seite verkleidet vier Listenzeilen als vier verschiedene Objekte. Hier trägt der Seitenkopf das Bild und den Namen, und darunter stehen vier Zeilen mit Haarlinien dazwischen — Label links, Wert rechts, Aktion rechts.",
  },
];

/** One person, as every treatment resolves them. */
const PERSON = {
  name: "Tobi",
  initials: "TO",
  email: "founder@example.com",
  github: "ada-lovelace",
} as const;

/** The three claims, without the hand-drawn marker. */
const NOT_KEPT = [
  "Nichts über dich außer dem Namen, den du gegeben hast — kein Titel, keine Firma, keine Bio",
  "Kein eigenes Bild — das oben liefert GitHub",
  "Keine Präferenzen, keine Einstellungen, kein Analytics-Profil",
] as const;

/**
 * The field, drawn from the shipped well.
 *
 * `inputClassName` rather than `Input`, because a study is a picture and the
 * real one is a client component with an action behind it. The surface is the
 * same string the product uses, so what is compared here is the composition
 * and not a redrawn field.
 */
function NameField({ id, className }: { id: string; className?: string }) {
  return (
    <input id={id} readOnly defaultValue={PERSON.name} className={cn(inputClassName, className)} />
  );
}

/** GitHub, as the one connection this product has. */
function GithubLine({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="bg-surface-3 text-fg-secondary flex size-9 shrink-0 items-center justify-center rounded-nav"
      >
        <GithubMark size={18} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-fg text-ui font-semibold">GitHub</span>
          <StatusPill tone="success">Verbunden</StatusPill>
        </span>
        {!compact && (
          <span className="text-fg-muted text-caption">
            Angemeldet als <span className="text-fg-body font-mono">{PERSON.github}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A · one card, hairlines inside it.
 *
 * The person is the card's own header rather than a card of its own, so the
 * page has one object at level 3 and nothing else competing with it.
 */
function TreatmentA() {
  return (
    <Surface level="card" padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 px-6 py-5">
        <Avatar src={null} initials={PERSON.initials} label={PERSON.name} size={52} />
        <div className="flex min-w-0 flex-col">
          <p className="text-fg text-title font-bold tracking-[-0.025em]">{PERSON.name}</p>
          <p className="text-fg-muted truncate text-body">{PERSON.email}</p>
        </div>
      </div>

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t px-6 py-5">
        <label htmlFor="a-name" className="flex min-w-0 flex-col gap-1">
          <span className="text-fg text-ui font-semibold">Wie soll Nova dich nennen?</span>
          <span className="text-fg-muted text-caption">
            Leer lassen, und Vibe nimmt deinen GitHub-Login.
          </span>
        </label>
        <div className="flex items-center gap-2">
          <NameField id="a-name" className="w-52" />
          <span className={buttonClasses({ variant: "secondary" })}>Speichern</span>
        </div>
      </div>

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t px-6 py-5">
        <GithubLine />
        <span className={buttonClasses({ variant: "ghost" })}>Verwalten</span>
      </div>

      <div className="border-line-2 bg-surface-2 flex flex-col gap-2 border-t px-6 py-5">
        <span className="text-fg-meta flex items-center gap-2">
          <LockIcon size={14} />
          <MonoLabel as="span">Was Vibe nicht behält</MonoLabel>
        </span>
        <p className="text-fg-prose max-w-[70ch] text-caption leading-relaxed">
          {NOT_KEPT.join(" · ")}
        </p>
      </div>
    </Surface>
  );
}

/**
 * B · the field is the heading.
 *
 * One primary object, and it is the only thing on the page a founder can
 * change. Everything else drops a level rather than getting its own card.
 */
function TreatmentB() {
  return (
    <div className="flex flex-col gap-7">
      <Surface level="card" padding="lg" className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar src={null} initials={PERSON.initials} label={PERSON.name} size={44} />
          <div className="flex min-w-0 flex-col">
            <MonoLabel as="span" className="text-fg-meta">
              Wie Nova dich nennt
            </MonoLabel>
            <p className="text-fg-muted truncate text-caption">{PERSON.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <NameField
            id="b-name"
            className="min-w-0 flex-1 text-moment font-bold tracking-[-0.03em] max-sm:w-full"
          />
          <span className={buttonClasses({ variant: "secondary" })}>Speichern</span>
        </div>

        <p className="text-fg-muted max-w-[62ch] text-caption">
          Wird benutzt, wenn Vibe dir schreibt. Leer lassen, und Vibe nimmt deinen GitHub-Login oder
          deine E-Mail-Adresse.
        </p>
      </Surface>

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <GithubLine />
        <span className={buttonClasses({ variant: "ghost" })}>Verwalten</span>
      </div>

      <p className="text-fg-muted max-w-[74ch] text-caption leading-relaxed">
        <LockIcon size={13} className="mr-1.5 inline-block align-[-1px]" />
        Sonst nichts: kein Titel, keine Firma, keine Bio, kein eigenes Bild, keine Präferenzen und
        kein Analytics-Profil.
      </p>
    </div>
  );
}

/**
 * C · identity on the left, its sources on the right.
 *
 * The page answers two questions and today they alternate down one column.
 * The right column is quiet throughout — nothing there is a control.
 */
function TreatmentC() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <Surface level="card" padding="lg" className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar src={null} initials={PERSON.initials} label={PERSON.name} size={56} />
          <div className="flex min-w-0 flex-col">
            <p className="text-fg text-title font-bold tracking-[-0.025em]">{PERSON.name}</p>
            <p className="text-fg-muted truncate text-caption">{PERSON.email}</p>
          </div>
        </div>

        <label htmlFor="c-name" className="flex flex-col gap-2">
          <span className="text-fg-secondary text-ui">Wie soll Nova dich nennen?</span>
          <NameField id="c-name" />
          <span className="text-fg-muted text-caption">
            Leer lassen, und Vibe nimmt deinen GitHub-Login.
          </span>
        </label>

        <span className={cn(buttonClasses({ variant: "secondary" }), "w-fit")}>Speichern</span>
      </Surface>

      <div className="flex flex-col gap-4">
        <Surface level="panel" padding="md" className="flex items-center justify-between gap-4">
          <GithubLine />
          <span className={buttonClasses({ variant: "ghost" })}>Verwalten</span>
        </Surface>

        <Surface level="panel" padding="md" className="flex flex-col gap-3">
          <span className="text-fg-meta flex items-center gap-2">
            <LockIcon size={14} />
            <MonoLabel as="span">Was Vibe nicht behält</MonoLabel>
          </span>
          <ul className="flex flex-col gap-2">
            {NOT_KEPT.map((line) => (
              <li key={line} className="text-fg-prose text-caption leading-relaxed">
                {line}
              </li>
            ))}
          </ul>
        </Surface>
      </div>
    </div>
  );
}

/**
 * D · no card at all.
 *
 * The header carries the person, and what follows is four rows on the ground
 * with a hairline between them — label left, value and action right.
 */
function TreatmentD() {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-4 pb-6">
        <Avatar src={null} initials={PERSON.initials} label={PERSON.name} size={56} />
        <div className="flex min-w-0 flex-col">
          <p className="text-fg text-moment font-bold tracking-[-0.03em]">{PERSON.name}</p>
          <p className="text-fg-muted truncate text-body">{PERSON.email}</p>
        </div>
      </div>

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t py-5">
        <label htmlFor="d-name" className="flex min-w-0 flex-col gap-1">
          <span className="text-fg text-ui font-semibold">Name</span>
          <span className="text-fg-muted text-caption">Wie Nova dich anspricht.</span>
        </label>
        <div className="flex items-center gap-2">
          <NameField id="d-name" className="w-52" />
          <span className={buttonClasses({ variant: "secondary" })}>Speichern</span>
        </div>
      </div>

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t py-5">
        <GithubLine compact />
        <span className="flex items-center gap-3">
          <span className="text-fg-muted font-mono text-caption">{PERSON.github}</span>
          <span className={buttonClasses({ variant: "ghost" })}>Verwalten</span>
        </span>
      </div>

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t py-5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-fg text-ui font-semibold">E-Mail</span>
          <span className="text-fg-muted text-caption">Womit du dich anmeldest.</span>
        </div>
        <span className="text-fg-body truncate text-body">{PERSON.email}</span>
      </div>

      <div className="border-line-2 flex flex-col gap-2 border-t py-5">
        <span className="text-fg-meta flex items-center gap-2">
          <LockIcon size={14} />
          <MonoLabel as="span">Was Vibe nicht behält</MonoLabel>
        </span>
        <p className="text-fg-prose max-w-[74ch] text-caption leading-relaxed">
          {NOT_KEPT.join(" · ")}
        </p>
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

export function StudyProfile({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Profile</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Welche Form hat eine Seite, die zwei Fakten hält?
        </h1>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-lead">
          Gezeichnet in {study.name}. Vibe speichert über einen Menschen genau zwei Dinge: die
          Adresse, mit der er sich angemeldet hat, und den Namen, den er selbst gegeben hat. Heute
          stehen dafür vier verschieden dichte Objekte auf 1001px Höhe.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Was das Audit gefunden hat</p>
        <h2 className="text-fg mt-3 text-title font-semibold">Sechs Befunde, in v2 gemessen</h2>
        <ul className="text-fg-prose mt-4 flex max-w-[68ch] flex-col gap-2 text-caption">
          <li>
            <b className="text-coral">Major</b> · Zwei Mint-Primaries auf einer Seite —{" "}
            <b className="text-fg">Save</b> am Namensfeld und{" "}
            <b className="text-fg">Connect GitHub</b>. Die Betonung wird zweimal ausgegeben, und das
            kleinere Feld gewinnt.
          </li>
          <li>
            <b className="text-fg">Major</b> · Vier Objekte in vier Dichten für zwei Fakten: 138px
            Karte, 248px Karte, 153px Panel, 183px Section.
          </li>
          <li>
            <b className="text-fg">Minor</b> · <code className="font-mono text-ui">MonoLabel</code>{" "}
            steht zweimal über seiner Fläche und einmal darin.
          </li>
          <li>
            <b className="text-fg">Minor</b> · 248px Karte für ein einziges Eingabefeld: Label,
            Feld, Hinweis, Button.
          </li>
          <li>
            <b className="text-fg">Minor</b> · Der Aufzählungspunkt ist von Hand gezeichnet —
            ausgerechnet in dem Panel, dessen Thema ist, dass Vibe nichts behält.
          </li>
          <li>
            <b className="text-fg">Minor</b> · Ohne GitHub ist die Identitätskarte 138px für eine
            E-Mail-Adresse, und der Kreis sagt <b className="text-fg">FO</b>.
          </li>
        </ul>
        <p className="text-fg-muted mt-4 max-w-[68ch] text-caption">
          Alle vier lösen den ersten Befund gleich: ein Primary, und es ist nicht das Namensfeld.
          Ein Platz für das Label, kein handgezeichneter Punkt. Was sich unterscheidet, ist die
          Form.
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
