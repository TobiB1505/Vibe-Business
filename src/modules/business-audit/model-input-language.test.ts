import { describe, expect, it } from "vitest";
import { BLOCKING_VOCABULARY, DISCOURAGED_VOCABULARY } from "./customer-language";
import { buildEvidencePackV3, buildEvidencePackV4, renderEvidencePackV3 } from "./evidence-v3";
import type { BuildEvidencePackV3Input } from "./evidence-v3";
import { buildSystemPrompt } from "./prompt";
import {
  fakeAuthenticatedSnapshot,
  fakeFounderIntent,
  fakeLiveSnapshot,
  fakeProductProfile,
  fakeRepositorySnapshot,
} from "./test-support";

/**
 * The input half of the customer-language boundary (CORE-2a.2 §1).
 *
 * `checkCustomerLanguage` rejects a whole paid audit when a blocking term
 * reaches a founder-facing sentence. That is affordable only while the model
 * has never been shown the term — the sprint that built the net said so, and
 * the term "Deep Scan" then survived in the system prompt four times and in a
 * priority-1 evidence line, so the model read it on every single run and was
 * asked in the same breath not to write it. A run on 2026-09-01 wrote it, and
 * the audit was discarded after the tokens were billed.
 *
 * So the net's own vocabulary is now a property of what we send, enforced here
 * rather than in a comment. Any new blocking term must be absent from the
 * prompt, the rubric and every rendered evidence line before it can be added.
 */

function input(overrides: Partial<BuildEvidencePackV3Input> = {}): BuildEvidencePackV3Input {
  return {
    productProfile: fakeProductProfile(),
    founderIntent: fakeFounderIntent(),
    repository: fakeRepositorySnapshot(),
    liveProduct: fakeLiveSnapshot(),
    authenticatedProduct: null,
    ...overrides,
  };
}

function termsIn(text: string, terms: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term));
}

function blockingTermsIn(text: string): string[] {
  return termsIn(text, BLOCKING_VOCABULARY);
}

function renderedPack(overrides: Partial<BuildEvidencePackV3Input> = {}): string {
  return renderEvidencePackV3(buildEvidencePackV4(input(overrides)));
}

describe("the model is never shown the vocabulary its output is rejected for", () => {
  it("keeps blocking vocabulary out of the system prompt and rubric", () => {
    expect(blockingTermsIn(buildSystemPrompt())).toEqual([]);
  });

  it("keeps blocking vocabulary out of a rendered pack with no signed-in evidence", () => {
    expect(blockingTermsIn(renderEvidencePackV3(buildEvidencePackV4(input())))).toEqual([]);
  });

  it("keeps blocking vocabulary out of a rendered pack that has signed-in evidence", () => {
    const pack = buildEvidencePackV4(
      input({ authenticatedProduct: fakeAuthenticatedSnapshot() }),
    );

    expect(blockingTermsIn(renderEvidencePackV3(pack))).toEqual([]);
  });

  it("keeps blocking vocabulary out of a partial signed-in inspection", () => {
    const pack = buildEvidencePackV4(
      input({
        authenticatedProduct: fakeAuthenticatedSnapshot({
          completeness: { status: "partial", reasons: ["page_budget_reached"] },
        }),
      }),
    );

    expect(blockingTermsIn(renderEvidencePackV3(pack))).toEqual([]);
  });

  // v3 is still rebuilt for stored audits written under it, so the same
  // guarantee has to hold there — a stale pack is still model input.
  it("keeps blocking vocabulary out of the v3 pack", () => {
    const pack = buildEvidencePackV3(
      input({ authenticatedProduct: fakeAuthenticatedSnapshot() }),
    );

    expect(blockingTermsIn(renderEvidencePackV3(pack))).toEqual([]);
  });
});

/**
 * The evidence is held to the softer tier as well, and the prompt is not.
 *
 * A discouraged term costs a note rather than the audit, so the rubric is
 * allowed to name one while teaching the better phrasing — "not *your
 * conversion path is incomplete*, but…" is the whole lesson, and v9 already
 * decided that trade for the blocking tier by deleting concrete negative
 * examples instead.
 *
 * Evidence lines teach nothing. They are facts we author and hand over as data,
 * so a term that only ever arrives there is pure priming: "Deep Scan" reached
 * the model exactly this way on every run of a project that had one.
 */
describe("evidence lines are held to the softer tier too", () => {
  it("carries no discouraged vocabulary, with signed-in evidence or without", () => {
    expect(termsIn(renderedPack(), DISCOURAGED_VOCABULARY)).toEqual([]);
    expect(
      termsIn(
        renderedPack({ authenticatedProduct: fakeAuthenticatedSnapshot() }),
        DISCOURAGED_VOCABULARY,
      ),
    ).toEqual([]);
  });
});
