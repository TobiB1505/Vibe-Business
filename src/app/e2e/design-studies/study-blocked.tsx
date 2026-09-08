import type { ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { priceDisplayFor } from "@/components/ui/credit-price";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import { NovaPresence } from "@/components/nova/nova-presence";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import {
  deriveNovaFocus,
  type FocusCandidateKind,
  type NovaFocusFacts,
} from "@/modules/nova/focus";
import { buildNovaHomeView, novaControlLabel, type NovaHomeEntry } from "@/modules/nova/home-view";
import type { Study } from "./studies";

/**
 * The ten ways Vibe can be stopped, told apart (S0, blocked track).
 *
 * ## The finding this answers
 *
 * `study-moments` put all twenty-one candidates on one page, and the blocked
 * tier read as ten rows of the same thing: same pill, same sentence weight,
 * same green control. The domain knows they are not the same thing — it
 * separates observation from inference, it prices three of the recoveries
 * differently, and it sends one of them out of the product entirely — and none
 * of that reached the screen.
 *
 * A crash and a guard doing its job currently look identical. That is the
 * defect. What follows is four treatments, and each of the four is a
 * distinction the code already makes.
 *
 * ## 1 — The connection is gone
 *
 * `source_disconnected` is not one blocker among ten; it is the precondition
 * for the other nine. `focus.ts` ranks it first for exactly that reason: *with
 * no source there is nothing to read, nothing to build and nothing to merge
 * into.* So it does not get a row. It takes the surface, and everything it
 * makes unreachable is shown unreachable rather than quietly omitted — a
 * founder should see what is waiting behind it.
 *
 * Its recovery also leaves the product: reconnecting is the GitHub App install
 * flow. `home-view.ts` already calls that out as the reason the control is a
 * place to go rather than a button, and the surface should say so before the
 * click rather than after it.
 *
 * ## 2 — It failed, and Vibe watched it fail
 *
 * `agent_failed`, `scan_failed`, `audit_failed`. Something ran and stopped.
 * The fact is observed, so the sentence can be flat and certain.
 *
 * What separates these three from each other is money, and it is the thing the
 * gallery row buried at the end: re-reading the product is included, and
 * re-running the audit is **35 Credits**. A founder whose audit just failed is
 * being asked to pay again for the thing that did not work. That is a real
 * moment and it deserves to be stated before the button, not beside it.
 *
 * ## 3 — It might be lost, and Vibe is guessing
 *
 * `agent_stalled`, `scan_stalled`, `audit_stalled`. `focus.ts` is explicit
 * about the difference: *a failure is something Vibe observed, and a stall is
 * something it inferred from a clock.* Drawing an inference in the same coral
 * as an observation claims a certainty the product does not have.
 *
 * So these are amber, they say how long the run has been going, and the
 * recovery carries the thing nobody thinks about until it bites: the old run
 * may still be alive, and starting another is a second attempt at a job that
 * might yet finish.
 *
 * ## 4 — Nothing broke; the situation changed
 *
 * `validation_failed` is a safety check that ran and did not pass — the system
 * working, not failing. `merge_blocked` and `repository_read_outdated` are the
 * outside world moving on: the repository advanced. None of the three is an
 * error, and all three currently wear the colour of one.
 *
 * They get the calmest treatment of the four. The founder has nothing to
 * recover from — only something to catch up with.
 *
 * ## What is not invented here
 *
 * Every sentence is `feed.ts`'s, every control label is the action catalog's,
 * every price resolves through `CostDisclosure`, and the tier comes from
 * `deriveNovaFocus` over facts that raise exactly one candidate. What this
 * study adds is *framing* — which group a moment belongs to, and the sentence
 * of context around it. Those framing lines are written here and marked as
 * such below, because a study that quietly attributed new copy to Nova would
 * be putting words in the product's mouth.
 */

const BASE: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: false, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [],
  questions: [],
  moves: [],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: false,
  repositoryReadOutdated: false,
  workspaceChoiceRequired: false,
  working: null,
};

const CHANGE = { preparedChangeId: "change_blocked", headline: "Two files changed on a branch" };

const FACTS: Record<string, NovaFocusFacts> = {
  source_disconnected: { ...BASE, sourceDisconnected: true },
  agent_failed: { ...BASE, failedOperations: { agent: true, scan: false, audit: false } },
  scan_failed: { ...BASE, failedOperations: { agent: false, scan: true, audit: false } },
  audit_failed: { ...BASE, failedOperations: { agent: false, scan: false, audit: true } },
  agent_stalled: { ...BASE, stalledOperations: { agent: true, scan: false, audit: false } },
  scan_stalled: { ...BASE, stalledOperations: { agent: false, scan: true, audit: false } },
  audit_stalled: { ...BASE, stalledOperations: { agent: false, scan: false, audit: true } },
  validation_failed: { ...BASE, changes: [{ ...CHANGE, stage: "validation_failed" }] },
  merge_blocked: { ...BASE, changes: [{ ...CHANGE, stage: "stalled" }] },
  repository_read_outdated: { ...BASE, repositoryReadOutdated: true },
};

