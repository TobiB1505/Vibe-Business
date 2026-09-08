import { ArrowRightIcon, DeleteIcon, PlusIcon } from "@/components/ui/icons.generated";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * How the button looks (UI-27).
 *
 * ## What this is not
 *
 * Not the system question. `study-button` settled that and it is built: one
 * component, four variants, two sizes. **Nothing below changes any of that** —
 * every treatment answers the same four variants against the same jobs, so
 * whichever wins is a class-list edit inside `VARIANT_CLASSES` and nothing
 * else moves.
 *
 * ## What was looked at first
 *
 * The registries, for the mechanisms rather than the components. ReUI returns
 * nothing free for buttons — its two matches are premium blocks. 21st.dev
 * returns plenty, and four mechanisms are worth having:
 *
 *   **Glow Button** — a gradient fill lit from one corner, a light top edge,
 *   and an outer halo in the fill's own colour. The halo is the part Vibe
 *   already has (`--shadow-mint`); the lit edge is what it does not.
 *
 *   **Gradient Button** — the fill stays *dark* and the colour moves to the
 *   rim. On a dark product this is the opposite trade: the accent stops being
 *   a slab and becomes an edge.
 *
 *   **Anti Metal** — the accent is a *chip inside* the button holding the
 *   mark, and the container is dark. One idea, and it is a signature.
 *
 *   **Subtle Button** — a hairline ring plus an outer glow and a single
 *   coloured dot. Everything quiet except one point of colour.
 *
 * Rejected on sight and worth saying so: rotating conic shimmer borders,
 * animated multi-hue gradients and "nebula" pulses. This product tells a
 * founder what their business is worth fixing; a button that shimmers while
 * they read that is lying about where the attention belongs.
 *
 * ## Why every treatment is drawn twice
 *
 * Rest and hover, side by side, because a treatment that is only good in one
 * of them is not good. The hover column has the hover classes applied
 * statically — no pointer required to see it, and no pointer available in a
 * screenshot.
 */

type Job = { key: string; label: string; note: string };

const JOBS: readonly Job[] = [
  { key: "primary", label: "Buy Credits", note: "CTA · die eine Sache" },
  { key: "secondary", label: "Manage plan", note: "Daneben, gleichrangig" },
  { key: "ghost", label: "Change", note: "Inline, in einer Zeile" },
  { key: "danger", label: "Delete project", note: "Zerstörend" },
  { key: "icon", label: "+", note: "Nur ein Zeichen" },
];

/** Geometry is settled and identical everywhere — only the skin varies. */
const CONTAINED = "inline-flex items-center justify-center gap-2 rounded-nav px-4 py-2.5 text-ui";
const INLINE = "inline-flex min-h-7 items-center justify-center gap-1.5 rounded-full px-3 text-ui";
const ICON = "inline-flex size-8 shrink-0 items-center justify-center rounded-full";

type Skin = {
  /** Classes at rest. */
  rest: string;
  /** The same control with its hover state applied, for the second column. */
  hover: string;
  /** Anything that has to be a real element rather than a class. */
  chip?: boolean;
};

