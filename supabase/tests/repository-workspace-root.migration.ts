import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Which application in a repository its owner works on (Stufe 4).
 *
 * ## Why this runs against a real cluster
 *
 * Both halves of the guarantee are constraints the in-memory database does not
 * evaluate, and both are about a value that becomes a **sandbox working
 * directory**:
 *
 * - **Shape.** `[A-Za-z0-9._-]+` accepts two dots quite happily, so the
 *   character class alone would let `../etc` through. The application refuses
 *   an unsafe path twice over already; this is the half that holds when the
 *   application is not the writer.
 * - **Ownership, in two layers that answer different questions.**
 *   `authenticated` held no UPDATE on this table at all, withdrawn deliberately
 *   because the row's RLS policy lets the owner set *any* column — so a full
 *   grant would have made `detached_at` writable over PostgREST and the detach
 *   gate advisory. A column-level grant restores exactly the two columns a
 *   founder may set; the RLS policy still decides which rows. Both are
 *   asserted, and so is the column the grant deliberately still excludes.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let alice: { userId: string; projectId: string };
let bob: { userId: string; projectId: string };

/**
 * The statement's own output, without the transaction's echo.
 *
 * `asUser` wraps every statement in `begin; … commit;`, and psql echoes each
 * command tag — so the answer arrives between a `BEGIN`/`SET` and a `COMMIT`.
 */
function answerOf(output: string): string {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trim());
  return lines.filter((line) => !["BEGIN", "COMMIT", "SET"].includes(line)).at(-1) ?? "";
}

/** Acts as PostgREST does: the role plus that user's JWT subject. */
function asUser(userId: string, statement: string): string {
  return (
    `begin;` +
    ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
    ` set local role authenticated;` +
    ` ${statement} commit;`
  );
}

function fixture(label: string): { userId: string; projectId: string } {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");
  return { userId, projectId };
}

function chosenRootOf(projectId: string): string {
  return db.sql(
    `select coalesce(workspace_root, '<null>') from public.repository_connections
     where project_id = '${projectId}';`,
  );
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
  alice = fixture("workspace-alice");
  bob = fixture("workspace-bob");
}, 300_000);

afterAll(() => db?.stop());

describe("the shape of a working directory", () => {
  function choose(workspaceRoot: string): string {
    return `update public.repository_connections
            set workspace_root = '${workspaceRoot}', workspace_root_chosen_at = now()
            where project_id = '${alice.projectId}';`;
  }

  it.each([".", "frontend", "apps/web", "packages/ui-kit", "a.b-c/d_e"])(
    "accepts %s",
    (workspaceRoot) => {
      expect(() => db.sql(choose(workspaceRoot))).not.toThrow();
    },
  );

  it.each(["..", "../etc", "apps/../..", "a/../../b", "/etc", "apps//web", "", " ", "apps/"])(
    "refuses %s",
    (workspaceRoot) => {
      expect(() => db.sql(choose(workspaceRoot))).toThrow(
        /repository_connections_workspace_root_shape/,
      );
    },
  );
});

describe("a choice and when it was made are one fact", () => {
  it("refuses a root with no timestamp", () => {
    // Written directly rather than through the setter, which always writes
    // both: the constraint exists for a future writer that might not.
    // Indistinguishable from a default, which is the one thing a stored answer
    // must never look like: null means "not asked", not "the root was chosen".
    expect(() =>
      db.sql(`update public.repository_connections set workspace_root = 'frontend'
              where project_id = '${bob.projectId}';`),
    ).toThrow(/repository_connections_workspace_root_chosen/);
  });

  it("refuses a timestamp with no root", () => {
    expect(() =>
      db.sql(`update public.repository_connections set workspace_root_chosen_at = now()
              where project_id = '${bob.projectId}';`),
    ).toThrow(/repository_connections_workspace_root_chosen/);
  });

  it("starts as neither, because nobody has been asked", () => {
    expect(chosenRootOf(bob.projectId)).toBe("<null>");
  });
});

describe("only the owner names the application", () => {
  it("lets the owner choose", () => {
    db.sql(
      asUser(
        alice.userId,
        `update public.repository_connections
         set workspace_root = 'apps/web', workspace_root_chosen_at = now()
         where project_id = '${alice.projectId}';`,
      ),
    );

    expect(chosenRootOf(alice.projectId)).toBe("apps/web");
  });

  /*
   * The grant that is deliberately absent.
   *
   * `20260827010000` withdrew UPDATE from `authenticated` because the row's RLS
   * update policy lets the owner set *any* column — so a granted UPDATE would
   * let a caller write `detached_at` over PostgREST and walk past the detach
   * gate. The setter exists precisely so this stays true.
   */
  it("still cannot write the column the withdrawn grant was withdrawn for", () => {
    // The grant is column-level: these two, and nothing else. `detached_at` is
    // what a full UPDATE grant would have re-opened, and the detach gate would
    // have become advisory the moment it did.
    expect(() =>
      db.sql(
        asUser(
          alice.userId,
          `update public.repository_connections set detached_at = now()
           where project_id = '${alice.projectId}';`,
        ),
      ),
    ).toThrow(/permission denied for table repository_connections/);
  });

  /*
   * The assertion this file exists for.
   *
   * A working directory another account can set is a working directory another
   * account chose. The policy has no `with check`, so this passes only because
   * PostgreSQL reuses `using` for the written row — and that is precisely the
   * kind of implicit behaviour worth pinning.
   */
  it("does not let another account choose for them", () => {
    // The grant says which columns; the RLS policy says which rows. Bob holds
    // the same column grant Alice does and still matches no row of hers, so the
    // update affects nothing and reports nothing about whose it is.
    db.sql(
      asUser(
        bob.userId,
        `update public.repository_connections
         set workspace_root = 'apps/evil', workspace_root_chosen_at = now()
         where project_id = '${alice.projectId}';`,
      ),
    );

    expect(chosenRootOf(alice.projectId)).toBe("apps/web");
  });

  it("does not let another account read it either", () => {
    const visible = db.sql(
      asUser(
        bob.userId,
        `select count(*) from public.repository_connections
         where project_id = '${alice.projectId}';`,
      ),
    );

    expect(answerOf(visible)).toBe("0");
  });
});
