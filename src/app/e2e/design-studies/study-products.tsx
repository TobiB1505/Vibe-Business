import { buttonClasses } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { ArrowRightIcon, PlusIcon, SearchIcon } from "@/components/ui/dashboard-icons";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * Is this page a list, or a wall of cards? (UI-33)
 *
 * ## What the audit found
 *
 * Measured at 1280, 1440 and 390, in v2, on `account-products`.
 *
 * **The one action on the page is dressed as a fourth statistic.** `Connect
 * product` sits in the metric row at the same size and shape as `3 Products`.
 * The only thing a founder can *do* here wears the costume of something to
 * read — and it is a hand-drawn control, which is the second finding.
 *
 * **It bypasses `Button`.** Its own border, fill and hover, written inline,
 * after sprint 0185 folded every pressable control into one component.
 *
 * **Focus is invisible on the search field.** The page has its *own copy* of
 * the search box, and 0189's fix went to the repositories page only. Measured
 * with real Tab presses: this label computes `box-shadow: none` and changes a
 * border to 32% mint; the repositories one computes
 * `rgb(0, 229, 160) 0px 0px 0px 2px`. One hand-written field was repaired and
 * its twin was not, which is the argument for a shared component made by the
 * defect rather than in a docblock.
 *
 * **The metric row counts the list underneath it.** Three products, `2/3`
 * analysed, `2` needing attention — above three cards that say so. The same
 * species as the critical finding 0189 raised one page over.
 *
 * **One card says the same absence seven times, in five wordings.** `Half Set
 * Up` prints: NOT ANALYSED · No product summary is available yet · Not
 * established yet ×3 · Product profile pending · No data yet · Analysed not
 * yet. The last is not English.
 *
 * **Three products, three heights.** 252 / 194 / 231 at 1280; 228 / 194 / 214
 * at 1440. The facts grid collapses when a product has no profile, so nothing
 * lines up down the page.
 *
 * **2,792px on a phone**, of which the first ~430 is four stacked tiles of
 * arithmetic before the first product appears.
 *
 * ## What the registries had
 *
 * ReUI, free this time: `c-item-5`, an item group with status badges — the
 * "row, not card" shape, the same answer it gave for repositories. 21st.dev
 * returned a **Project Data Table** with status pills per row, which is the
 * shape behind D and worth showing precisely because 0189 *rejected* a grid
 * for repositories: nobody compares connection dates, but a founder does
 * compare business signal, and that is the one column a grid would earn.
 *
 * Nothing is installed. Both are compositions.
 *
 * ## What every treatment fixes, so the choice is about shape
 *
 * The search field gets the ring. `Connect product` goes through `Button` and
 * stops being a statistic. An absence is stated once. And every row in a list
 * is the same height, whatever the product has told Vibe.
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
    name: "A · Die Liste ist die Seite",
    claim: "Keine Kacheln. Eine Zeile pro Produkt, alle gleich hoch, und ein Primary oben.",
    argument:
      "Was ein Produkt tut, steht im Produkt — auf der Übersicht will man wissen, welches gerade etwas von einem will. Also trägt eine Zeile genau das: Marke, Name, Zustand, Signal, Pfeil. Die Metrikkacheln fallen weg, weil sie die Liste darunter zählen, und „Produkt verbinden“ wird das, was es ist: die eine Aktion der Seite.",
  },
  {
    key: "b",
    name: "B · Nach Zustand gruppiert",
    claim: "Kein Filterband, keine Kacheln — die Liste selbst ist die Gruppierung.",
    argument:
      "„2 brauchen Aufmerksamkeit“ als Kachel über einer Liste, in der man sie suchen muss, ist die Zahl an der falschen Stelle. Hier sortiert sie: drei Überschriften mit ihrer Anzahl, und darunter stehen genau die Produkte. Der Filter ist überflüssig, weil alle Gruppen schon da sind.",
  },
  {
    key: "c",
    name: "C · Zeile mit Aufklapper",
    claim: "Wie A, aber was das Produkt tut, liegt einen Klick tief unter der Zeile.",
    argument:
      "Für den Fall, dass die drei Profilfelder auf die Übersicht gehören: sie sind da, aber sie kosten keinen Platz, solange niemand sie aufmacht. Eine Zeile bleibt eine Zeile, und die Höhe der Liste hängt nicht mehr davon ab, wie viel Vibe über welches Produkt weiß.",
  },
  {
    key: "d",
    name: "D · Eine Tabelle",
    claim: "Ein Raster: Produkt, Zustand, Signal, zuletzt analysiert.",
    argument:
      "0189 hat für Repositories gegen ein Raster entschieden — niemand vergleicht Verbindungsdaten eine Spalte hinunter. Hier ist das anders: Signal ist genau die Spalte, die man vergleicht. Dies zeigt, wie das aussähe, damit die Entscheidung gegen ein Raster diesmal eine Entscheidung ist und keine Gewohnheit.",
  },
];

