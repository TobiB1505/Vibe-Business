import { ArrowRightIcon, PlusIcon } from "@/components/ui/icons.generated";
import { CreditCoin } from "@/components/ui/credit-coin";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * What is left, and how loud money may be (UI-28).
 *
 * ## The inventory this answers
 *
 * `Button` covers everything contained. Counted against HEAD, five families
 * still do not go through it:
 *
 *   `proseLinkClasses`   13   a link inside a sentence
 *   `StandaloneLink`     36   a link on its own line
 *   `Wallet`              2   the balance pill and the `+` beside it
 *   `size="marketing"`    3   the landing page's CTA
 *   the money buttons     5   Buy, Choose plan, Buy Credits, top up
 *
 * The first two are deliberately not buttons and the question is only whether
 * the surface reaches them. The third is hand-written classes that predate the
 * system. The last two are the same object seen twice — the place where a
 * founder spends money — and they are the reason this study exists.
 *
 * Deliberately **not** in scope: `SegmentedControl`, `SortSelect`, `Tabs`,
 * `ChoiceCard`, `ChoicePills`, the project switcher and the rail. Those are
 * *selection*, not action: they answer "which one", and a control that changes
 * a view is a different category from one that spends 33 euros.
 *
 * ## The axis
 *
 * Two questions, and every treatment answers both: **how far does the surface
 * travel into text**, and **may a priced control look different from a free
 * one**. They are not independent — a system where every link is a container
 * has no room left to make money louder, because everything is already loud.
 */

type Job = { key: string; label: string; note: string };

const JOBS: readonly Job[] = [
  { key: "prose", label: "In a sentence", note: "13× · proseLinkClasses" },
  { key: "standalone", label: "On its own line", note: "36× · StandaloneLink" },
  { key: "wallet", label: "Die Credits", note: "2× · Wallet" },
  { key: "money", label: "Geld ausgeben", note: "5× · Buy / Choose plan" },
  { key: "marketing", label: "Landing", note: "3× · size=marketing" },
];

/* ── shared pieces ──────────────────────────────────────────────────── */

const SHEEN_ACCENT =
  "bg-mint bg-gradient-to-b from-sheen-lift to-sheen-sink text-mint-ink shadow-mint-sheen";
const SHEEN_SOFT =
  "bg-surface-3 bg-gradient-to-b from-sheen-soft to-transparent text-fg-secondary shadow-sheen";
const CONTAINED = "inline-flex items-center justify-center gap-2 rounded-nav px-4 py-2.5 text-ui";
const MARKETING = "inline-flex items-center justify-center gap-2 rounded-nav px-6 py-4 text-lead";

function Coin() {
  return <CreditCoin size={16} />;
}

/* ── the four treatments ────────────────────────────────────────────── */

type Treatment = {
  key: string;
  name: string;
  claim: string;
  cost: string;
  render: (job: string) => React.ReactNode;
};

/** The link shapes both conservative treatments share. */
function TextLinks(job: string) {
  if (job === "prose")
    return (
      <p className="text-fg-prose max-w-[46ch] text-body">
        Everything else is off until you say otherwise.{" "}
        <span className="text-fg-body hover:text-fg cursor-pointer underline underline-offset-4">
          What Vibe stores
        </span>
        .
      </p>
    );
  if (job === "standalone")
    return (
      <span className="text-fg-muted hover:text-fg-body inline-flex w-fit cursor-pointer items-center gap-1.5 text-body">
        Credits and billing
        <ArrowRightIcon size={14} />
      </span>
    );
  return null;
}