type Treatment = {
  key: string;
  name: string;
  claim: string;
  cost: string;
  source: string;
  skins: Record<string, Skin>;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "today",
    name: "1 · Heute",
    source: "Vibe, unverändert — die Kontrolle",
    claim:
      "Mint als volle Fläche, ein weicher Schein darunter, alles andere eine Haarlinie. Genau das, was gerade ausgeliefert ist.",
    cost:
      "Der CTA ist ein Mint-Block. Auf einer Seite mit mehreren Karten war das messbar zu laut — deswegen sind die Kauf-Buttons gerade secondary.",
    skins: {
      primary: {
        rest: cn(CONTAINED, "bg-mint text-mint-ink font-bold shadow-mint"),
        hover: cn(CONTAINED, "bg-mint-hover text-mint-ink font-bold shadow-mint"),
      },
      secondary: {
        rest: cn(CONTAINED, "bg-surface-hover text-fg-body border-line-strong border"),
        hover: cn(CONTAINED, "border-line-strong text-fg border border-white/10 bg-white/10"),
      },
      ghost: {
        rest: cn(INLINE, "bg-surface-3 text-fg-secondary"),
        hover: cn(INLINE, "bg-surface-hover text-fg"),
      },
      danger: {
        rest: cn(INLINE, "border-coral-line bg-coral-tint-soft text-coral border"),
        hover: cn(INLINE, "border-coral-line bg-coral-tint text-coral border"),
      },
      icon: {
        rest: cn(ICON, "bg-surface-3 text-fg-secondary"),
        hover: cn(ICON, "bg-surface-hover text-fg"),
      },
    },
  },
  {
    key: "edge",
    name: "2 · Kante statt Fläche",
    source: "Mechanismus aus „Gradient Button“ (21st.dev), auf Mint übertragen",
    claim:
      "Die Farbe wandert von der Fläche in den Rand. Der CTA bleibt dunkles Glas mit einer Mint-Kante und einem Mint-Schein darunter — das Grün ist ein Licht, kein Block. Damit tragen alle vier Varianten dieselbe Form: Rand plus Füllung, nur in verschiedenen Farben.",
    cost:
      "Ein CTA ohne gefüllte Fläche ist leiser. Auf einer Landingpage, wo genau ein Button die ganze Arbeit macht, ist das ein echter Verlust an Nachdruck. Der Rand zählt als Container in Ruhe — die Regel, die vom Handy kommt, ist damit erfüllt.",
    skins: {
      primary: {
        rest: cn(
          CONTAINED,
          "border-mint bg-mint-tint text-mint border font-semibold",
          "shadow-[0_0_0_1px_rgb(0_229_160/0.25),0_10px_30px_-14px_rgb(0_229_160/0.7)]",
        ),
        hover: cn(
          CONTAINED,
          "border-mint bg-mint-tint text-mint border font-semibold",
          "shadow-[0_0_0_1px_rgb(0_229_160/0.45),0_14px_36px_-12px_rgb(0_229_160/0.9)]",
        ),
      },
      secondary: {
        rest: cn(CONTAINED, "border-line-strong bg-surface-2 text-fg-body border"),
        hover: cn(CONTAINED, "border-line-strong bg-surface-hover text-fg border"),
      },
      ghost: {
        rest: cn(INLINE, "border-line-3 text-fg-secondary border bg-transparent"),
        hover: cn(INLINE, "border-line-strong bg-surface-2 text-fg border"),
      },
      danger: {
        rest: cn(INLINE, "border-coral bg-coral-tint-soft text-coral border"),
        hover: cn(INLINE, "border-coral bg-coral-tint text-coral border"),
      },
      icon: {
        rest: cn(ICON, "border-line-3 text-fg-secondary border bg-transparent"),
        hover: cn(ICON, "border-line-strong bg-surface-2 text-fg border"),
      },
    },
  },
  {
    key: "lit",
    name: "3 · Verlauf und Lichtkante",
    source: "Mechanismus aus „Glow Button“ (21st.dev)",
    claim:
      "Dieselbe Mint-Fläche wie heute, aber nicht flach: ein Verlauf von oben nach unten, eine helle Innenkante oben und ein tieferer Schein. Der Button bekommt eine Oberfläche statt einer Farbe — er wirkt gedrückt, wenn er gedrückt wird.",
    cost:
      "Verläufe altern schnell und sie sind das Erste, was in einem Screenshot nach 2014 aussieht, wenn man sie zu weit dreht. Hier bewusst schmal gehalten.",
    skins: {
      primary: {
        rest: cn(
          CONTAINED,
          "text-mint-ink font-bold",
          "bg-gradient-to-b from-[#5cebc0] to-[#00c98c]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_12px_30px_-12px_rgb(0_229_160/0.75)]",
        ),
        hover: cn(
          CONTAINED,
          "text-mint-ink font-bold",
          "bg-gradient-to-b from-[#8bf3d3] to-[#12dc9d]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_16px_38px_-10px_rgb(0_229_160/0.95)]",
        ),
      },
      secondary: {
        rest: cn(
          CONTAINED,
          "text-fg-body border-line-strong border bg-gradient-to-b from-white/[0.09] to-white/[0.03]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.09)]",
        ),
        hover: cn(
          CONTAINED,
          "text-fg border-line-strong border bg-gradient-to-b from-white/[0.14] to-white/[0.05]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]",
        ),
      },
      ghost: {
        rest: cn(
          INLINE,
          "text-fg-secondary bg-gradient-to-b from-white/[0.07] to-white/[0.03]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.07)]",
        ),
        hover: cn(
          INLINE,
          "text-fg bg-gradient-to-b from-white/[0.12] to-white/[0.05]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]",
        ),
      },
      danger: {
        rest: cn(
          INLINE,
          "border-coral-line text-coral border bg-gradient-to-b from-[rgb(255_122_92/0.16)] to-[rgb(255_122_92/0.06)]",
          "shadow-[inset_0_1px_0_rgb(255_122_92/0.2)]",
        ),
        hover: cn(
          INLINE,
          "border-coral-line text-coral border bg-gradient-to-b from-[rgb(255_122_92/0.26)] to-[rgb(255_122_92/0.1)]",
          "shadow-[inset_0_1px_0_rgb(255_122_92/0.3)]",
        ),
      },
      icon: {
        rest: cn(
          ICON,
          "text-fg-secondary bg-gradient-to-b from-white/[0.07] to-white/[0.03]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.07)]",
        ),
        hover: cn(
          ICON,
          "text-fg bg-gradient-to-b from-white/[0.12] to-white/[0.05]",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]",
        ),
      },
    },
  },
  {
    key: "chip",
    name: "4 · Der Chip",
    source: "Mechanismus aus „Anti Metal“ (21st.dev)",
    claim:
      "Der Container ist immer dunkel; das Mint sitzt als kleiner Block *im* Button und trägt das Zeichen. Ein Vibe-Button ist damit an einer Sache erkennbar, und die Farbe sagt, welche Art Aktion es ist, ohne die halbe Karte einzufärben.",
    cost:
      "Braucht ein Zeichen. Ein Button ohne Icon hat keinen Chip und fällt aus dem System — und ausgerechnet „Save“ und „Continue“ haben heute keins.",
    skins: {
      primary: {
        rest: cn(CONTAINED, "border-line-2 bg-surface-4 text-fg border ps-1.5 font-semibold"),
        hover: cn(CONTAINED, "border-line-strong bg-surface-hover text-fg border ps-1.5 font-semibold"),
        chip: true,
      },
      secondary: {
        rest: cn(CONTAINED, "border-line-2 bg-surface-2 text-fg-body border ps-1.5"),
        hover: cn(CONTAINED, "border-line-strong bg-surface-4 text-fg border ps-1.5"),
        chip: true,
      },
      ghost: {
        rest: cn(INLINE, "text-fg-secondary bg-transparent ps-1"),
        hover: cn(INLINE, "bg-surface-2 text-fg ps-1"),
        chip: true,
      },
      danger: {
        rest: cn(INLINE, "border-line-2 bg-surface-2 text-fg-body border ps-1"),
        hover: cn(INLINE, "border-coral-line bg-coral-tint-soft text-coral border ps-1"),
        chip: true,
      },
      icon: {
        rest: cn(ICON, "bg-mint text-mint-ink rounded-lg"),
        hover: cn(ICON, "bg-mint-hover text-mint-ink rounded-lg"),
      },
    },
  },
  {
    key: "flat",
    name: "5 · Flach und ruhig",
    source: "Kein Registry-Mechanismus — die Gegenthese",
    claim:
      "Kein Schein, kein Verlauf, keine Innenkante. Eine Fläche, eine Haarlinie, ein Gewicht. Der Unterschied zwischen den Varianten ist ausschließlich Farbe, und der CTA fällt auf, weil er der einzige farbige Punkt auf dem Screen ist.",
    cost:
      "Verliert die Tiefe, die v2 ausdrücklich gewählt hat — und bricht eine Regel, die dieses Produkt am Handy gelernt hat: „Change“ und „Delete project“ haben hier in Ruhe gar keinen Container. Ein Finger sieht nie einen Hover, also ist der Ruhezustand alles, was er bekommt. Diese Variante ist deshalb nur wählbar, wenn wir diese Regel bewusst zurücknehmen.",
    skins: {
      primary: {
        rest: cn(CONTAINED, "bg-mint text-mint-ink font-semibold"),
        hover: cn(CONTAINED, "bg-mint-hover text-mint-ink font-semibold"),
      },
      secondary: {
        rest: cn(CONTAINED, "border-line-3 text-fg-body border bg-transparent"),
        hover: cn(CONTAINED, "border-line-strong bg-surface-2 text-fg border"),
      },
      ghost: {
        rest: cn(INLINE, "text-fg-secondary bg-transparent"),
        hover: cn(INLINE, "bg-surface-3 text-fg"),
      },
      danger: {
        rest: cn(INLINE, "text-coral bg-transparent"),
        hover: cn(INLINE, "bg-coral-tint-soft text-coral"),
      },
      icon: {
        rest: cn(ICON, "text-fg-secondary bg-transparent"),
        hover: cn(ICON, "bg-surface-3 text-fg"),
      },
    },
  },
];

