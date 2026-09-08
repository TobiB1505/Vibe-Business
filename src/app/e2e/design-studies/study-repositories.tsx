import { BranchIcon, LockIcon, SettingsIcon } from "@/components/ui/dashboard-icons";
import { ExternalLinkIcon } from "@/components/ui/icons.generated";
import { buttonClasses } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * Does this page want to be a table? (UI-31)
 *
 * ## What the audit found, in one list
 *
 * One critical: the header prints `repositories.length` twice, once labelled
 * **Products** — a number that goes wrong the moment somebody presses
 * Disconnect, which this product's own settings page offers and renders.
 *
 * Three major: focus is invisible on the search field and the sort select
 * (both drop the global ring for a 26%-alpha border, while the segmented
 * control beside them does it correctly); three controls wrap to two lines at
 * 1440, including "Manage connection" at 61px; and the list is **built twice**
 * — a table above `md`, a `<ul>` below — with the two already disagreeing
 * about what a row contains.
 *
 * ## The question underneath
 *
 * Not "how should the table look". Seven rows, three links each, two of them
 * to the same place. A table earns its grid when a reader compares values down
 * a column — and nobody compares connection dates. So each treatment answers
 * *what shape this is* first, and the audit's findings fall out differently
 * from each answer.
 *
 * ## What the registries had
 *
 * ReUI: one free match, `c-item-5` — an item group with status badges, which
 * is the "row, not grid" shape. 21st.dev: a **Package Dependency List** whose
 * groups expand to reveal their children (the mechanism behind C) and **GitHub
 * Repository Cards**, a single-column list of repository cards (D). Everything
 * else it returned for "integrations" was a marketing logo grid, which is a
 * different page in a different product.
 */

type Repo = {
  name: string;
  owner: string;
  product: string;
  branch: string;
  private: boolean;
  connected: string;
  revoked?: boolean;
};

const REPOS: readonly Repo[] = [
  {
    name: "vibe-business",
    owner: "TobiB1505",
    product: "Vibe Business",
    branch: "main",
    private: false,
    connected: "24 Aug",
  },
  {
    name: "saas-analyzer",
    owner: "TobiB1505",
    product: "SaaS Analyzer",
    branch: "main",
    private: true,
    connected: "23 Aug",
  },
  {
    name: "landing-pro",
    owner: "TobiB1505",
    product: "Landing Pro",
    branch: "develop",
    private: true,
    connected: "22 Aug",
    revoked: true,
  },
  {
    name: "idea-capture",
    owner: "TobiB1505",
    product: "Idea Capture",
    branch: "main",
    private: false,
    connected: "21 Aug",
  },
];

