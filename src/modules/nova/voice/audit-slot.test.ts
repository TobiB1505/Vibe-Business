import { beforeEach, describe, expect, it } from "vitest";

import { E2E_AUDIT_SCENARIOS } from "@/app/e2e/audit-scenarios";
import { conclusionKey } from "@/modules/business-audit/conclusions";
import { findCausalClaims } from "@/modules/business-measurement/causality";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";
import { FakeDatabase, fakeSupabase, newQueryRecorder } from "@/modules/operations/test-support";
import type { QueryRecorder } from "@/modules/operations/test-support";

import { buildNovaAuditEntry } from "../feed";
import type { NovaEntry } from "../feed";
import { checkNovaMessage } from "./checks";
import {
  buildNovaAuditTemplate,
  buildNovaAuditVoicePayload,
  novaAuditVoiceIdentity,
  readNovaAuditVoice,
} from "./audit-slot";

/**
 * One audit, one reading of it.
 *
 * The risk this file is about is not that the sentence is bad. It is that the
 * voice comes to describe a slightly different audit than the panel beside it
 * — a second interpretation, drifting quietly, on the one screen a founder
 * trusts most. So the payload and the template are both derived from the
 * `nova.audit` entry the feed already builds, and the tests below are mostly
 * about that derivation holding.
 */

type NovaAuditEntry = Extract<NovaEntry, { kind: "nova.audit" }>;

const PROJECT = "11111111-1111-4111-8111-111111111111";

function entry(overrides: Partial<NovaAuditEntry> = {}): NovaAuditEntry {
  return {
    kind: "nova.audit",
    id: "audit",
    score: 62,
    stateLabel: "Taking shape",
    summary: "The product is clear, but nothing tells a visitor what it costs.",
    priority: {
      headline: "Pricing is not stated before signup",
      whyItMatters: "A visitor deciding whether to try it has no way to find the price.",
    },
    additionalPriorityCount: 2,
    strengths: [],
    ...overrides,
  };
}

describe("the template is the whole product", () => {
  it("says something without a model, always", () => {
    expect(buildNovaAuditTemplate(entry()).length).toBeGreaterThan(40);
  });

  it("names the blocker the panel names", () => {
    expect(buildNovaAuditTemplate(entry())).toContain("pricing is not stated before signup");
  });

  it("says so plainly when the audit found no blocker", () => {
    const text = buildNovaAuditTemplate(entry({ priority: null }));

    expect(text).toContain("Nothing came out as a blocker");
  });

  it("distinguishes one blocker from several", () => {
    expect(buildNovaAuditTemplate(entry({ additionalPriorityCount: 0 }))).toContain(
      "the one I would look at first",
    );
    expect(buildNovaAuditTemplate(entry({ additionalPriorityCount: 4 }))).toContain(
      "more underneath it",
    );
  });

  /** A headline that starts with an acronym or a name keeps its capital. */
  it("does not lowercase a name it drops into a sentence", () => {
    const text = buildNovaAuditTemplate(
      entry({ priority: { headline: "SEO basics are missing", whyItMatters: null } }),
    );

    expect(text).toContain("SEO basics are missing");
  });

  it("is deterministic", () => {
    expect(buildNovaAuditTemplate(entry())).toBe(buildNovaAuditTemplate(entry()));
  });
});

describe("the template obeys the same language rules as every other Nova sentence", () => {
  const TEXTS = [
    buildNovaAuditTemplate(entry()),
    buildNovaAuditTemplate(entry({ priority: null })),
    buildNovaAuditTemplate(entry({ additionalPriorityCount: 0 })),
  ];

  /** Proved live first: a sweep asserting `[]` passes just as well when broken. */
  it("claims no causes", () => {
    expect(findCausalClaims("This change caused conversions to rise.")).not.toEqual([]);

    for (const text of TEXTS) expect(findCausalClaims(text), text).toEqual([]);
  });

  it("carries no figures", () => {
    for (const text of TEXTS) expect(text, text).not.toMatch(/\d/);
  });

  it("promises no deploy, ship, publish or release", () => {
    for (const text of TEXTS) {
      expect(text, text).not.toMatch(
        /\b(pull request|deploy|deployed|ship|shipped|publish|published|release|released|go live|is live)\b/i,
      );
    }
  });

  it("calls nothing safe, correct or finished", () => {
    for (const text of TEXTS) {
      expect(text, text).not.toMatch(/\b(safe|safely|correct|guaranteed|production ready)\b/i);
    }
  });

  /**
   * The template must survive the validator that judges the model's version of
   * it. If Vibe's own sentence would be refused, the tier's fallback is a
   * sentence Vibe has decided a founder may not read.
   */
  it("would pass the validator that judges the model's version", () => {
    for (const text of TEXTS) {
      const payload = buildNovaAuditVoicePayload(entry());
      expect(
        checkNovaMessage({ message: text, allowedNumericFacts: payload.allowedNumericFacts }).ok,
        text,
      ).toBe(true);
    }
  });
});

