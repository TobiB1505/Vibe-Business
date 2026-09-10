import { ArrowRightIcon, DeleteIcon, PlusIcon } from "@/components/ui/icons.generated";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * Which button, and how many of it (UI-26).
 *
 * ## What is actually there today, counted
 *
 * `<Button>` renders 94 times. The variant asked for:
 *
 *   primary     63   (17 explicit, 46 by default)
 *   secondary   28
 *   accent       3
 *   danger       0
 *
 * `danger` has never once been used — while the product does have destructive
 * actions, and every one of them is an `InlineAction` with a `danger` tone
 * instead. So the destructive *button* is dead code and the destructive
 * *action* is alive, which is one vocabulary pretending to be two.
 *
 * Beside `Button` there are three more families: `InlineAction` (18 files),
 * `IconButton` (2), and `buttonClasses()` pasted onto a `Link` or a raw
 * `button` (28 files). Four ways to make something pressable.
 *
 * Sizes: `sm` is asked for 33 times, `md` 4, `lg` 2, and the default (`md`)
 * carries the rest. So the scale is really "small, and the marketing one".
 *
 * ## What each treatment below is answering
 *
 * Not "which looks nicest". Every system is drawn against the same six jobs
 * the product actually has, because a variant set is only right or wrong
 * relative to the jobs — and the jobs are why `danger` is empty and `sm`
 * dominates.
 *
 * Nothing here changes a component. These are rendered treatments.
 */

type Job = {
  key: string;
  label: string;
  note: string;
};

/** The six things a pressable thing is asked to do in this product. */
const JOBS: readonly Job[] = [
  { key: "primary", label: "Save", note: "Die eine Sache, die der Screen will" },
  { key: "secondary", label: "Manage plan", note: "Daneben, gleichrangig" },
  { key: "quiet", label: "Change", note: "In einer Zeile, kein Möbel" },
  { key: "danger", label: "Delete project", note: "Zerstörend, in der Danger Zone" },
  { key: "link", label: "Credits and billing", note: "Führt woanders hin" },
  { key: "icon", label: "+", note: "Nur ein Zeichen, z. B. Credits aufladen" },
];

/* ── The four systems ───────────────────────────────────────────────── */

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-nav transition-interactive " +
  "focus-visible:ring-mint/30 focus-visible:ring-4 focus-visible:outline-none";
const PAD = "px-4 py-2.5 text-ui";

type System = {
  key: string;
  name: string;
  claim: string;
  cost: string;
  /** One class list per job, in the order of `JOBS`. */
  render: Record<string, string>;
};

const SOLID = "bg-mint text-mint-ink font-bold shadow-mint hover:bg-mint-hover";
const OUTLINE = "bg-surface-hover text-fg-body border border-line-strong hover:bg-white/10";
const QUIET_TEXT = "text-fg-secondary hover:text-fg gap-1.5 px-1 py-1";
const CORAL_OUTLINE = "bg-coral-tint text-coral border border-coral-line hover:bg-coral-tint/70";

const SYSTEMS: readonly System[] = [
  {
    key: "two",
    name: "A · Zwei Varianten",
    claim:
      "Genau das, was der Code schon tut: 91 von 94 Buttons sind primary oder secondary. accent und danger fallen weg, Zerstörendes bleibt eine Inline-Aktion wie heute.",
    cost: "Die Danger Zone bekommt keinen Button, sondern behält ihre Textaktion — laut genug? Das ist die Frage, die A offen lässt.",
    render: {
      primary: cn(BASE, PAD, SOLID),
      secondary: cn(BASE, PAD, OUTLINE),
      quiet: cn(BASE, QUIET_TEXT, "text-ui underline underline-offset-4"),
      danger: cn(BASE, QUIET_TEXT, "text-coral text-ui underline underline-offset-4"),
      link: cn(BASE, QUIET_TEXT, "text-mint text-ui"),
      icon: cn(BASE, "size-9 rounded-full", OUTLINE),
    },
  },
  {
    key: "three",
    name: "B · Drei, mit echtem Danger",
    claim:
      "Wie A, aber Zerstörendes wird ein Button statt einer Textaktion. Die Danger Zone bekommt damit dieselbe Form wie jeder andere Screen — nur in Koralle.",
    cost: "Ein gefüllter Delete-Button ist lauter als heute. In einer markierten Zone ist das vertretbar; auf einer Karte wäre es zu viel.",
    render: {
      primary: cn(BASE, PAD, SOLID),
      secondary: cn(BASE, PAD, OUTLINE),
      quiet: cn(BASE, QUIET_TEXT, "text-ui underline underline-offset-4"),
      danger: cn(BASE, PAD, CORAL_OUTLINE),
      link: cn(BASE, QUIET_TEXT, "text-mint text-ui"),
      icon: cn(BASE, "size-9 rounded-full", OUTLINE),
    },
  },
  {
    key: "ghost",
    name: "C · Ein Button, vier Varianten",
    claim:
      "InlineAction verschwindet und wird die Variante ghost. Danach gibt es genau eine Komponente für alles Drückbare: solid · outline · ghost · danger, plus icon-only als Größe.",
    cost: "Die größte Umstellung — 18 Dateien wandern von InlineAction auf Button. Dafür gibt es danach nur noch ein Vokabular statt vier.",
    render: {
      primary: cn(BASE, PAD, SOLID),
      secondary: cn(BASE, PAD, OUTLINE),
      quiet: cn(
        BASE,
        "px-2.5 py-1.5 text-ui text-fg-secondary hover:bg-surface-hover hover:text-fg",
      ),
      danger: cn(BASE, "px-2.5 py-1.5 text-ui text-coral hover:bg-coral-tint-soft"),
      link: cn(BASE, "px-2.5 py-1.5 text-ui text-mint hover:bg-mint-tint-soft"),
      icon: cn(BASE, "size-9 rounded-full text-fg-secondary hover:bg-surface-hover hover:text-fg"),
    },
  },
  {
    key: "axes",
    name: "D · Zwei Achsen statt Namen",
    claim:
      "Kein Variantenname mehr, sondern tone (neutral · mint · coral) × emphasis (solid · outline · quiet). Jede Kombination ist beschreibbar, statt auf eine Liste zu warten.",
    cost: "Neun Kombinationen, von denen der Code vier braucht. Ein System, das mehr kann, als das Produkt je benutzt — und jede ungenutzte Kombination ist eine Einladung.",
    render: {
      primary: cn(BASE, PAD, SOLID),
      secondary: cn(BASE, PAD, OUTLINE),
      quiet: cn(
        BASE,
        "px-2.5 py-1.5 text-ui text-fg-secondary hover:bg-surface-hover hover:text-fg",
      ),
      danger: cn(BASE, PAD, "bg-coral text-mint-ink font-bold hover:bg-coral/90"),
      link: cn(BASE, "px-2.5 py-1.5 text-ui text-mint hover:bg-mint-tint-soft"),
      icon: cn(BASE, "size-9 rounded-full", OUTLINE),
    },
  },
];

