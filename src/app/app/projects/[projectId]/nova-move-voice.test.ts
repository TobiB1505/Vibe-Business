import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Move render path cannot spend, asserted against its source.
 *
 * The same contract `nova-audit-voice.test.ts` holds the audit screen to, and
 * it exists for the same reason: ADR 0086's fifth condition — no provider call
 * from the read or render path — is the only one of the five that no type or
 * database constraint can enforce. A render that imported the generator would
 * compile, deploy, and bill a founder once per visit.
 */

const APP = join(process.cwd(), "src/app/app/projects/[projectId]");
const FILES = ["nova-move-voice.tsx", join("plan", "page.tsx")];

function code(file: string): string {
  return readFileSync(join(APP, file), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the plan screen reads Nova's sentence and cannot generate one", () => {
  it.each(FILES)("%s never reaches the generator", (file) => {
    const body = code(file);

    expect(body).not.toContain("ensureNovaVoiceMessage");
    expect(body).not.toContain("speakNovaMessage");
    expect(body).not.toContain("speakAfterOperation");
  });

  it.each(FILES)("%s obtains no AI provider", (file) => {
    const body = code(file);

    expect(body).not.toContain("@/modules/ai/provider");
    expect(body).not.toContain("@/modules/ai/anthropic");
    expect(body).not.toContain("createAnthropicProvider");
  });

  /** Nor a service-role client, which is what could write the ledger. */
  it.each(FILES)("%s obtains no service-role client", (file) => {
    expect(code(file)).not.toContain("@/lib/supabase/service");
  });

  it("reads through the one function that resolves an identity to a sentence", () => {
    expect(code(join("plan", "page.tsx"))).toContain("readNovaMoveVoice");
  });
});

describe("the component chooses between nothing", () => {
  it("renders read.message without branching on where it came from", () => {
    const body = code("nova-move-voice.tsx");

    expect(body).toContain("read.message");
    expect(body).not.toMatch(/read\.source\s*===/);
    expect(body).not.toContain("fallbackReason");
  });

  it("reports the source as data rather than as a difference", () => {
    expect(code("nova-move-voice.tsx")).toContain("data-nova-voice-source={read.source}");
  });

  /** No sentence is typed into JSX: a sentence no value test sweeps is the one
   *  that would eventually promise something. */
  it("holds no prose of its own", () => {
    const literalProse = /(?:>|\}\s)\s*[A-Z][a-z]+[^<{}]{12,}</g;

    /* Proved live first. */
    const planted = '<p className="x">This moves your default branch and runs your CI.</p>';
    expect(planted.match(literalProse)).not.toBeNull();

    const body = code("nova-move-voice.tsx")
      .replace(/^import[\s\S]*?;$/gm, " ")
      .replace(/\s+/g, " ");

    expect(body.match(literalProse) ?? []).toEqual([]);
  });
});

describe("the page shows nothing about a Move Nova never saw", () => {
  it("renders the message only for a resolved identity", () => {
    expect(code(join("plan", "page.tsx"))).toContain("novaMoveVoice?.resolved &&");
  });

  /** No top Move, nothing to say — and nothing read either. */
  it("does not read when the set is empty", () => {
    expect(code(join("plan", "page.tsx"))).toContain("topRankedMove");
  });
});
