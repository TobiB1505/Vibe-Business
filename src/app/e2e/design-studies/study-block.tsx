import type { ReactNode } from "react";
import { creditsToUnits } from "@/modules/credits/units";
import {
  buildBusinessBrainView,
  type BusinessBrainView,
} from "@/modules/projects/business-brain-view";
import { OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { AuditBlock } from "./audit-block";
import { Bubble, Context, Dissolving, Line, Move, RenderBlock } from "./elements";
import { E2E_AUDIT_SCENARIOS } from "../audit-scenarios";
import type { Study } from "./studies";

/**
 * The Render Block (S0, element track) — the third kind of object in a thread.
 *
 * ## What it is for
 *
 * A bubble means Nova is **saying** something. A Move means the founder can
 * **do** something. A block means Vibe **made** something, and this is where
 * it appears: an audit reading, a scan, a change, a map.
 *
 * Three kinds and none of them nests inside another. That is the same rule
 * that took the Move out of the bubble, applied one object further.
 *
 * ## The two states are one object
 *
 * A block in flight is not a placeholder standing in for a block. It is the
 * same frame, showing the work instead of the outcome, which is what lets a
 * founder watch something happen without a spinner pretending to be a screen
 * nobody can see yet.
 *
 * ## The lines that dissolve
 *
 * They are the run's own stages — `OPERATION_STAGE_LABELS[stage]`, the value
 * the executor wrote. That they may vanish is not a liberty: the event log
 * records that a run started and that it finished, and the stages between were
 * true for a moment and were never written down. A surface that kept them
 * would be inventing a history the product does not have.
 *
 * This is also the only place on the surface where anything dissolves, and it
 * holds no controls at all — not by convention, by construction.
 */

const STUDY_BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

/**
 * The audit, through the product's own fixture and view builder.
 *
 * `E2E_AUDIT_SCENARIOS` is what the audit-synthesis screen renders from, and
 * `buildBusinessBrainView` is what the Business Brain page renders from. A
 * sheet that assembled its own nine lenses would be drawing a business the
 * product never produced.
 */
function auditView(scenario: "audit-synthesis" | "audit-unscored"): BusinessBrainView {
  const audit = E2E_AUDIT_SCENARIOS[scenario]();
  const view = buildBusinessBrainView({
    audit,
    lastScanAt: audit.generatedAt,
    auditReadings: [],
    movesByConclusion: {},
    moveByConclusion: {},
    usedSignedInEvidence: true,
  });
  /* `buildBusinessBrainView` returns null for an audit it cannot read at all.
     A fixture that produced one would be a broken fixture, not a state to
     design for — so it fails loudly here rather than rendering an empty block. */
  if (!view) throw new Error(`fixture ${scenario} produced no business brain view`);
  return view;
}

/** A run part-way through, newest stage first. Real labels, real order. */
const STAGES = [
  OPERATION_STAGE_LABELS.running_ai,
  OPERATION_STAGE_LABELS.preparing,
  OPERATION_STAGE_LABELS.preflight,
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

export function StudyBlock({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Eyebrow>Element</Eyebrow>
          <p className="text-title font-semibold text-fg">The Render Block</p>
        </div>
        <Context>
          The third kind of object a thread holds. A bubble means Nova is saying something, a Move
          means you can do something, a block means Vibe made something. None of them nests inside
          another — the same rule that took the control out of the bubble, one object further.
        </Context>
        <Context>
          Square where the bubble is round, and not for decoration: the bubble is round because that
          shape already means <em>speech</em> to anybody who has used a phone. A block is not
          speech, so it takes the system&rsquo;s own panel geometry instead.
        </Context>
      </div>

      {/* ── In flight ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>While it runs</Eyebrow>
        <Context>
          The same frame, showing the work instead of the outcome. The bright line is the stage the
          executor wrote; the two behind it are the stages before it, on their way out. They may go
          because the log never kept them — it records that a run started and that it finished, and
          everything between was true for a moment and was never written down.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>I am reading your business now.</Line>
          </Bubble>
          <RenderBlock label="Business audit" index={1}>
            <Dissolving stages={STAGES} />
          </RenderBlock>
        </div>
        <Context>
          No control is inside it, and that is structural rather than a convention: the dissolving
          surface renders text and nothing else, so a button that goes away under a cursor is not
          something this design can express.
        </Context>
      </section>

      {/* ── Settled ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>When it has finished</Eyebrow>
        <Context>
          The smallest honest picture of the result, with the control beside it rather than in it.
          Not the Business Brain page shrunk — that page is a 780-pixel map and a founder who opened
          it came to read it. The geometry here is still the domain&rsquo;s: ring and angle come
          from map-view.ts, so somebody who looks at both does not see two different businesses.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>I finished reading your business.</Line>
          </Bubble>
          <RenderBlock label="Business audit" at="32m" index={1}>
            <AuditBlock view={auditView("audit-synthesis")} />
          </RenderBlock>
          <div className="max-w-[24rem]">
            <Move label="Open the business map" leavesTo="Business health" />
          </div>
        </div>
      </section>

      {/* ── Nothing could be scored ──────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>When it could not be scored</Eyebrow>
        <Context>
          The state a block would most like to fake. A null score is an em dash, never a zero and
          never a red ring — an audit that could not be scored has not scored badly (rule 44). The
          reason is rendered rather than left in the view model, which is how the Business Brain
          used to lose it.
        </Context>
        <div className={`flex flex-col gap-4 p-6 max-sm:p-4 ${panel}`}>
          <RenderBlock label="Business audit" at="2h" index={0}>
            <AuditBlock view={auditView("audit-unscored")} />
          </RenderBlock>
        </div>
      </section>

      {/* ── The three objects together ───────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The three, in one thread</Eyebrow>
        <Context>
          Speech, then what was made, then what you can do. Each is its own object at its own width,
          and the differences between them are silhouette and material rather than a label saying
          which is which.
        </Context>
        <div className={`flex flex-col gap-2.5 p-6 max-sm:p-4 ${panel}`}>
          <Bubble index={0}>
            <Line>Your pricing is the thing holding the rest back.</Line>
          </Bubble>
          <Bubble tail={false} aside index={1}>
            <Context>I read nine areas and this is the one every other one waits on.</Context>
          </Bubble>
          <RenderBlock label="Business audit" at="32m" index={2}>
            <AuditBlock view={auditView("audit-synthesis")} />
          </RenderBlock>
          <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">
            <Move label="Plan this move" operation="action_plan" balance={STUDY_BALANCE} />
            <Move label="Open the business map" leavesTo="Business health" />
          </div>
        </div>
      </section>
    </div>
  );
}