function JobCell({ job, className }: { job: Job; className: string }) {
  const icon =
    job.key === "icon" ? (
      <PlusIcon size={16} />
    ) : job.key === "danger" ? (
      <DeleteIcon size={14} />
    ) : job.key === "link" ? null : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-fg-meta text-meta">{job.note}</span>
      <div>
        <button type="button" className={className}>
          {icon}
          {job.key === "icon" ? <span className="sr-only">Credits aufladen</span> : job.label}
          {job.key === "link" && <ArrowRightIcon size={14} />}
        </button>
      </div>
    </div>
  );
}

function SystemBlock({ system }: { system: System }) {
  return (
    <section className="border-line-3 mt-10 border-t pt-8">
      <h2 className="text-fg text-title font-semibold">{system.name}</h2>
      <p className="text-fg-prose mt-3 max-w-[66ch] text-caption">{system.claim}</p>
      <p className="text-fg-muted mt-2 max-w-[66ch] text-caption">
        <b className="text-fg-secondary">Kosten:</b> {system.cost}
      </p>

      <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-3">
        {JOBS.map((job) => (
          <JobCell key={job.key} job={job} className={system.render[job.key]!} />
        ))}
      </div>
    </section>
  );
}

export function StudyButton({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Ein Button</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Vier Systeme, gegen die sechs Jobs, die es wirklich gibt
        </h1>
        <p className="text-fg-prose mt-3 max-w-[66ch] text-lead">
          Rendered in {study.name}. Nicht &bdquo;welcher sieht besser aus&ldquo; — jedes System ist
          gegen dieselben sechs Aufgaben gezeichnet, weil ein Variantensatz nur relativ zu den
          Aufgaben richtig oder falsch ist.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Der Befund</p>
        <h2 className="text-fg mt-3 text-title font-semibold">
          Vier Familien, und eine Variante, die nie jemand benutzt hat
        </h2>
        <p className="text-fg-prose mt-3 max-w-[66ch] text-caption">
          <code className="text-fg-secondary font-mono text-ui">Button</code> rendert 94-mal:{" "}
          <b className="text-fg">63 primary</b>, <b className="text-fg">28 secondary</b>,{" "}
          <b className="text-fg">3 accent</b> und <b className="text-fg">0 danger</b>. Die
          Danger-Variante ist toter Code — obwohl es zerstörende Aktionen gibt. Die benutzen alle{" "}
          <code className="text-fg-secondary font-mono text-ui">InlineAction</code> mit{" "}
          <code className="text-fg-secondary font-mono text-ui">tone=&quot;danger&quot;</code>.
        </p>
        <p className="text-fg-prose mt-3 max-w-[66ch] text-caption">
          Daneben: <code className="text-fg-secondary font-mono text-ui">InlineAction</code> in 18
          Dateien, <code className="text-fg-secondary font-mono text-ui">IconButton</code> in 2, und{" "}
          <code className="text-fg-secondary font-mono text-ui">buttonClasses()</code> auf einen{" "}
          <code className="text-fg-secondary font-mono text-ui">Link</code> geklebt in 28. Vier
          Wege, etwas drückbar zu machen.
        </p>
        <p className="text-fg-prose mt-3 max-w-[66ch] text-caption">
          Größen: <b className="text-fg">sm 33-mal</b>, md 4, lg 2, Rest Default. Die Skala ist in
          Wahrheit &bdquo;klein, und der eine fürs Marketing&ldquo;.
        </p>
      </div>

      {SYSTEMS.map((system) => (
        <SystemBlock key={system.key} system={system} />
      ))}
    </div>
  );
}