function entryFor(kind: FocusCandidateKind): NovaHomeEntry {
  return buildNovaHomeView(deriveNovaFocus(FACTS[kind])).primary;
}

function controlLabel(entry: NovaHomeEntry): string | null {
  const control = entry.control;
  if (control.kind === "none") return null;
  return novaControlLabel(control);
}

function priceOf(entry: NovaHomeEntry) {
  const control = entry.control;
  if (control.kind !== "server_action" && control.kind !== "navigation") return null;
  return NOVA_ACTION_META[control.option.actionId].price;
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="study-measure text-caption text-fg-secondary">{children}</p>;
}

/* ── 1. The connection ────────────────────────────────────────────────── */

/**
 * What the founder cannot reach while the source is gone.
 *
 * Shown rather than omitted, and shown *unavailable* rather than merely
 * greyed: the point is that the founder understands the shape of the
 * blockage, not that the page looks emptier than it is.
 */
const UNREACHABLE = ["Read my product", "Run the audit", "Build a change", "Merge anything"];

function Disconnected({ seed }: { seed: string }) {
  const entry = entryFor("source_disconnected");
  const presence = novaPresenceState({ tier: entry.tier, phase: "idle" });

  return (
    <section className="flex flex-col gap-5 rounded-card border border-coral-line bg-coral-tint-soft p-7 max-sm:p-5">
      <div className="flex items-start gap-4">
        <NovaPresence state={presence} seed={seed} size="lg" className="max-sm:hidden" />
        <div className="flex min-w-0 flex-col gap-3">
          <Label>Connection lost</Label>
          <p className="study-measure text-headline font-semibold text-balance text-fg">
            {entry.message}
          </p>
          {/* Framing, written for this study rather than by the product. */}
          <Note>
            This is the one blocker that is not one among several. Everything else Vibe could tell
            you rests on being able to read your repository, so nothing below it can be acted on
            until this is fixed.
          </Note>
        </div>
      </div>

      <ul className="flex flex-wrap gap-2">
        {UNREACHABLE.map((item) => (
          <li
            key={item}
            className="rounded-nav border border-line-2 bg-well px-3 py-1.5 text-caption text-fg-disabled line-through"
          >
            {item}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="study-press rounded-nav bg-mint px-5 py-2.5 text-ui font-semibold text-mint-ink">
          {controlLabel(entry)}
        </span>
        {/*
          Said before the click. Reconnecting is the GitHub App install flow,
          which leaves the product — `home-view.ts` gives that as the reason
          this control is a place to go rather than a button, and a founder
          should learn it here rather than by landing on GitHub.
        */}
        <span className="text-caption text-fg-meta">Takes you to GitHub</span>
      </div>
    </section>
  );
}

/* ── 2 & 3. Failures and stalls ───────────────────────────────────────── */

function Stop({
  kind,
  seed,
  tone,
  when,
  caution,
}: {
  kind: FocusCandidateKind;
  seed: string;
  tone: "failed" | "stalled";
  /** How long it has been running. Stalls only — a failure is over. */
  when?: string;
  /** The thing a founder does not think about until it bites. */
  caution?: string;
}) {
  const entry = entryFor(kind);
  const presence = novaPresenceState({ tier: entry.tier, phase: "idle" });
  const price = priceOf(entry);
  const label = controlLabel(entry);

  const skin =
    tone === "failed"
      ? "border-coral-line bg-coral-tint-soft"
      : "border-amber-line bg-amber-tint-soft";

  return (
    <li className={`flex flex-col gap-3 rounded-card border p-5 ${skin}`}>
      <div className="flex flex-wrap items-center gap-3">
        <NovaPresence state={presence} seed={seed} size="sm" />
        <code className="font-mono text-caption text-fg-meta">{kind}</code>
        {when && <span className="ml-auto font-mono text-caption text-amber">{when}</span>}
      </div>

      <p className="study-measure text-title font-semibold text-balance text-fg">{entry.message}</p>

      {caution && <Note>{caution}</Note>}

      {label && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/*
            The price leads on a retry. A founder whose audit just failed is
            being asked to pay again for the thing that did not work, and the
            gallery put that number after the button as though it were a
            footnote.
          */}
          {/*
            Only when a price will actually appear. `agent_execution` resolves
            to a `silent` display — its cost depends on a pricing class this
            surface does not hold — so the first draft rendered the words
            "Trying again costs" with nothing after them. A dangling label is
            worse than no label, and asking `priceDisplayFor` is how the
            component itself decides.
          */}
          {price && priceDisplayFor(price).kind !== "silent" && (
            <span className="rounded-nav border border-line-3 bg-well px-3 py-1.5 text-caption text-fg-body">
              Trying again costs <CostDisclosure operation={price} />
            </span>
          )}
          <span className="study-press rounded-nav border border-mint-line bg-mint-tint-soft px-4 py-2 text-ui font-semibold text-mint">
            {label}
          </span>
        </div>
      )}
    </li>
  );
}

/* ── 4. Caught, or moved on ───────────────────────────────────────────── */

function Caught({ kind, seed, note }: { kind: FocusCandidateKind; seed: string; note: string }) {
  const entry = entryFor(kind);
  const presence = novaPresenceState({ tier: entry.tier, phase: "idle" });
  const label = controlLabel(entry);

  return (
    <li className="flex flex-col gap-3 rounded-card border border-line-2 bg-surface-2 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <NovaPresence state={presence} seed={seed} size="sm" />
        <code className="font-mono text-caption text-fg-meta">{kind}</code>
      </div>

      <p className="study-measure text-title font-semibold text-balance text-fg">{entry.message}</p>
      {entry.detail && <p className="text-caption text-fg-prose">{entry.detail}</p>}
      <Note>{note}</Note>

      {label && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="study-press rounded-nav border border-line-3 bg-surface-3 px-4 py-2 text-ui font-semibold text-fg-body">
            {label}
          </span>
          <CostDisclosure operation={priceOf(entry)} />
        </div>
      )}
    </li>
  );
}