describe("the payload is the entry, arranged", () => {
  it("carries only facts the entry already states", () => {
    const payload = buildNovaAuditVoicePayload(entry());

    expect(payload.facts.map((fact) => fact.value)).toEqual([
      "Taking shape",
      "The product is clear, but nothing tells a visitor what it costs.",
      "Pricing is not stated before signup",
      "A visitor deciding whether to try it has no way to find the price.",
    ]);
  });

  /**
   * The score is on the entry and not in the payload, so `checks.ts` rejects
   * every digit the model writes. A figure a founder acts on is rendered from
   * state beside the prose, never quoted inside it.
   */
  it("authorizes no numerals at all", () => {
    expect(buildNovaAuditVoicePayload(entry()).allowedNumericFacts).toEqual([]);
  });

  it("would refuse a model that quoted the score", () => {
    const payload = buildNovaAuditVoicePayload(entry());
    const check = checkNovaMessage({
      message: "Your business scores 62, which is a reasonable place to be starting from.",
      allowedNumericFacts: payload.allowedNumericFacts,
    });

    expect(check.ok).toBe(false);
  });

  it("names no product, so the identity cannot drift with a corrected profile", () => {
    expect(buildNovaAuditVoicePayload(entry()).productName).toBeNull();
  });

  /** A clean audit and a thin one look identical from here, and it says so. */
  it("hedges when there is no blocker", () => {
    expect(buildNovaAuditVoicePayload(entry({ priority: null })).confidence).toBe("low");
    expect(buildNovaAuditVoicePayload(entry()).confidence).toBe("high");
  });

  it("omits a missing summary rather than inventing one", () => {
    const payload = buildNovaAuditVoicePayload(entry({ summary: null }));

    expect(payload.facts.map((fact) => fact.label)).not.toContain("what the audit found");
  });
});

describe("the identity is a function of one audit", () => {
  it("is stable for the same entry", () => {
    expect(novaAuditVoiceIdentity(PROJECT, entry())).toBe(novaAuditVoiceIdentity(PROJECT, entry()));
  });

  it("moves when the audit's blocker moves", () => {
    expect(
      novaAuditVoiceIdentity(
        PROJECT,
        entry({ priority: { headline: "Something else", whyItMatters: null } }),
      ),
    ).not.toBe(novaAuditVoiceIdentity(PROJECT, entry()));
  });

  /**
   * The score is not in the payload, so a re-audit that moves only the number
   * reuses the sentence. That is correct and worth pinning: the sentence does
   * not mention the score, so regenerating it would buy nothing.
   */
  it("does not move when only the score does", () => {
    expect(novaAuditVoiceIdentity(PROJECT, entry({ score: 71 }))).toBe(
      novaAuditVoiceIdentity(PROJECT, entry()),
    );
  });

  it("is not shared between projects", () => {
    expect(novaAuditVoiceIdentity("22222222-2222-4222-8222-222222222222", entry())).not.toBe(
      novaAuditVoiceIdentity(PROJECT, entry()),
    );
  });
});

