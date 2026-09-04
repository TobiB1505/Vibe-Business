import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The render path cannot spend, asserted against its source.
 *
 * ADR 0085's fifth condition is "no provider call from the read or render
 * path", and every other condition is enforced by a type or a database
 * constraint. This one cannot be: a render that imported the generator would
 * compile, deploy, and bill a founder once per visit. So it is enforced here,
 * over the two files that actually render Nova's audit sentence.
 *
 * The technique is `nova-ui.test.ts`'s, for the same reason: the comments in
 * those files quote the very identifiers these assertions forbid, so the
 * comments are stripped before anything is matched.
 */

const APP = join(process.cwd(), "src/app/app/projects/[projectId]");
const FILES = ["nova-audit-voice.tsx", join("health", "content.tsx")];

function source(file: string): string {
  return readFileSync(join(APP, file), "utf8");
}

/** Comments removed: what is left is what runs. */
function code(file: string): string {
  return source(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the audit screen reads Nova's sentence and cannot generate one", () => {
  /**
   * The single most expensive mistake available in this design: a render that
   * generates. It would pass every other test in the repository.
   */
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
    expect(code(join("health", "content.tsx"))).toContain("readNovaAuditVoice");
  });
});

describe("the component chooses between nothing", () => {
  /**
   * `readNovaVoiceMessage` has already decided whether the founder sees the
   * model's words or the template. A component that branched on `source`
   * would eventually treat one as better than the other, and the tier's whole
   * claim is that a founder who only ever sees the template has lost a
   * rephrasing and nothing else.
   */
  it("renders read.message without branching on where it came from", () => {
    const body = code("nova-audit-voice.tsx");

    expect(body).toContain("read.message");
    expect(body).not.toMatch(/read\.source\s*===/);
    expect(body).not.toContain("fallbackReason");
  });

  /** The source is exposed to prove which path ran, never to change the draw. */
  it("reports the source as data rather than as a difference", () => {
    expect(code("nova-audit-voice.tsx")).toContain("data-nova-voice-source={read.source}");
  });

  /**
   * The same rule every Nova component is held to: no sentence is typed into
   * JSX, because a sentence no value test sweeps is the one that would
   * eventually promise something.
   */
  it("holds no prose of its own", () => {
    const literalProse = /(?:>|\}\s)\s*[A-Z][a-z]+[^<{}]{12,}</g;

    /* Proved live first: an empty match set means nothing if the pattern is broken. */
    const planted = '<p className="x">This moves your default branch and runs your CI.</p>';
    expect(planted.match(literalProse)).not.toBeNull();

    const body = code("nova-audit-voice.tsx")
      .replace(/^import[\s\S]*?;$/gm, " ")
      .replace(/\s+/g, " ");

    expect(body.match(literalProse) ?? []).toEqual([]);
  });
});

describe("the page shows nothing about an audit Nova never saw", () => {
  /**
   * Every audit completed before this existed, and every one completed with
   * the switch off, has no row — so `resolved` is false and Business Health is
   * exactly what it was. A sentence there would be Vibe describing a moment
   * that never happened.
   */
  it("renders the message only for a resolved identity", () => {
    expect(code(join("health", "content.tsx"))).toContain("novaAuditVoice?.resolved &&");
  });
});