export function StudyBlocked({ study }: { study: Study }) {
  const seed = "project_e2e";
  const glass = study.skin === "glass";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div
        className={`flex flex-col gap-3 rounded-panel border border-dashed border-line-3 p-5 ${glass ? "study-glass" : "bg-well"}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Label>Blocked</Label>
          <p className="text-title font-semibold text-fg">Ten stops, told apart</p>
        </div>
        <p className="study-measure text-caption text-fg-prose">
          In the gallery these ten read as one thing: same pill, same weight, same green control.
          The domain already separates them — observation from inference, priced recovery from free,
          in-product from outside — and none of it reached the screen.
        </p>
        <Note>
          Every sentence, label and price below is the product&rsquo;s. What this study adds is
          framing, and the framing lines are marked in the source as written here rather than by
          Nova.
        </Note>
      </div>

      {/* 1 */}
      <section className="flex flex-col gap-3">
        <Label>The precondition</Label>
        <Disconnected seed={seed} />
      </section>

      {/* 2 */}
      <section className="flex flex-col gap-3">
        <Label>It failed, and Vibe watched it fail</Label>
        <Note>
          Observed, so the sentence is flat and certain. What separates the three is what a retry
          costs — and one of them asks for 35 Credits to redo the thing that just did not work.
        </Note>
        <ul className="flex flex-col gap-3">
          <Stop kind="scan_failed" seed={seed} tone="failed" />
          <Stop kind="audit_failed" seed={seed} tone="failed" />
          <Stop kind="agent_failed" seed={seed} tone="failed" />
        </ul>
      </section>

      {/* 3 */}
      <section className="flex flex-col gap-3">
        <Label>It might be lost, and Vibe is guessing</Label>
        <Note>
          Inferred from a clock rather than observed. Amber rather than coral, because drawing an
          inference in the colour of an observation claims a certainty the product does not have.
        </Note>
        <ul className="flex flex-col gap-3">
          <Stop
            kind="scan_stalled"
            seed={seed}
            tone="stalled"
            when="running 6h"
            caution="I have not seen it fail — it has simply been going far longer than this work takes. Starting another read is a second attempt at a job that might still finish."
          />
          <Stop
            kind="audit_stalled"
            seed={seed}
            tone="stalled"
            when="running 4h"
            caution="The first audit may yet complete. If it does, you will have paid for two."
          />
          <Stop
            kind="agent_stalled"
            seed={seed}
            tone="stalled"
            when="running 9h"
            caution="The original run holds a workspace of its own, so a second one cannot damage the first — but it is a second one."
          />
        </ul>
      </section>

      {/* 4 */}
      <section className="flex flex-col gap-3">
        <Label>Nothing broke; the situation changed</Label>
        <Note>
          A guard that ran and did not pass is the system working. A repository that moved on is the
          world, not a fault. All three currently wear the colour of a crash.
        </Note>
        <ul className="flex flex-col gap-3">
          <Caught
            kind="validation_failed"
            seed={seed}
            note="A check Vibe runs on its own work caught something before it reached your branch. Nothing was written."
          />
          <Caught
            kind="merge_blocked"
            seed={seed}
            note="Your default branch moved after this change was approved, so the exact commit somebody approved is no longer what would land."
          />
          <Caught
            kind="repository_read_outdated"
            seed={seed}
            note="Nothing failed. What Vibe knows is simply older than what you have shipped since."
          />
        </ul>
      </section>
    </div>
  );
}
