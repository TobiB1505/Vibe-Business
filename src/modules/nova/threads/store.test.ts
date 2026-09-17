import { describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  selectsOf,
} from "../../operations/test-support";
import {
  appendMessage,
  ensureOpenThread,
  getThread,
  listThreads,
  markThreadRead,
  openNewThread,
  readThreadMessages,
} from "./store";

const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const USER = "user_1";

/**
 * The project a thread belongs to.
 *
 * `open_nova_thread` selects from `projects` — that is where the owner comes
 * from for the service role, which has no session, and it is why an
 * unresolvable project opens nothing rather than a thread nobody can reach. A
 * double that skipped it would be modelling a function that took the owner from
 * its caller, which is the thing rule 53 forbids.
 */
function seedProject(db: FakeDatabase, id = PROJECT, userId = USER): void {
  db.rows("projects").push({ id, user_id: userId, name: id });
}

async function threadWith(db: FakeDatabase, count: number) {
  seedProject(db);
  const thread = await ensureOpenThread(fakeSupabase(db), {
    projectId: PROJECT,
    userId: USER,
    title: "What to do next",
  });

  for (let i = 0; i < count; i += 1) {
    await appendMessage(fakeSupabase(db), {
      thread,
      userId: USER,
      message: { author: "nova", kind: "text", body: `turn ${i + 1}` },
    });
  }

  return thread;
}

describe("opening a project's thread", () => {
  it("opens one and then reuses it", async () => {
    const db = new FakeDatabase();
    seedProject(db);
    const first = await ensureOpenThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "What to do next",
    });
    const second = await ensureOpenThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "Something else",
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("What to do next");
    expect(db.rows("nova_threads")).toHaveLength(1);
  });

  it("opens a thread unread and empty", async () => {
    const db = new FakeDatabase();
    seedProject(db);
    const thread = await ensureOpenThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "What to do next",
    });

    expect(thread.lastReadSequence).toBe(0);
    expect(thread.lastMessageAt).toBeNull();
    expect(thread.status).toBe("open");
  });

  it("cuts a title the database would refuse", async () => {
    const db = new FakeDatabase();
    seedProject(db);
    const thread = await ensureOpenThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "x".repeat(400),
    });

    expect(thread.title.length).toBe(120);
  });
});

describe("reading one thread", () => {
  /**
   * The service-role client bypasses RLS, so rule 53 requires ownership to come
   * from a persisted row rather than from a caller's argument. Both ids are
   * filters, which is what makes a thread from another project answer null
   * instead of answering.
   */
  it("refuses a thread that belongs to another project", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 1);

    expect(
      await getThread(fakeSupabase(db), { threadId: thread.id, projectId: PROJECT }),
    ).not.toBeNull();
    expect(
      await getThread(fakeSupabase(db), { threadId: thread.id, projectId: OTHER_PROJECT }),
    ).toBeNull();
  });

  /**
   * `nova_messages` grows with use, so an unbounded read returns the first
   * thousand and `206 Partial Content` with nothing surfacing the truncation
   * (PERF-018). A conversation is read from its end, so the limit takes the
   * newest — and the caller gets them back in reading order.
   */
  it("takes the newest turns and hands them back oldest first", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 5);

    const turns = await readThreadMessages(fakeSupabase(db), { threadId: thread.id, limit: 3 });

    expect(turns.map((turn) => turn.sequence)).toEqual([3, 4, 5]);
    expect(turns.map((turn) => turn.body)).toEqual(["turn 3", "turn 4", "turn 5"]);
  });

  it("asks for the columns it maps and no more", async () => {
    const db = new FakeDatabase();
    const recorder = newQueryRecorder();
    const thread = await threadWith(db, 1);

    await readThreadMessages(fakeSupabase(db, recorder), { threadId: thread.id, limit: 50 });

    const [columns] = selectsOf(recorder, "nova_messages");
    expect(columns).toContain("sequence");
    expect(columns).not.toContain("*");
    // What the turn was answered from is never read back for display (rule 43).
    expect(columns).not.toContain("context_hash");
  });
});

