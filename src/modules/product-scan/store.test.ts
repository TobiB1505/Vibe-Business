import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { PRODUCT_SCAN_EVENT_LIMIT } from "./schema";
import { appendProductScanEvent, appendProductScanEvents, getProductScanEvents } from "./store";

/**
 * Appending the scan timeline (PERF-008).
 *
 * The callers append in runs — a step walks a finding list — and one append
 * was four sequential round trips: verify the run, look for the key, read the
 * tail sequence, insert. At the table's own cap that was up to 96 round trips
 * inside a workflow step, while the browser polls the same operation every 1.8
 * seconds and watches the timeline fill one row at a time.
 *
 * What the batch must not lose is why those round trips existed: a durable
 * replay must not duplicate the timeline, and the cap is the database's.
 */

const OPERATION = "operation_1";
const PROJECT = "project_1";
const USER = "user_1";

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

function event(key: string) {
  return {
    eventKey: key,
    type: "finding" as const,
    phase: "code" as const,
    source: "repository" as const,
    title: `finding ${key}`,
  };
}

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
  db.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "product_scan",
    status: "running",
  });
});

async function append(keys: string[]) {
  return appendProductScanEvents(client(), {
    operationId: OPERATION,
    projectId: PROJECT,
    userId: USER,
    events: keys.map(event),
  });
}

describe("appending a run of events", () => {
  it("writes them in order, numbered from one", async () => {
    await append(["a", "b", "c"]);

    const stored = await getProductScanEvents(client(), {
      projectId: PROJECT,
      operationId: OPERATION,
    });

    expect(stored.map((entry) => entry.eventKey)).toEqual(["a", "b", "c"]);
    expect(stored.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it("continues the numbering of a run that already has events", async () => {
    await append(["a", "b"]);
    await append(["c"]);

    const stored = await getProductScanEvents(client(), {
      projectId: PROJECT,
      operationId: OPERATION,
    });

    expect(stored.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  /**
   * The property the per-event existence check existed for. A workflow step
   * that is replayed appends the same run again, and the timeline a customer
   * is watching must not grow a second copy of it.
   */
  it("adds nothing on a replay of the same run", async () => {
    await append(["a", "b", "c"]);
    const second = await append(["a", "b", "c"]);

    expect(second).toEqual([]);
    expect(
      (await getProductScanEvents(client(), { projectId: PROJECT, operationId: OPERATION })).length,
    ).toBe(3);
  });

  it("writes only what is new when a replay carries more than it did before", async () => {
    await append(["a", "b"]);
    const added = await append(["a", "b", "c"]);

    expect(added.map((entry) => entry.eventKey)).toEqual(["c"]);
    expect(added[0].sequence).toBe(3);
  });

  it("stops at the cap rather than letting the database refuse", async () => {
    const keys = Array.from({ length: PRODUCT_SCAN_EVENT_LIMIT + 5 }, (_, index) => `k${index}`);

    await append(keys);

    const stored = await getProductScanEvents(client(), {
      projectId: PROJECT,
      operationId: OPERATION,
    });

    expect(stored).toHaveLength(PRODUCT_SCAN_EVENT_LIMIT);
    expect(stored.at(-1)?.sequence).toBe(PRODUCT_SCAN_EVENT_LIMIT);
  });

  it("writes nothing for an operation that is not this project's scan", async () => {
    const written = await appendProductScanEvents(client(), {
      operationId: OPERATION,
      projectId: "someone_else",
      userId: USER,
      events: [event("a")],
    });

    expect(written).toEqual([]);
  });

  it("asks nothing of the database for an empty run", async () => {
    await append([]);

    expect(recorder.reads).toEqual([]);
  });

  /**
   * The point of the change, stated as a count: two reads for the whole run —
   * verify the operation, then read what is already there — plus the one
   * insert, rather than three reads and an insert per event.
   */
  it("reads twice however long the run is", async () => {
    await append(["a", "b", "c", "d", "e", "f", "g", "h"]);

    expect(recorder.reads).toEqual(["operation_runs", "product_scan_events"]);
  });

  it("reads exactly as often for one event as for twenty", async () => {
    await append(["only"]);
    const forOne = recorder.reads.length;

    recorder.reads.length = 0;
    db = new FakeDatabase();
    db.seed("operation_runs", {
      id: OPERATION,
      project_id: PROJECT,
      user_id: USER,
      operation_type: "product_scan",
      status: "running",
    });
    await append(Array.from({ length: 20 }, (_, index) => `many${index}`));

    expect(recorder.reads.length).toBe(forOne);
  });
});

describe("appending a single event still behaves as it did", () => {
  it("returns the event it wrote", async () => {
    const written = await appendProductScanEvent(client(), {
      operationId: OPERATION,
      projectId: PROJECT,
      userId: USER,
      event: event("only"),
    });

    expect(written?.eventKey).toBe("only");
    expect(written?.sequence).toBe(1);
  });

  it("returns the event it already wrote when a step is replayed", async () => {
    const first = await appendProductScanEvent(client(), {
      operationId: OPERATION,
      projectId: PROJECT,
      userId: USER,
      event: event("only"),
    });
    const again = await appendProductScanEvent(client(), {
      operationId: OPERATION,
      projectId: PROJECT,
      userId: USER,
      event: event("only"),
    });

    expect(again).toEqual(first);
  });
});