const TREATMENTS: readonly Treatment[] = [
  {
    key: "restraint",
    name: "A · Zurückhaltend",
    claim:
      "Die Oberfläche hört da auf, wo etwas wie ein Button aussieht. Links bleiben reiner Text, die Credits-Pille bekommt die Oberfläche des Systems, und Geld ist ein primary in der normalen Größe — nur eben mint.",
    cost:
      "Ein Button, der 33 € ausgibt, ist von einem „Save“ nicht zu unterscheiden. Das Produkt sagt an keiner Stelle mit Form, dass hier Geld fließt.",
    render: (job) => {
      const link = TextLinks(job);
      if (link) return link;
      if (job === "wallet")
        return (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "border-line-2 flex h-10 items-center gap-2 rounded-full border px-4",
                "bg-surface-2 bg-gradient-to-b from-sheen-soft to-transparent shadow-sheen",
              )}
            >
              <Coin />
              <span className="text-fg text-ui font-semibold tabular-nums">1,720</span>
              <span className="text-fg-meta text-meta">Credits</span>
            </span>
            <span
              className={cn(
                "border-line-2 text-fg-muted grid size-10 place-items-center rounded-full border",
                "bg-surface-2 bg-gradient-to-b from-sheen-soft to-transparent shadow-sheen",
              )}
            >
              <PlusIcon size={16} />
            </span>
          </div>
        );
      if (job === "money")
        return (
          <span className={cn(CONTAINED, SHEEN_ACCENT, "font-bold")}>
            Buy <ArrowRightIcon size={14} />
          </span>
        );
      return (
        <span className={cn(MARKETING, SHEEN_ACCENT, "font-bold")}>
          Start with your GitHub repo
          <ArrowRightIcon size={17} />
        </span>
      );
    },
  },
  {
    key: "one-vocabulary",
    name: "B · Ein Vokabular",
    claim:
      "Auch die Links bekommen einen Container in Ruhe — dieselbe Pille wie ein ghost. Danach gibt es keine Kategorie „Textlink“ mehr, sondern nur noch Controls in verschiedenen Lautstärken.",
    cost:
      "49 Links werden zu 49 Möbelstücken. Ein Absatz mit drei Pillen darin liest sich nicht mehr wie ein Absatz — und ein System, in dem alles ein Container ist, hat keine Lautstärke mehr übrig, um Geld hervorzuheben.",
    render: (job) => {
      if (job === "prose")
        return (
          <p className="text-fg-prose max-w-[46ch] text-body">
            Everything else is off until you say otherwise.{" "}
            <span
              className={cn(
                "inline-flex min-h-6 items-center rounded-full px-2 align-baseline text-ui",
                SHEEN_SOFT,
              )}
            >
              What Vibe stores
            </span>
          </p>
        );
      if (job === "standalone")
        return (
          <span
            className={cn(
              "inline-flex min-h-7 w-fit items-center gap-1.5 rounded-full px-3 text-ui",
              SHEEN_SOFT,
            )}
          >
            Credits and billing
            <ArrowRightIcon size={14} />
          </span>
        );
      if (job === "wallet")
        return (
          <div className="flex items-center gap-2">
            <span className={cn("flex h-10 items-center gap-2 rounded-full px-4", SHEEN_SOFT)}>
              <Coin />
              <span className="text-fg text-ui font-semibold tabular-nums">1,720</span>
              <span className="text-fg-meta text-meta">Credits</span>
            </span>
            <span className={cn("grid size-10 place-items-center rounded-full", SHEEN_SOFT)}>
              <PlusIcon size={16} />
            </span>
          </div>
        );
      if (job === "money")
        return (
          <span className={cn(CONTAINED, SHEEN_ACCENT, "font-bold")}>
            Buy · <span className="tabular-nums">€33</span>
          </span>
        );
      return (
        <span className={cn(MARKETING, SHEEN_ACCENT, "font-bold")}>
          Start with your GitHub repo
          <ArrowRightIcon size={17} />
        </span>
      );
    },
  },
  {
    key: "money-class",
    name: "C · Geld ist eine eigene Klasse",
    claim:
      "Links bleiben Text wie in A. Aber ein Control, das etwas kostet, ist ein eigenes Objekt: zweizeilig — was passiert oben, was es kostet darunter — mit einem Mint-Halo als zweitem Rahmen. Der Preis steht im Button, nicht daneben, also ist er nicht mehr übersehbar.",
    cost:
      "Eine fünfte Variante durch die Hintertür, und sie ist zweizeilig: in eine dichte Tabellenzeile oder neben ein Preisschild passt sie nicht. Die Credit-Pakete müssten ihr Layout ändern.",
    render: (job) => {
      const link = TextLinks(job);
      if (link) return link;
      if (job === "wallet")
        return (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "border-line-2 flex h-10 items-center gap-2 rounded-full border px-4",
                "bg-surface-2 bg-gradient-to-b from-sheen-soft to-transparent shadow-sheen",
              )}
            >
              <Coin />
              <span className="text-fg text-ui font-semibold tabular-nums">1,720</span>
              <span className="text-fg-meta text-meta">Credits</span>
            </span>
            <span
              className={cn(
                "border-mint-line text-mint grid size-10 place-items-center rounded-full border",
                "bg-mint-tint-soft bg-gradient-to-b from-sheen-warn to-transparent",
              )}
            >
              <PlusIcon size={16} />
            </span>
          </div>
        );
      if (job === "money")
        return (
          <span
            className={cn(
              "inline-flex flex-col items-center gap-0.5 rounded-nav px-5 py-2.5",
              SHEEN_ACCENT,
              "ring-mint/25 ring-4",
            )}
          >
            <span className="text-ui font-bold">Buy 1,500 Credits</span>
            <span className="text-mint-ink/70 text-meta font-semibold tabular-nums">
              €33 one time
            </span>
          </span>
        );
      return (
        <span
          className={cn(
            "inline-flex flex-col items-center gap-0.5 rounded-nav px-7 py-3.5",
            SHEEN_ACCENT,
            "ring-mint/25 ring-4",
          )}
        >
          <span className="inline-flex items-center gap-2 text-lead font-bold">
            Start with your GitHub repo
            <ArrowRightIcon size={17} />
          </span>
          <span className="text-mint-ink/70 text-meta font-semibold">No credit card to start</span>
        </span>
      );
    },
  },
  {
    key: "stage",
    name: "D · Die Bühne",
    claim:
      "Der Aufwand geht dorthin, wo jemand zum ersten Mal entscheidet: der Landing-CTA bekommt einen echten Mint-Halo *hinter* sich und die Beruhigung als zweite Zeile im Button. Im Produkt bleibt Geld ruhig — der Preis steht daneben, wo er heute schon steht.",
    cost:
      "Zwei verschiedene Antworten auf dieselbe Frage. Wer von der Landingpage in die App kommt, sieht die Kaufaktion plötzlich in einer leiseren Sprache — und ausgerechnet dort fließt das Geld wirklich.",
    render: (job) => {
      const link = TextLinks(job);
      if (link) return link;
      if (job === "wallet")
        return (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "border-line-2 flex h-10 items-center gap-2 rounded-full border px-4",
                "bg-surface-2 bg-gradient-to-b from-sheen-soft to-transparent shadow-sheen",
              )}
            >
              <Coin />
              <span className="text-fg text-ui font-semibold tabular-nums">1,720</span>
              <span className="text-fg-meta text-meta">Credits</span>
            </span>
            <span
              className={cn(
                "border-line-2 text-fg-muted grid size-10 place-items-center rounded-full border",
                "bg-surface-2 bg-gradient-to-b from-sheen-soft to-transparent shadow-sheen",
              )}
            >
              <PlusIcon size={16} />
            </span>
          </div>
        );
      if (job === "money")
        return (
          <span className="inline-flex items-center gap-3">
            <span className={cn(CONTAINED, SHEEN_ACCENT, "font-bold")}>
              Buy <ArrowRightIcon size={14} />
            </span>
            <span className="text-fg-muted text-caption tabular-nums">€33 one time</span>
          </span>
        );
      return (
        <span className="relative inline-flex">
          <span
            aria-hidden
            className="bg-mint/25 pointer-events-none absolute -inset-x-6 -inset-y-4 rounded-full blur-2xl"
          />
          <span
            className={cn(
              "relative inline-flex flex-col items-center gap-1 rounded-card px-8 py-4",
              SHEEN_ACCENT,
            )}
          >
            <span className="inline-flex items-center gap-2 text-lead font-bold">
              Start with your GitHub repo
              <ArrowRightIcon size={17} />
            </span>
            <span className="text-mint-ink/70 text-meta font-semibold">No credit card to start</span>
          </span>
        </span>
      );
    },
  },
];

