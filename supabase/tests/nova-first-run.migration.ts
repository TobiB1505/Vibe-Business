import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The two first-run columns, and the two CHECKs that keep them honest.
 *
 * ## Why this needs a real PostgreSQL
 *
 * Because what is at risk is not TypeScript. A unit test can prove the write
 * path passes `'skipped'`; only the database can prove that `'later'` is
 * refused, that the default really is `'unseen'` on a row nobody wrote it to,
 * and that a workflow answer cannot be recorded for a project Nova never
 * introduced herself to. Those are the three claims the migration makes, and
 * all three are made in SQL.
 *
 * The additive half matters too: this table already carries rows for every
 * project that has onboarded. A migration that added a `not null` column
 * without a default, or a CHECK that an existing row violates, would fail on
 * deploy rather than here — so the first test writes a row the old way and
 * asserts it survives.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let userId: string;
let label = 0;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  userId = db.sql(
    `with i as (insert into auth.users (email) values ('nova@fixture.test') returning id) select id from i;`,
  );
}, 300_000);

afterAll(() => db?.stop());

/** A project with an onboarding row written the way every existing one was. */
function onboardedProject(): string {
  label += 1;
  const projectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${userId}', 'nova${label}')` +
      ` returning id) select id from i;`,
  );
  db.sql(
    `insert into public.project_onboarding (project_id, state) values ('${projectId}', 'connect_source');`,
  );
  return projectId;
}

function novaColumns(projectId: string): { introduced: string; workflow: string } {
  const row = db.sql(
    `select coalesce(nova_introduced_at::text, '<null>') || '|' || nova_workflow_status
       from public.project_onboarding where project_id = '${projectId}';`,
  );
  const [introduced, workflow] = row.split("|");
  return { introduced, workflow };
}

describe("the columns arrive without disturbing what is already there", () => {
  it("lets a row be written exactly as it was before them", () => {
    const projectId = onboardedProject();

    expect(novaColumns(projectId).introduced).toBe("<null>");
  });

  /**
   * The default is what makes this migration deployable against a table that
   * already has rows: a `not null` column with no default would abort, and a
   * nullable one would leave "has not been asked" and "was asked" sharing a
   * representation, which is the thing this column exists to separate.
   */
  it("starts every project at unseen rather than at nothing", () => {
    const projectId = onboardedProject();

    expect(novaColumns(projectId).workflow).toBe("unseen");
  });
});

describe("the workflow status is a closed vocabulary", () => {
  it.each(["explained", "skipped"])("accepts %s", (status) => {
    const projectId = onboardedProject();
    db.sql(
      `update public.project_onboarding
         set nova_introduced_at = now(), nova_workflow_status = '${status}'
         where project_id = '${projectId}';`,
    );

    expect(novaColumns(projectId).workflow).toBe(status);
  });

  it("refuses a value nobody declared", () => {
    const projectId = onboardedProject();

    const error = db.sqlExpectingError(
      `update public.project_onboarding
         set nova_introduced_at = now(), nova_workflow_status = 'later'
         where project_id = '${projectId}';`,
    );

    expect(error).toContain("project_onboarding_nova_workflow_status_check");
  });

  /**
   * Introduced first, so this isolates the vocabulary constraint. Without it
   * the ordering constraint below rejects the row too, and the test would pass
   * while proving something else — which is what it did on its first run.
   */
  it("refuses an empty string, which is the shape a dropped value takes", () => {
    const projectId = onboardedProject();
    db.sql(
      `update public.project_onboarding set nova_introduced_at = now()
         where project_id = '${projectId}';`,
    );

    const error = db.sqlExpectingError(
      `update public.project_onboarding set nova_workflow_status = ''
         where project_id = '${projectId}';`,
    );

    expect(error).toContain("project_onboarding_nova_workflow_status_check");
  });
});

describe("the workflow cannot be answered before Nova has spoken", () => {
  /**
   * The ordering constraint. Both writes are Nova's own and they happen in
   * order, so a row that recorded an answer without an introduction would mean
   * the write path had a bug — and the database is where that is caught rather
   * than where it is stored.
   */
  it.each(["explained", "skipped"])("refuses %s with no introduction", (status) => {
    const projectId = onboardedProject();

    const error = db.sqlExpectingError(
      `update public.project_onboarding set nova_workflow_status = '${status}'
         where project_id = '${projectId}';`,
    );

    expect(error).toContain("project_onboarding_nova_workflow_needs_introduction");
  });

  it("allows unseen with no introduction, which is where every project starts", () => {
    const projectId = onboardedProject();
    db.sql(
      `update public.project_onboarding set nova_workflow_status = 'unseen'
         where project_id = '${projectId}';`,
    );

    expect(novaColumns(projectId).workflow).toBe("unseen");
  });

  /**
   * Withdrawing the introduction would strand an answer that was really given.
   * The constraint reads in both directions, and this is the direction nobody
   * writes on purpose.
   */
  it("refuses to unset the introduction while an answer stands", () => {
    const projectId = onboardedProject();
    db.sql(
      `update public.project_onboarding
         set nova_introduced_at = now(), nova_workflow_status = 'explained'
         where project_id = '${projectId}';`,
    );

    const error = db.sqlExpectingError(
      `update public.project_onboarding set nova_introduced_at = null
         where project_id = '${projectId}';`,
    );

    expect(error).toContain("project_onboarding_nova_workflow_needs_introduction");
  });
});

describe("what the row still refuses", () => {
  /** The table's existing rules are untouched by an additive migration. */
  it("still requires a completed onboarding to carry its timestamp", () => {
    const projectId = onboardedProject();

    const error = db.sqlExpectingError(
      `update public.project_onboarding set state = 'complete'
         where project_id = '${projectId}';`,
    );

    expect(error).toContain("project_onboarding_complete_has_timestamp");
  });
});