function Mark({ job }: { job: Job }) {
  if (job.key === "icon") return <PlusIcon size={16} />;
  if (job.key === "danger") return <DeleteIcon size={14} />;
  if (job.key === "primary") return <PlusIcon size={14} />;
  if (job.key === "secondary") return <ArrowRightIcon size={14} />;
  return <ArrowRightIcon size={14} />;
}

/** The chip treatment puts the mark in a block of its own. */
function ChipMark({ job }: { job: Job }) {
  const tone =
    job.key === "primary"
      ? "bg-mint text-mint-ink"
      : job.key === "danger"
        ? "bg-coral-tint text-coral"
        : "bg-surface-hover text-fg-secondary";
  const box = job.key === "ghost" || job.key === "danger" ? "size-5 rounded-md" : "size-7 rounded-md";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", box, tone)}>
      <Mark job={job} />
    </span>
  );
}

function Control({
  job,
  skin,
  chip,
}: {
  job: Job;
  skin: string;
  chip: boolean;
}) {
  const iconOnly = job.key === "icon";
  return (
    <button type="button" className={skin}>
      {chip && !iconOnly ? <ChipMark job={job} /> : <Mark job={job} />}
      {iconOnly ? <span className="sr-only">Credits aufladen</span> : job.label}
    </button>
  );
}