function TreatmentBlock({ treatment }: { treatment: Treatment }) {
  return (
    <section className="border-line-3 mt-10 border-t pt-8">
      <h2 className="text-fg text-title font-semibold">{treatment.name}</h2>
      <p className="text-fg-prose mt-3 max-w-[68ch] text-caption">{treatment.claim}</p>
      <p className="text-fg-muted mt-2 max-w-[68ch] text-caption">
        <b className="text-fg-secondary">Kosten:</b> {treatment.cost}
      </p>

      <div className="border-line-2 bg-surface-1 rounded-panel mt-6 flex flex-col gap-6 border p-6">
        {JOBS.map((job) => (
          <div key={job.key} className="flex flex-col gap-2">
            <span className="text-fg-meta text-meta">
              {job.label} · {job.note}
            </span>
            <div>{treatment.render(job.key)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StudyCta({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Was übrig ist</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Die Links, die Credits, und wie laut Geld sein darf
        </h1>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-lead">
          Rendered in {study.name}. Der Button ist entschieden und gebaut. Fünf Familien gehen noch
          an ihm vorbei — und zwei davon sind dieselbe Stelle zweimal: da, wo ein Gründer Geld
          ausgibt.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Der Bestand</p>
        <h2 className="text-fg mt-3 text-title font-semibold">Fünf Familien, gezählt gegen HEAD</h2>
        <div className="mt-4 max-w-[68ch]">
          <dl className="border-line-2 divide-line-2 divide-y border-y">
            {[
              ["proseLinkClasses", "13", "ein Link mitten im Satz"],
              ["StandaloneLink", "36", "ein Link auf eigener Zeile"],
              ["Wallet", "2", "die Guthaben-Pille und das + daneben"],
              ['size="marketing"', "3", "der CTA der Landingpage"],
              ["Buy / Choose plan", "5", "die Stellen, an denen Geld fließt"],
            ].map(([name, count, what]) => (
              <div key={name} className="flex items-baseline gap-4 py-2.5">
                <dt className="text-fg-secondary w-56 shrink-0 font-mono text-ui">{name}</dt>
                <dd className="text-fg w-10 shrink-0 text-ui font-semibold tabular-nums">
                  {count}
                </dd>
                <dd className="text-fg-muted text-caption">{what}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-fg-prose mt-4 max-w-[68ch] text-caption">
          Bewusst <b className="text-fg">nicht</b> dabei: SegmentedControl, SortSelect, Tabs,
          ChoiceCard, ChoicePills, der Projekt-Umschalter und die Leiste. Das ist{" "}
          <i>Auswahl</i>, keine Aktion — ein Control, das eine Ansicht wechselt, ist eine andere
          Kategorie als eines, das 33 € ausgibt.
        </p>
      </div>

      {TREATMENTS.map((treatment) => (
        <TreatmentBlock key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}