type Product = {
  id: string;
  name: string;
  project: string;
  initials: string;
  tone: "mint" | "amber" | "neutral";
  status: { tone: StatusTone; word: string };
  score: number | null;
  analysed: string | null;
  does: string | null;
  whom: string | null;
  goal: string | null;
};

const PRODUCTS: readonly Product[] = [
  {
    id: "payflow",
    name: "Payflow",
    project: "Needs You Now",
    initials: "PA",
    tone: "amber",
    status: { tone: "problem", word: "Braucht dich" },
    score: 46,
    analysed: "22. Aug 2026",
    does: "Findet die wichtigste Geschäftslücke und bereitet die Arbeit drumherum vor.",
    whom: "Gründer mit einem Produkt, das schon im Markt ist",
    goal: "Monetarisierung starten",
  },
  {
    id: "half",
    name: "Half Set Up",
    project: "half-set-up",
    initials: "HS",
    tone: "neutral",
    status: { tone: "neutral", word: "Noch nicht analysiert" },
    score: null,
    analysed: null,
    does: null,
    whom: null,
    goal: null,
  },
  {
    id: "quiet",
    name: "Quietly Fine",
    project: "quietly-fine",
    initials: "QF",
    tone: "mint",
    status: { tone: "success", word: "Aktuell" },
    score: 71,
    analysed: "20. Aug 2026",
    does: "Macht aus Produkt-Evidenz einen sortierten Wachstumsplan.",
    whom: "Unabhängige Gründer und kleine Produktteams",
    goal: "Umsatz steigern",
  },
];

/**
 * The absence, said once.
 *
 * The card in production says it seven times in five wordings. A product Vibe
 * has not read yet is one fact, and a list is the wrong place to spell out
 * every field it happens to be missing.
 */
const NOT_READ_YET = "Noch nicht gelesen";

const MARK_TONE: Record<Product["tone"], string> = {
  mint: "from-mint/35 via-mint/15 to-surface-hover border-mint-line text-mint",
  amber: "from-amber/35 via-amber/15 to-surface-hover border-amber-line text-amber",
  neutral: "from-white/10 via-white/[0.04] to-surface-hover border-line-strong text-fg-body",
};

const SCORE_TONE: Record<Product["tone"], string> = {
  mint: "text-mint",
  amber: "text-amber",
  neutral: "text-fg-meta",
};

function Mark({ product, size = 40 }: { product: Product; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-nav border bg-gradient-to-br text-caption font-bold",
        MARK_TONE[product.tone],
      )}
    >
      {product.initials}
    </span>
  );
}

/** The signal, as a number and nothing else. A bar of one value is a decoration. */
function Signal({ product }: { product: Product }) {
  if (product.score === null) {
    return <span className="text-fg-meta text-caption">{NOT_READ_YET}</span>;
  }
  return (
    <span className="flex items-baseline gap-1">
      <span className={cn("text-title font-bold tabular-nums", SCORE_TONE[product.tone])}>
        {product.score}
      </span>
      <span className="text-fg-meta text-caption">/100</span>
    </span>
  );
}

/**
 * The toolbar every treatment shares, with the ring the product's copy lacks.
 *
 * `has-[:focus-visible]:ring-mint has-[:focus-visible]:ring-2` is the class the
 * repositories page has and this one does not. It is on all four so that the
 * choice below is about shape and not about which one happens to be reachable
 * by keyboard.
 */
function Toolbar({ primary = "Produkt verbinden" }: { primary?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="border-line-2 bg-field focus-within:border-mint-line has-[:focus-visible]:ring-mint has-[:focus-visible]:ring-2 rounded-nav flex min-w-0 flex-1 items-center gap-2.5 border px-3.5 py-2.5 sm:max-w-72">
        <SearchIcon size={16} className="text-fg-meta shrink-0" />
        <span className="sr-only">Produkte durchsuchen</span>
        <input
          readOnly
          placeholder="Produkte durchsuchen…"
          className="text-fg-body placeholder:text-fg-meta min-w-0 flex-1 bg-transparent text-body outline-none"
        />
      </label>

      {/* Through `Button`, and the one primary on the page. */}
      <span className={cn(buttonClasses({ variant: "primary" }), "shrink-0")}>
        <PlusIcon size={16} />
        {primary}
      </span>
    </div>
  );
}