describe("how far the founder has read", () => {
  it("moves the marker forward", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 3);

    await markThreadRead(fakeSupabase(db), {
      threadId: thread.id,
      projectId: PROJECT,
      sequence: 3,
    });

    expect(db.rows("nova_threads")[0].last_read_sequence).toBe(3);
  });

  /**
   * A marker that went backwards would re-announce turns somebody had already
   * seen, and two tabs settling in the wrong order is exactly how that happens.
   * The filter is in the statement rather than in a read-then-write, so two
   * writers cannot both decide they are ahead.
   */
  it("never moves it backwards", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 3);

    await markThreadRead(fakeSupabase(db), {
      threadId: thread.id,
      projectId: PROJECT,
      sequence: 3,
    });
    await markThreadRead(fakeSupabase(db), {
      threadId: thread.id,
      projectId: PROJECT,
      sequence: 1,
    });

    expect(db.rows("nova_threads")[0].last_read_sequence).toBe(3);
  });

  it("refuses a thread from another project", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 3);

    await markThreadRead(fakeSupabase(db), {
      threadId: thread.id,
      projectId: OTHER_PROJECT,
      sequence: 3,
    });

    expect(db.rows("nova_threads")[0].last_read_sequence).toBe(0);
  });
});

describe("appending a turn", () => {
  it("rebuilds a subject from the two columns it stored it in", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 0);

    const stored = await appendMessage(fakeSupabase(db), {
      thread,
      userId: USER,
      message: {
        author: "nova",
        kind: "action_proposal",
        actionId: "nova.merge_change",
        subject: { kind: "prepared_change", preparedChangeId: "change_7" },
      },
    });

    expect(stored?.subject).toEqual({ kind: "prepared_change", preparedChangeId: "change_7" });
    // Two columns, never a JSON blob: the CHECK that keeps a subject whole can
    // only see columns.
    expect(db.rows("nova_messages")[0].subject_kind).toBe("prepared_change");
    expect(db.rows("nova_messages")[0].subject_id).toBe("change_7");
  });

  it("stores the project as a subject with no id", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 0);

    await appendMessage(fakeSupabase(db), {
      thread,
      userId: USER,
      message: {
        author: "nova",
        kind: "action_proposal",
        actionId: "nova.refresh_audit",
        subject: { kind: "project" },
      },
    });

    expect(db.rows("nova_messages")[0].subject_id).toBeNull();
  });

  it("moves the thread's last message time", async () => {
    const db = new FakeDatabase();
    const thread = await threadWith(db, 1);

    expect(db.rows("nova_threads")[0].last_message_at).not.toBeNull();
    expect(thread.lastMessageAt).toBeNull();
  });
});

/**
 * A second conversation, and the list of them (ADR 0109 §1, Slice 7).
 *
 * `ensureOpenThread` and `openNewThread` answer opposite questions and both are
 * right. The first is *where does this belong* — a run finishing, a question
 * asked with nothing in progress — and it must reuse. The second is a founder
 * pressing **New chat**, which is a request for somewhere else to talk, and
 * reusing would be ignoring them.
 */