function Tile({ repo }: { repo: Repo }) {
  return (
    <span className="from-mint-tint to-surface-hover border-mint-line rounded-nav text-mint flex size-9 shrink-0 items-center justify-center border bg-gradient-to-br text-caption font-bold">
      {repo.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function State({ repo }: { repo: Repo }) {
  if (repo.revoked) return <StatusPill tone="problem">No access</StatusPill>;
  return <StatusPill tone="neutral">{repo.private ? "Private" : "Public"}</StatusPill>;
}

function Branch({ repo }: { repo: Repo }) {
  return (
    <span className="text-fg-meta inline-flex items-center gap-1.5 font-mono text-meta">
      <BranchIcon size={13} />
      {repo.branch}
    </span>
  );
}

/** The repository, as a link that leaves the product. */
function RepoLink({ repo, className }: { repo: Repo; className?: string }) {
  return (
    <span className={cn("text-fg-body inline-flex items-center gap-1.5 font-semibold", className)}>
      {repo.name}
      <ExternalLinkIcon size={13} className="text-fg-meta" />
    </span>
  );
}

function Revoked() {
  return (
    <p className="text-coral flex flex-wrap items-center gap-x-1.5 text-caption">
      Vibe can no longer read this repository — the GitHub App was removed.
    </p>
  );
}

/* ── the header, which every treatment answers too ─────────────────── */

function Header({ metrics }: { metrics: readonly [string, string][] }) {
  return (
    <Surface level="card" padding="md">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className="bg-fg text-app rounded-card flex size-12 shrink-0 items-center justify-center font-bold">
            GH
          </span>
          <div className="min-w-0">
            <h3 className="text-fg text-title font-semibold">GitHub connected</h3>
            <p className="text-fg-muted mt-1 text-body">
              Vibe Business is connected to @TobiB1505.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          {metrics.map(([value, label]) => (
            <span key={label} className="flex items-baseline gap-2">
              <b className="text-fg text-title font-semibold tabular-nums">{value}</b>
              <span className="text-fg-meta text-caption">{label}</span>
            </span>
          ))}
          <span className={cn(buttonClasses({ variant: "secondary" }), "whitespace-nowrap")}>
            <SettingsIcon size={15} />
            Manage connection
          </span>
        </div>
      </div>
    </Surface>
  );
}

/* ── A · the table, repaired ───────────────────────────────────────── */

function TreatmentA() {
  return (
    <div className="flex flex-col gap-5">
      <Header
        metrics={[
          ["7", "Repositories"],
          ["4", "Private"],
        ]}
      />
      <Surface level="panel" padding="none" className="overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-fg-meta text-caption">
              <th scope="col" className="px-5 py-3 font-medium">
                Repository
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Product
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Connection
              </th>
              <th scope="col" className="px-5 py-3 text-right font-medium whitespace-nowrap">
                Connected
              </th>
            </tr>
          </thead>
          <tbody>
            {REPOS.map((repo) => (
              <tr key={repo.name} className="border-line-2 border-t">
                <td className="px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Tile repo={repo} />
                    <div className="min-w-0">
                      <RepoLink repo={repo} className="text-body" />
                      {repo.revoked && <Revoked />}
                    </div>
                  </div>
                </td>
                <td className="text-fg-body px-5 py-3.5 text-body font-medium whitespace-nowrap">
                  {repo.product}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <State repo={repo} />
                    <Branch repo={repo} />
                  </div>
                </td>
                <td className="text-fg-muted px-5 py-3.5 text-right text-caption whitespace-nowrap">
                  {repo.connected}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </div>
  );
}

/* ── B · one row, no grid ──────────────────────────────────────────── */

function TreatmentB() {
  return (
    <div className="flex flex-col gap-5">
      <Header
        metrics={[
          ["7", "Repositories"],
          ["4", "Private"],
        ]}
      />
      <Surface level="panel" padding="none" className="divide-line-2 divide-y overflow-hidden">
        {REPOS.map((repo) => (
          <div key={repo.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
            <Tile repo={repo} />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
              <RepoLink repo={repo} className="text-body" />
              <span className="text-fg-meta text-caption">{repo.product}</span>
            </div>
            <Branch repo={repo} />
            <State repo={repo} />
            <span className="text-fg-meta w-14 text-right text-caption">{repo.connected}</span>
            {repo.revoked && (
              <div className="basis-full ps-12">
                <Revoked />
              </div>
            )}
          </div>
        ))}
      </Surface>
    </div>
  );
}

/* ── C · grouped by product ────────────────────────────────────────── */

function TreatmentC() {
  return (
    <div className="flex flex-col gap-5">
      <Header
        metrics={[
          ["7", "Repositories"],
          ["4", "Private"],
        ]}
      />
      <div className="flex flex-col gap-3">
        {REPOS.map((repo) => (
          <Surface key={repo.name} level="panel" padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="text-fg text-body font-semibold">{repo.product}</span>
              <span className="text-fg-meta text-caption">connected {repo.connected}</span>
            </div>
            <div className="border-line-2 bg-well flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-3">
              <Tile repo={repo} />
              <span className="min-w-0 flex-1">
                <RepoLink repo={repo} className="text-body" />
                <span className="text-fg-meta ms-2 font-mono text-meta">{repo.owner}</span>
              </span>
              <Branch repo={repo} />
              <State repo={repo} />
            </div>
            {repo.revoked && (
              <div className="border-line-2 border-t px-5 py-3">
                <Revoked />
              </div>
            )}
          </Surface>
        ))}
      </div>
    </div>
  );
}

/* ── D · a card per repository ─────────────────────────────────────── */

function TreatmentD() {
  return (
    <div className="flex flex-col gap-5">
      <Header
        metrics={[
          ["7", "Repositories"],
          ["4", "Private"],
        ]}
      />
      <div className="flex flex-col gap-3">
        {REPOS.map((repo) => (
          <Surface key={repo.name} level="card" padding="md">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3.5">
                <Tile repo={repo} />
                <div className="min-w-0">
                  <RepoLink repo={repo} className="text-lead" />
                  <p className="text-fg-meta mt-0.5 font-mono text-meta">
                    {repo.owner}/{repo.name}
                  </p>
                </div>
              </div>
              <State repo={repo} />
            </div>
            {repo.revoked && (
              <div className="mt-3">
                <Revoked />
              </div>
            )}
            <div className="border-line-2 text-fg-meta mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-caption">
              <span className="text-fg-body font-medium">{repo.product}</span>
              <Branch repo={repo} />
              <span className="ms-auto flex items-center gap-1.5">
                {repo.private && <LockIcon size={13} />}
                connected {repo.connected}
              </span>
            </div>
          </Surface>
        ))}
      </div>
    </div>
  );
}

type Treatment = {
  key: string;
  name: string;
  claim: string;
  cost: string;
  render: () => React.ReactNode;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "table",
    name: "A · Die Tabelle, repariert",
    claim:
      "Die Form bleibt, die Befunde verschwinden: „Products“ raus, weil die Zahl nicht ehrlich zu berechnen ist. Datum als Tag statt als voller Zeitstempel, damit die Spalte nicht mehr umbricht. Kein zweiter Pfeil pro Zeile — das Produkt ist der Link. Und die GitHub-Adresse trägt die externe Marke, die dieses Produkt an jedem anderen externen Link schon verlangt.",
    cost:
      "Die Tabelle wird trotzdem zweimal gebaut — ab md ein Raster, darunter eine Liste. Der teuerste Befund des Audits bleibt bestehen, nur die Symptome sind weg.",
    render: TreatmentA,
  },
  {
    key: "row",
    name: "B · Eine Zeile, kein Raster",
    claim:
      "Kein <table>. Jedes Repository ist eine Zeile, die bei jeder Breite dieselbe ist — die zweite Implementierung entfällt ersatzlos. Dieselbe Dichte wie die Tabelle, aber die Spalten sind keine Spalten mehr, sondern eine Reihenfolge.",
    cost:
      "Nichts fluchtet mehr untereinander. Wer wirklich sieben Branch-Namen vergleichen will, hat es hier schwerer als in einem Raster — die Frage ist, ob das je jemand tut.",
    render: TreatmentB,
  },
  {
    key: "grouped",
    name: "C · Nach Produkt gruppiert",
    claim:
      "Die eigentliche Beziehung ist Produkt ← Repository, und die Seite kehrt sie heute um. Hier führt das Produkt, das Repository steht darunter. Damit beantwortet die Seite „welches Produkt läuft auf welchem Code“ statt „liste meine Repos“ — und die Frage, mit der jemand hierher kommt, ist meistens die erste.",
    cost:
      "Doppelt so hoch pro Eintrag, und bei 1:1 zwischen Produkt und Repository ist die Gruppe eine Gruppe von einem. Erst wenn ein Produkt zwei Repositories hat, verdient sie sich — und das kann Vibe heute nicht.",
    render: TreatmentC,
  },
  {
    key: "card",
    name: "D · Eine Karte pro Repository",
    claim:
      "Mechanismus aus „GitHub Repository Cards“ (21st.dev): eine Spalte Karten statt eines Rasters. Name und Adresse oben, alles Beiläufige in einer Fußzeile darunter. Der „No access“-Fall bekommt Platz, statt eine Tabellenzeile aufzublähen.",
    cost:
      "Am meisten Luft und am wenigsten Übersicht: vier Karten füllen den Schirm, sieben brauchen Scrollen. Für eine Verwaltungsliste ist das viel Aufwand pro Zeile.",
    render: TreatmentD,
  },
];

export function StudyRepositories({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Repositories</p>
        <h1 className="text-fg mt-3 text-headline font-semibold">
          Will diese Seite überhaupt eine Tabelle sein?
        </h1>
        <p className="text-fg-prose mt-3 max-w-[68ch] text-lead">
          Rendered in {study.name}. Sieben Zeilen, drei Links pro Zeile, zwei davon zum selben Ziel.
          Ein Raster verdient sich, wenn jemand eine Spalte hinunter vergleicht — und niemand
          vergleicht Verbindungsdaten.
        </p>
      </header>

      <div className="border-line-3 border-t pt-8">
        <p className="eyebrow text-mint">Was das Audit gefunden hat</p>
        <h2 className="text-fg mt-3 text-title font-semibold">Ein Kritischer, drei Große</h2>
        <ul className="text-fg-prose mt-4 flex max-w-[68ch] flex-col gap-2 text-caption">
          <li>
            <b className="text-coral">Kritisch</b> · Die Kopfzeile druckt{" "}
            <code className="text-fg-secondary font-mono text-ui">repositories.length</code> zweimal
            — einmal als <b className="text-fg">Products</b>. Die Zahl wird falsch, sobald jemand
            „Disconnect“ drückt.
          </li>
          <li>
            <b className="text-fg">Major</b> · Fokus ist auf Suchfeld und Sortierung unsichtbar:
            beide werfen den globalen Ring weg und ersetzen ihn durch einen Rahmen mit 26 % Alpha.
          </li>
          <li>
            <b className="text-fg">Major</b> · Drei Controls brechen bei 1440 zweizeilig um, „Manage
            connection“ auf 61px.
          </li>
          <li>
            <b className="text-fg">Major</b> · Die Liste ist <b className="text-fg">zweimal</b>{" "}
            gebaut, und die beiden sind schon uneins darüber, was in einer Zeile steht.
          </li>
        </ul>
        <p className="text-fg-muted mt-4 max-w-[68ch] text-caption">
          Alle vier Behandlungen unten lösen den Kritischen gleich — die Kachel verschwindet, weil
          die Zahl hier nicht ehrlich zu berechnen ist. Der Fokus-Befund gehört in{" "}
          <code className="text-fg-secondary font-mono text-ui">list-controls.tsx</code> und ist von
          der Form unabhängig. Die anderen zwei fallen je nach Antwort anders aus.
        </p>
      </div>

      {TREATMENTS.map((treatment) => (
        <section key={treatment.key} className="border-line-3 mt-10 border-t pt-8">
          <h2 className="text-fg text-title font-semibold">{treatment.name}</h2>
          <p className="text-fg-prose mt-3 max-w-[70ch] text-caption">{treatment.claim}</p>
          <p className="text-fg-muted mt-2 max-w-[70ch] text-caption">
            <b className="text-fg-secondary">Kosten:</b> {treatment.cost}
          </p>
          <div className="mt-6">{treatment.render()}</div>
        </section>
      ))}
    </div>
  );
}