/** A · one row per product, every row the same height. */
function TreatmentA() {
  return (
    <div className="flex flex-col gap-5">
      <Toolbar />
      <Surface level="card" padding="none" className="overflow-hidden">
        <ul>
          {PRODUCTS.map((product, index) => (
            <li key={product.id}>
              <span
                className={cn(
                  "hover:bg-surface-hover flex items-center gap-4 px-5 py-4 transition-interactive",
                  index > 0 && "border-line-2 border-t",
                )}
              >
                <Mark product={product} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-fg truncate text-ui font-semibold">{product.name}</span>
                  <span className="text-fg-meta truncate text-caption">{product.project}</span>
                </span>
                <StatusPill tone={product.status.tone}>{product.status.word}</StatusPill>
                <span className="w-28 shrink-0 text-right">
                  <Signal product={product} />
                </span>
                <ArrowRightIcon size={16} className="text-fg-meta shrink-0" />
              </span>
            </li>
          ))}
        </ul>
      </Surface>
    </div>
  );
}

/** B · the list is the grouping, and the counts live in the headings. */
function TreatmentB() {
  const groups = [
    { word: "Braucht dich", items: PRODUCTS.filter((p) => p.tone === "amber") },
    { word: "Aktuell", items: PRODUCTS.filter((p) => p.tone === "mint") },
    { word: "Noch nicht analysiert", items: PRODUCTS.filter((p) => p.tone === "neutral") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Toolbar />
      {groups.map((group) => (
        <section key={group.word} className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <MonoLabel as="h3">{group.word}</MonoLabel>
            <span className="text-fg-meta text-caption tabular-nums">{group.items.length}</span>
          </div>
          <Surface level="panel" padding="none" className="overflow-hidden">
            <ul>
              {group.items.map((product, index) => (
                <li key={product.id}>
                  <span
                    className={cn(
                      "hover:bg-surface-hover flex items-center gap-4 px-4 py-3.5 transition-interactive",
                      index > 0 && "border-line-2 border-t",
                    )}
                  >
                    <Mark product={product} size={34} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-fg truncate text-ui font-semibold">{product.name}</span>
                      <span className="text-fg-meta truncate text-caption">{product.project}</span>
                    </span>
                    <span className="w-28 shrink-0 text-right">
                      <Signal product={product} />
                    </span>
                    <ArrowRightIcon size={16} className="text-fg-meta shrink-0" />
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
        </section>
      ))}
    </div>
  );
}

/** C · the row from A, with the profile a click below it. */
function TreatmentC() {
  return (
    <div className="flex flex-col gap-5">
      <Toolbar />
      <Surface level="card" padding="none" className="overflow-hidden">
        <ul>
          {PRODUCTS.map((product, index) => (
            <li key={product.id} className={cn(index > 0 && "border-line-2 border-t")}>
              <span className="flex items-center gap-4 px-5 py-4">
                <Mark product={product} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-fg truncate text-ui font-semibold">{product.name}</span>
                  <span className="text-fg-meta truncate text-caption">{product.project}</span>
                </span>
                <StatusPill tone={product.status.tone}>{product.status.word}</StatusPill>
                <span className="w-28 shrink-0 text-right">
                  <Signal product={product} />
                </span>
                <ArrowRightIcon size={16} className="text-fg-meta shrink-0" />
              </span>

              <div className="px-5 pb-4">
                <Disclosure label="Was Vibe über dieses Produkt weiß">
                  {product.does === null ? (
                    <p className="text-fg-meta text-caption">{NOT_READ_YET}</p>
                  ) : (
                    <dl className="grid gap-4 sm:grid-cols-3">
                      {[
                        ["Was es tut", product.does],
                        ["Für wen", product.whom],
                        ["Ziel des Gründers", product.goal],
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-fg-body text-caption font-semibold">{label}</dt>
                          <dd className="text-fg-muted mt-1 text-caption leading-5">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </Disclosure>
              </div>
            </li>
          ))}
        </ul>
      </Surface>
    </div>
  );
}

/** D · the grid, for the one column a founder actually compares. */
function TreatmentD() {
  return (
    <div className="flex flex-col gap-5">
      <Toolbar />
      <Surface level="card" padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse">
          <thead>
            <tr className="border-line-2 border-b">
              {["Produkt", "Zustand", "Signal", "Zuletzt analysiert"].map((head, index) => (
                <th
                  key={head}
                  scope="col"
                  className={cn(
                    "text-fg-meta px-5 py-3 text-caption font-medium",
                    index === 0 ? "text-left" : index === 3 ? "text-right" : "text-left",
                  )}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRODUCTS.map((product, index) => (
              <tr
                key={product.id}
                className={cn("hover:bg-surface-hover", index > 0 && "border-line-2 border-t")}
              >
                <td className="px-5 py-3.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <Mark product={product} size={30} />
                    <span className="text-fg truncate text-ui font-semibold">{product.name}</span>
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <StatusPill tone={product.status.tone}>{product.status.word}</StatusPill>
                </td>
                <td className="px-5 py-3.5">
                  <Signal product={product} />
                </td>
                <td className="text-fg-muted px-5 py-3.5 text-right text-caption">
                  {product.analysed ?? NOT_READ_YET}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </div>
  );
}

const RENDER: Record<string, () => React.JSX.Element> = {
  a: TreatmentA,
  b: TreatmentB,
  c: TreatmentC,
  d: TreatmentD,
};

export function StudyProducts({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Products</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Ist diese Seite eine Liste oder eine Wand aus Karten?
        </h1>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-lead">
          Gezeichnet in {study.name}. Drei Produkte, 1.074px hoch am Desktop und 2.792px auf dem
          Handy — davon die ersten 430 vier gestapelte Kacheln, die die Liste darunter zählen.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Was das Audit gefunden hat</p>
        <h2 className="text-fg mt-3 text-title font-semibold">Sieben Befunde, in v2 gemessen</h2>
        <ul className="text-fg-prose mt-4 flex max-w-[68ch] flex-col gap-2 text-caption">
          <li>
            <b className="text-coral">Major</b> · Fokus ist auf dem Suchfeld unsichtbar. Diese Seite
            hat ihre <b className="text-fg">eigene Kopie</b> des Suchfelds, und 0189s Reparatur ging
            nur an die Repositories-Seite. Gemessen mit echten Tab-Anschlägen:{" "}
            <code className="font-mono text-ui">box-shadow: none</code> hier,{" "}
            <code className="font-mono text-ui">rgb(0, 229, 160) 0 0 0 2px</code> dort.
          </li>
          <li>
            <b className="text-coral">Major</b> · Die einzige Aktion der Seite ist als vierte
            Statistik verkleidet — gleiche Größe, gleiche Form wie „3 Products“ — und umgeht{" "}
            <code className="font-mono text-ui">Button</code>, den Sprint 0185 als einziges
            drückbares Element festgelegt hat.
          </li>
          <li>
            <b className="text-fg">Major</b> · Die Kachelreihe zählt die Liste, die direkt darunter
            steht. Derselbe Befund wie auf der Repositories-Seite eine Seite weiter.
          </li>
          <li>
            <b className="text-fg">Major</b> · Eine Karte sagt dieselbe Abwesenheit{" "}
            <b className="text-fg">siebenmal</b> in fünf Formulierungen — „Analysed not yet“ ist
            dabei nicht einmal Englisch.
          </li>
          <li>
            <b className="text-fg">Minor</b> · Drei Produkte, drei Höhen: 252 / 194 / 231 bei 1280.
            Das Faktenraster fällt zusammen, wenn ein Produkt kein Profil hat.
          </li>
          <li>
            <b className="text-fg">Minor</b> · Vier Zonen pro Karte in vier Rhythmen: Identität,
            Definitionsraster, Metadatenliste, Score-Block mit Sparkline.
          </li>
          <li>
            <b className="text-fg">Minor</b> · 2.792px auf dem Handy für drei Produkte.
          </li>
        </ul>
        <p className="text-fg-muted mt-4 max-w-[68ch] text-caption">
          Alle vier reparieren dasselbe: das Suchfeld bekommt den Ring, „Produkt verbinden“ geht
          durch <code className="font-mono text-ui">Button</code> und hört auf, eine Statistik zu
          sein, eine Abwesenheit wird einmal gesagt, und jede Zeile ist gleich hoch. Was sich
          unterscheidet, ist die Form.
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