describe("starting a second conversation", () => {
  /**
   * Rewritten in the open when the empty-thread reuse moved into
   * `open_nova_thread`.
   *
   * It used to open an *empty* thread and expect a second one beside it, on the
   * old rule that **New chat** always inserts. The command has reused an empty
   * open thread since it was written — a second press means the same thing as
   * the first — and what changed is only that the decision is now made under
   * the lock rather than between two round trips. So the thread this opens
   * beside has something in it, which is the case the button is actually for.
   */
  it("opens one beside a conversation that has been used", async () => {
    const db = new FakeDatabase();
    const first = await threadWith(db, 1);

    const second = await openNewThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "New chat",
    });

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("open");
    expect(db.rows("nova_threads")).toHaveLength(2);
  });

  /**
   * The property the schema's missing unique index exists for. After a second
   * thread is opened it is where the next run event lands, because
   * `findOpenThread` takes the most recently created open thread — so a founder
   * who starts a new conversation does not watch the next thing that happens
   * get filed in the old one.
   */
  it("becomes where the next run event lands", async () => {
    const db = new FakeDatabase();
    seedProject(db);
    await ensureOpenThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "Your product",
    });

    const second = await openNewThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "New chat",
    });

    const current = await ensureOpenThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "Your product",
    });

    expect(current.id).toBe(second.id);
  });

  /**
   * The empty-thread reuse, which is *New chat* pressed twice.
   *
   * The decision moved into `open_nova_thread` when the read-then-write between
   * these two presses turned out to be the race that produced the two empty
   * threads this behaviour exists to prevent. What is asserted here is the
   * decision; the lock that makes it decisive under contention is asserted
   * against a real cluster in `nova-thread-race.migration.ts`.
   */
  it("reuses an open thread that has had nothing said in it", async () => {
    const db = new FakeDatabase();
    seedProject(db);
    const first = await openNewThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "New chat",
    });

    const second = await openNewThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "New chat",
    });

    expect(second.id).toBe(first.id);
    expect(db.rows("nova_threads")).toHaveLength(1);
  });

  it("opens a second one the moment the first has anything in it", async () => {
    const db = new FakeDatabase();
    const first = await threadWith(db, 1);

    const second = await openNewThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "New chat",
    });

    expect(second.id).not.toBe(first.id);
    expect(db.rows("nova_threads")).toHaveLength(2);
  });

  /**
   * `user_id` is not sent, and that is the point: the function takes it from
   * `auth.uid()` for a founder and from the project row for the service role.
   * Authority is the persisted relationship, never an argument (rule 53).
   */
  it("never sends an owner for the database to trust", async () => {
    const db = new FakeDatabase();
    seedProject(db);
    const recorder = newQueryRecorder();

    await openNewThread(fakeSupabase(db, recorder), {
      projectId: PROJECT,
      userId: "somebody-else",
      title: "New chat",
    });

    expect(db.rows("nova_threads")[0].user_id).toBe(USER);
    expect(recorder.reads).toContain("rpc:open_nova_thread");
  });
});

describe("listing a project's conversations", () => {
  it("returns the most recently touched first, and an untouched one last", async () => {
    const db = new FakeDatabase();
    const first = await threadWith(db, 1);
    const second = await openNewThread(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      title: "Nothing said yet",
    });

    const listed = await listThreads(fakeSupabase(db), { projectId: PROJECT, limit: 10 });

    expect(listed.map((thread) => thread.id)).toEqual([first.id, second.id]);
    expect(listed[1]?.lastMessageAt).toBeNull();
  });

  it("shows no other project's conversations", async () => {
    const db = new FakeDatabase();
    await threadWith(db, 1);
    seedProject(db, OTHER_PROJECT);
    await openNewThread(fakeSupabase(db), {
      projectId: OTHER_PROJECT,
      userId: USER,
      title: "Theirs",
    });

    const listed = await listThreads(fakeSupabase(db), { projectId: PROJECT, limit: 10 });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.projectId).toBe(PROJECT);
  });

  it("is bounded, because this table grows with use", async () => {
    const db = new FakeDatabase();
    /*
      Rows rather than presses. This claim is about the limit on the read, and
      five presses of *New chat* now resolve to one thread — correctly, because
      an empty open conversation is already somewhere to start. Going through
      the opener to set up a read's fixture would make this a test of the
      opener.
    */
    for (let index = 0; index < 5; index += 1) {
      db.rows("nova_threads").push({
        id: `thread_${index}`,
        project_id: PROJECT,
        user_id: USER,
        title: `Chat ${index}`,
        status: "open",
        created_at: db.now(),
        last_message_at: db.now(),
        last_read_sequence: 0,
      });
    }

    expect(await listThreads(fakeSupabase(db), { projectId: PROJECT, limit: 2 })).toHaveLength(2);
  });
});