describe("what a component reads", () => {
  let db: FakeDatabase;
  let recorder: QueryRecorder;

  beforeEach(() => {
    db = new FakeDatabase();
    recorder = newQueryRecorder();
  });

  it("shows the template when nothing was ever generated", async () => {
    const read = await readNovaAuditVoice(fakeSupabase(db, recorder), {
      projectId: PROJECT,
      entry: entry(),
    });

    expect(read.message).toBe(buildNovaAuditTemplate(entry()));
    expect(read.source).toBe("template");
  });

  it("shows the stored sentence when one was", async () => {
    db.seed("nova_voice_messages", {
      identity: novaAuditVoiceIdentity(PROJECT, entry()),
      project_id: PROJECT,
      source: "voice",
      fallback_reason: null,
      message: "Pricing is the thing holding this back, and it is a small fix.",
      resolved_at: new Date().toISOString(),
    });

    const read = await readNovaAuditVoice(fakeSupabase(db, recorder), {
      projectId: PROJECT,
      entry: entry(),
    });

    expect(read.message).toBe("Pricing is the thing holding this back, and it is a small fix.");
    expect(read.source).toBe("voice");
  });

  /** A read model that writes is a render with a side effect. */
  it("writes nothing", async () => {
    await readNovaAuditVoice(fakeSupabase(db, recorder), { projectId: PROJECT, entry: entry() });

    expect(recorder.writes).toEqual([]);
  });

  /**
   * The pairing that keeps a component honest: it cannot look up one message
   * and fall back to another's words, because both come from one entry.
   */
  it("falls back to the template for the entry it looked the message up for", async () => {
    db.seed("nova_voice_messages", {
      identity: novaAuditVoiceIdentity(PROJECT, entry()),
      project_id: PROJECT,
      source: "voice",
      message: "A sentence about the old blocker.",
      resolved_at: new Date().toISOString(),
    });

    const moved = entry({ priority: { headline: "A different blocker now", whyItMatters: null } });
    const read = await readNovaAuditVoice(fakeSupabase(db, recorder), {
      projectId: PROJECT,
      entry: moved,
    });

    expect(read.message).toBe(buildNovaAuditTemplate(moved));
    expect(read.message).toContain("a different blocker now");
  });
});

describe("the entry does not depend on what the durable step declined to read", () => {
  /**
   * `speakAboutTheAudit` calls `buildBusinessBrainView` with no readings, no
   * moves and no scan timestamp. This is what makes that safe rather than
   * lucky: those inputs decorate `recentChanges` and a problem's `move`, and
   * `buildNovaAuditEntry` reads neither. Asserted against the real builder so
   * a future field that *does* depend on them fails here.
   */
  it("is identical whether or not moves and readings are supplied", () => {
    const audit = E2E_AUDIT_SCENARIOS["audit-synthesis"]();
    const synthesis = audit.synthesis;
    if (synthesis === null) throw new Error("the fixture must have a synthesis");

    const contract = {
      schemaVersion: audit.schemaVersion,
      auditVersion: audit.auditVersion,
      evidencePackVersion: audit.evidencePackVersion,
      rubricVersion: audit.rubricVersion,
      promptVersion: audit.promptVersion,
      provider: audit.provider,
      model: audit.model,
    };

    const bare = buildBusinessBrainView({
      audit,
      lastScanAt: null,
      auditReadings: [],
      movesByConclusion: {},
    });
    const full = buildBusinessBrainView({
      audit,
      lastScanAt: "2026-09-01T00:00:00.000Z",
      auditReadings: [
        { score: 40, recordedAt: "2026-08-01T00:00:00.000Z", contract },
        { score: 62, recordedAt: "2026-09-01T00:00:00.000Z", contract },
      ],
      movesByConclusion: { [conclusionKey("blocker", 0)]: 3 },
    });

    if (bare === null || full === null) throw new Error("the fixture must build a view");

    expect(buildNovaAuditEntry(bare, synthesis)).toEqual(buildNovaAuditEntry(full, synthesis));
  });

  /** And the message that follows from it, which is what actually ships. */
  it("produces the same identity and template either way", () => {
    const audit = E2E_AUDIT_SCENARIOS["audit-synthesis"]();
    const synthesis = audit.synthesis;
    if (synthesis === null) throw new Error("the fixture must have a synthesis");

    const view = buildBusinessBrainView({
      audit,
      lastScanAt: null,
      auditReadings: [],
      movesByConclusion: {},
    });
    if (view === null) throw new Error("the fixture must build a view");

    const built = buildNovaAuditEntry(view, synthesis);

    expect(novaAuditVoiceIdentity(PROJECT, built)).toMatch(/^[0-9a-f]{64}$/);
    expect(buildNovaAuditTemplate(built).length).toBeGreaterThan(40);
  });
});
