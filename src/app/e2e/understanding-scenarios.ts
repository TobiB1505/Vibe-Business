import { assembleProfile } from "@/modules/product-understanding/assemble";
import { buildUnderstandingPack, understandingEvidenceIds } from "@/modules/product-understanding/evidence";
import type { ProductProfile } from "@/modules/product-understanding/schema";
import { validateUnderstanding } from "@/modules/product-understanding/validate";
import { normalizeUnderstandingOutput } from "@/modules/product-understanding/wire-schema";
import {
  buildModelOutput,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
  FIXED_NOW,
} from "@/modules/product-understanding/test-support";
import { buildUnderstandingView, type UnderstandingView } from "@/modules/product-understanding/view";

/**
 * Product understanding in a real browser (CORE-1 §51, §53, §54).
 *
 * ## Why this needs a browser at all
 *
 * The sprint's central claim is about what a person *reads first* and how it
 * *feels*, and neither is a property of a data structure. `buildHeadline`
 * returning "I understand what you built." proves the string exists; it does
 * not prove a founder sees it before a list of capabilities, that a logo
 * renders rather than breaking, or that none of it overflows a 375px screen.
 *
 * The fixtures are built by running the **real** pipeline stages — evidence
 * pack, normalization, validation, assembly — over the same snapshots the unit
 * tests use. So a rule that changes in the domain changes what the browser
 * sees, rather than a hand-written view model drifting quietly away from it.
 */

function profile(options: { synthesized: boolean; liveProduct: boolean }): ProductProfile {
  const sources = {
    repository: fakeRepositorySnapshot(),
    liveProduct: options.liveProduct ? fakeLiveSnapshot() : null,
    signedInProduct: null,
  };

  let synthesis = null;
  if (options.synthesized) {
    const known = understandingEvidenceIds(buildUnderstandingPack(sources));
    const normalized = normalizeUnderstandingOutput(
      buildModelOutput(
        options.liveProduct
          ? {}
          : {
              // With no live product, a response citing live evidence would be
              // correctly discarded — so the fixture cites what was sent.
              understanding: { evidenceIds: ["repo.routes.summary"] },
              shortDescription: { evidenceIds: ["repo.framework.nextjs"] },
              name: { evidenceIds: ["repo.name"] },
              mainPurpose: { evidenceIds: ["repo.routes.summary"] },
              mainPromise: { evidenceIds: ["repo.routes.summary"] },
              primaryAudience: { evidenceIds: ["repo.surface.dashboard_app"] },
              problemSolved: { evidenceIds: ["repo.routes.summary"] },
              tone: { value: null, confidence: "not_found", evidenceIds: [] },
            },
      ),
    );
    if (!normalized.ok) throw new Error("understanding fixture did not normalize");
    const validated = validateUnderstanding(normalized.data, known);
    if (!validated.ok) throw new Error("understanding fixture did not validate");
    synthesis = validated.understanding;
  }

  return assembleProfile({
    ...sources,
    synthesis,
    corrections: {},
    provider: options.synthesized ? "anthropic" : null,
    model: options.synthesized ? "claude-haiku-4-5-20251001" : null,
    promptVersion: options.synthesized ? "product-understanding-prompt-v1" : null,
    generatedAt: FIXED_NOW,
  });
}

export type UnderstandingFixture = {
  view: UnderstandingView;
  synthesized: boolean;
  confirmedAt: string | null;
};

export const E2E_UNDERSTANDING_SCENARIOS = {
  /** The wow screen: both sources, a model ran, nothing confirmed yet. */
  understanding_ready: (): UnderstandingFixture => {
    const built = profile({ synthesized: true, liveProduct: true });
    return { view: buildUnderstandingView(built, true), synthesized: true, confirmedAt: null };
  },

  /** After "Yes, that's my product" — the confirm controls are gone. */
  understanding_confirmed: (): UnderstandingFixture => {
    const built = profile({ synthesized: true, liveProduct: true });
    return {
      view: buildUnderstandingView(built, true),
      synthesized: true,
      confirmedAt: "2026-08-15T13:00:00.000Z",
    };
  },

  /**
   * Partial failure (CORE-1 §43): the code was read, the public product was
   * not, and the model call never happened. The screen must still be useful
   * and must say what is missing without blaming anyone.
   */
  understanding_partial: (): UnderstandingFixture => {
    const built = profile({ synthesized: false, liveProduct: false });
    return { view: buildUnderstandingView(built, false), synthesized: false, confirmedAt: null };
  },
} as const;

export type E2eUnderstandingScenario = keyof typeof E2E_UNDERSTANDING_SCENARIOS;

export function isE2eUnderstandingScenario(value: string): value is E2eUnderstandingScenario {
  return value in E2E_UNDERSTANDING_SCENARIOS;
}
