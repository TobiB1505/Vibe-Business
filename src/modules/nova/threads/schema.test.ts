import { describe, expect, it } from "vitest";
import { checkedValues } from "../../operations/migration-test-support";
import { ARTIFACT_KINDS } from "../artifacts";
import { NOVA_ACTION_IDS } from "../actions";
import { OPERATION_TYPES } from "../../operations/schema";
import {
  MESSAGE_AUTHORS,
  MESSAGE_KINDS,
  MESSAGE_SUBJECT_KINDS,
  THREAD_EVENT_WORDS,
  THREAD_STATUSES,
  isArtifactKind,
  isNovaActionId,
  operationsWithThreadEvents,
} from "./schema";

/**
 * The unions and the CHECKs are the same rule, written twice.
 *
 * This repository has been bitten twice by the gap — a capability bump that
 * would have failed every INSERT while 1,376 tests stayed green, and an
 * `operation_type` the live database did not permit — which is why
 * `checkedValues` exists and why every table with an enumerated column is
 * asserted against it.
 *
 * `action_id` is deliberately **not** one of them: the migration checks its
 * *shape* rather than listing eighteen ids, because a CHECK that had to be
 * migrated for every new control is a CHECK somebody eventually widens to
 * `text`. That the id is a real one is checked here, against the catalogue
 * itself, which is the only place that knows.
 */

describe("the thread schema and the database agree", () => {
  it.each([
    ["nova_threads", "status", THREAD_STATUSES],
    ["nova_messages", "author", MESSAGE_AUTHORS],
    ["nova_messages", "kind", MESSAGE_KINDS],
    ["nova_messages", "subject_kind", MESSAGE_SUBJECT_KINDS],
    ["nova_messages", "artifact_kind", ARTIFACT_KINDS],
  ])("%s.%s", (table, column, union) => {
    expect(checkedValues(table, column).sort()).toEqual([...union].sort());
  });

  /**
   * The outcome vocabulary lives only in SQL today, because nothing writes one
   * until the action lane does (Slice 6). Asserted as a set rather than left
   * unmentioned, so the column a future `ActionOutcome` union has to match is
   * written down where that union will be built.
   */
  it("records what a pressed proposal can have turned into", () => {
    expect(checkedValues("nova_messages", "outcome").sort()).toEqual([
      "cancelled",
      "failed",
      "refused",
      "succeeded",
    ]);
  });

  it("recognises a catalogue action and refuses anything else", () => {
    expect(isNovaActionId(NOVA_ACTION_IDS[0])).toBe(true);
    expect(isNovaActionId("nova.merge_everything")).toBe(false);
    expect(isArtifactKind(ARTIFACT_KINDS[0])).toBe(true);
    expect(isArtifactKind("preview")).toBe(false);
  });
});

describe("which runs leave a memory behind", () => {
  it("decides every operation type", () => {
    expect(Object.keys(THREAD_EVENT_WORDS).sort()).toEqual([...OPERATION_TYPES].sort());
  });

  /**
   * An event stores no words, so the words have to be composed on every read —
   * which means every remembered type needs both halves. A run that ended
   * badly and had only a success sentence would either say the wrong thing or
   * say nothing, and nothing is what a founder came back to read.
   */
  it("gives every remembered run both endings", () => {
    for (const type of operationsWithThreadEvents()) {
      const words = THREAD_EVENT_WORDS[type];
      expect(words?.done.length, type).toBeGreaterThan(10);
      expect(words?.failed.length, type).toBeGreaterThan(10);
      expect(words?.done, type).not.toBe(words?.failed);
    }
  });

  /**
   * One change, one memory.
   *
   * A prepared change passes through six operations, all of which draw the same
   * review block while they run — correctly, because a founder watching wants
   * the gate. Six events in the transcript would bury the one they will
   * actually look for, which is the step that changed what their repository
   * contains.
   */
  it("remembers a merge and not the five steps around it", () => {
    expect(THREAD_EVENT_WORDS.change_merge).not.toBeNull();

    for (const type of [
      "change_preparation",
      "change_validation",
      "change_preview",
      "change_review",
      "change_outcome_verification",
    ] as const) {
      expect(THREAD_EVENT_WORDS[type], type).toBeNull();
    }
  });

  it("remembers nothing about an account being erased", () => {
    // The account is going away and the thread with it. A message in a record
    // that is about to be deleted is a record of nothing.
    expect(THREAD_EVENT_WORDS.account_erasure).toBeNull();
  });

  it("names the set for a caller that needs it", () => {
    const remembered = operationsWithThreadEvents();

    expect(remembered).toContain("business_audit");
    expect(remembered).not.toContain("preview_teardown");
    expect(remembered.length).toBeLessThan(OPERATION_TYPES.length);
  });
});