function TreatmentBlock({ treatment }: { treatment: Treatment }) {
  const chip = treatment.key === "chip";
  return (
    <section className="border-line-3 mt-10 border-t pt-8">
      <h2 className="text-fg text-title font-semibold">{treatment.name}</h2>
      <p className="text-fg-meta mt-1 text-meta">{treatment.source}</p>
      <p className="text-fg-prose mt-3 max-w-[68ch] text-caption">{treatment.claim}</p>
      <p className="text-fg-muted mt-2 max-w-[68ch] text-caption">
        <b className="text-fg-secondary">Kosten:</b> {treatment.cost}
      </p>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        {(["rest", "hover"] as const).map((state) => (
          <div key={state} className="border-line-2 bg-surface-1 flex flex-col gap-4 rounded-panel border p-5">
            <p className="eyebrow text-fg-meta">{state === "rest" ? "In Ruhe" : "Unter dem Zeiger"}</p>
            <div className="flex flex-wrap items-center gap-3">
              {JOBS.map((job) => (
                <Control
                  key={job.key}
                  job={job}
                  chip={chip && Boolean(treatment.skins[job.key]?.chip)}
                  skin={treatment.skins[job.key]![state]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StudyButtonLook({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Wie der Button aussieht</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Fünf Behandlungen, dieselben vier Varianten
        </h1>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-lead">
          Rendered in {study.name}. Das System steht — eine Komponente, vier Varianten, zwei Größen.
          Hier geht es nur noch um die Haut. Was auch gewinnt, es ist eine Änderung an{" "}
          <code className="text-fg-secondary font-mono text-ui">VARIANT_CLASSES</code> und sonst
          nichts.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Was ich mir angesehen habe</p>
        <h2 className="text-fg mt-3 text-title font-semibold">
          Vier Mechanismen aus den Registries, drei davon abgelehnt
        </h2>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-caption">
          ReUI liefert für Buttons nichts Freies — die beiden Treffer sind Premium-Blocks. 21st.dev
          liefert reichlich, und die Mechanismen sind: <b className="text-fg">Verlauf mit
          Lichtkante</b> (Glow Button), <b className="text-fg">Farbe im Rand statt in der Fläche</b>{" "}
          (Gradient Button), <b className="text-fg">Akzent als Chip im Button</b> (Anti Metal) und{" "}
          <b className="text-fg">Haarlinie plus Schein plus ein farbiger Punkt</b> (Subtle Button).
        </p>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-caption">
          Abgelehnt und der Vollständigkeit halber benannt: rotierende Schimmer-Ränder, animierte
          Mehrfarb-Verläufe und „Nebula&ldquo;-Pulsieren. Dieses Produkt sagt einem Gründer, was an
          seinem Geschäft repariert gehört — ein Button, der dabei schimmert, lügt darüber, wo die
          Aufmerksamkeit hingehört.
        </p>
      </div>

      {TREATMENTS.map((treatment) => (
        <TreatmentBlock key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}
