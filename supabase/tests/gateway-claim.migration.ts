import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-016 — the Agent Gateway's request ceiling holds when requests overlap.
 *
 * ## What is here
 *
 * The counter's behaviour and its privileges, against real PostgreSQL. What is
 * **not** here is a concurrency test — see the last block for why, and for
 * where the property actually lives.
 *
 * ## And why the privileges are asserted here
 *
 * Because a counter a Data API caller can increment is a way to exhaust
 * somebody else's authorization, and because sprint 0106 shipped a revoke with
 * no compensating grant and the caller failed open in silence. Reading the ACL
 * back is what caught that, not a behavioural test — so both are here.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let counter = 0;

/** One agent run, and the id of the run row rather than the project's. */
function agentRun(): string {
  counter += 1;
  db.sql(`select public.build_lifecycle_fixture('gwclaim${counter}');`);
  return db.sql(
    `select id from public.agent_execution_runs order by created_at desc limit 1;`,
  ).trim();
}

/** One claim, made as the role the gateway route actually connects as. */
function claimAs(runId: string, role = "service_role"): string {
  return db
    .sqlLast(
      `begin; set local role ${role};` +
        ` select coalesce(public.claim_gateway_request('${runId}')::text, 'NULL'); commit;`,
    )
    .trim();
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("claiming a request", () => {
  it("returns the count it wrote, one higher each time", () => {
    const run = agentRun();

    expect(claimAs(run)).toBe("1");
    expect(claimAs(run)).toBe("2");
    expect(claimAs(run)).toBe("3");
  });

  it("starts every run at zero claims", () => {
    const run = agentRun();

    expect(
      db.sql(`select gateway_requests_started from public.agent_execution_runs where id = '${run}';`).trim(),
    ).toBe("0");
  });

  it("answers nothing for a run that does not exist", () => {
    // The gateway treats this as a refusal. A claim that silently succeeded
    // against no row would forward Vibe's key on behalf of nothing.
    expect(claimAs("00000000-0000-0000-0000-000000000000")).toBe("NULL");
  });

  it("counts one run without touching another", () => {
    const mine = agentRun();
    const theirs = agentRun();

    claimAs(mine);
    claimAs(mine);

    expect(
      db.sql(`select gateway_requests_started from public.agent_execution_runs where id = '${theirs}';`).trim(),
    ).toBe("0");
  });
});

describe("what this file does not prove", () => {
  /**
   * **Concurrency is not tested here, and the first version of this file
   * pretended otherwise.**
   *
   * It ran two claims inside one transaction and called that "overlapping".
   * Checked the way everything else in this session is checked — by planting
   * the defect — a deliberately broken `set col = (select col + 1 from …)`
   * passed it unchanged, because sequential statements each see the previous
   * one's effect whatever the expression looks like. The assertion could not
   * have failed for the reason it named.
   *
   * The harness runs one `psql` per call, synchronously, so it cannot hold one
   * transaction open while another blocks on its row lock — which is the only
   * arrangement that would distinguish the two implementations.
   *
   * What is proven is split across two places, and neither is this claim:
   *
   *  - `col = col + 1` inside one `UPDATE` is atomic under a row lock by
   *    construction. There is no read-then-write to lose, which is why the
   *    function is shaped that way rather than tested into that shape.
   *  - The decision that matters is the *route's*: it forwards on what the
   *    claim returned, not on the total it read beforehand. That is a property
   *    of `src/`, and `route.test.ts` asserts it — a claim landing past the
   *    ceiling refuses while the stale read still says there is room.
   *
   * This test keeps the weakest true statement of the pair: successive claims
   * return distinct increasing numbers, which rules out a function that
   * returns a constant or forgets earlier claims.
   */
  it("gives successive claims distinct increasing numbers", () => {
    const run = agentRun();

    const both = db.sqlLast(
      `begin; set local role service_role;` +
        ` select string_agg(c::text, ',') from (` +
        `   select public.claim_gateway_request('${run}') as c` +
        `   union all` +
        `   select public.claim_gateway_request('${run}')` +
        ` ) claims; commit;`,
    );

    expect(both.trim().split(",").sort()).toEqual(["1", "2"]);
  });
});

describe("who may claim", () => {
  it("is the privileged caller and nobody else", () => {
    const acl = db.sql(
      `select coalesce(has_function_privilege('anon', p.oid, 'execute')::text, '?') || '|' ||` +
        ` has_function_privilege('authenticated', p.oid, 'execute')::text || '|' ||` +
        ` has_function_privilege('service_role', p.oid, 'execute')::text` +
        ` from pg_proc p join pg_namespace n on n.oid = p.pronamespace` +
        ` where n.nspname = 'public' and p.proname = 'claim_gateway_request';`,
    );

    expect(acl.trim()).toBe("false|false|true");
  });

  it("runs as its caller and not as its owner", () => {
    // `SECURITY INVOKER`, stated in the migration and asserted here: a
    // `DEFINER` function on this table would hand its owner's reach to whoever
    // could reach the function.
    expect(
      db.sql(
        `select prosecdef::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace` +
          ` where n.nspname = 'public' and p.proname = 'claim_gateway_request';`,
      ).trim(),
    ).toBe("false");
  });

  it("pins its search path", () => {
    expect(
      db.sql(
        `select array_to_string(proconfig, ',') from pg_proc p` +
          ` join pg_namespace n on n.oid = p.pronamespace` +
          ` where n.nspname = 'public' and p.proname = 'claim_gateway_request';`,
      ).trim(),
    ).toBe('search_path=""');
  });
});

/* ---------------------------------------------------------------------------
 * The spend the ceiling is measured against (PERF-002)
 * ------------------------------------------------------------------------ */

/**
 * `sum_agent_run_usage` replaced a read that transferred every usage row the
 * run had written, on every forwarded request. Two things about it are
 * load-bearing and neither is the aggregation itself:
 *
 *  - **A failed call still counts.** A stream that dies after the provider has
 *    emitted tokens was billed for them (VB-016), and a ceiling that ignored
 *    those rows would let a loop of late failures spend real money unnoticed.
 *  - **A run with no rows answers zero**, not nothing. The caller reads the
 *    first row of the result; a function that returned none would leave both
 *    numbers undefined and hand the run its whole budget back.
 */
function usageRow(runId: string, status: string, outputTokens: number | null): void {
  db.sql(
    `insert into public.ai_usage_events (operation, provider, model, status, job_id, output_tokens)` +
      ` values ('agentic_execution', 'anthropic', 'test-model', '${status}', '${runId}',` +
      ` ${outputTokens === null ? "null" : outputTokens});`,
  );
}

/** Both numbers, as the gateway reads them. */
function usageOf(runId: string): string {
  return db
    .sqlLast(
      `begin; set local role service_role;` +
        ` select spent_output_tokens || '|' || forwarded_requests` +
        ` from public.sum_agent_run_usage('${runId}'); commit;`,
    )
    .trim();
}

describe("summing one run's gateway spend", () => {
  it("answers zero for a run that has forwarded nothing", () => {
    expect(usageOf(agentRun())).toBe("0|0");
  });

  it("adds up the tokens and counts the calls", () => {
    const run = agentRun();
    usageRow(run, "succeeded", 1_000);
    usageRow(run, "succeeded", 250);

    expect(usageOf(run)).toBe("1250|2");
  });

  it("counts a failed call's tokens, because the provider still billed them", () => {
    const run = agentRun();
    usageRow(run, "succeeded", 1_000);
    usageRow(run, "failed", 4_000);

    expect(usageOf(run)).toBe("5000|2");
  });

  it("counts a call that reported no tokens as a request, not as spend", () => {
    const run = agentRun();
    usageRow(run, "failed", null);

    expect(usageOf(run)).toBe("0|1");
  });

  it("sums one run without seeing another's", () => {
    const mine = agentRun();
    const theirs = agentRun();
    usageRow(mine, "succeeded", 100);
    usageRow(theirs, "succeeded", 9_000);

    expect(usageOf(mine)).toBe("100|1");
  });
});

describe("who may read that spend", () => {
  it("is the privileged caller and nobody else", () => {
    const acl = db.sql(
      `select coalesce(has_function_privilege('anon', p.oid, 'execute')::text, '?') || '|' ||` +
        ` has_function_privilege('authenticated', p.oid, 'execute')::text || '|' ||` +
        ` has_function_privilege('service_role', p.oid, 'execute')::text` +
        ` from pg_proc p join pg_namespace n on n.oid = p.pronamespace` +
        ` where n.nspname = 'public' and p.proname = 'sum_agent_run_usage';`,
    );

    expect(acl.trim()).toBe("false|false|true");
  });

  it("runs as its caller, and pins its search path", () => {
    expect(
      db.sql(
        `select prosecdef::text || '|' || array_to_string(proconfig, ',') from pg_proc p` +
          ` join pg_namespace n on n.oid = p.pronamespace` +
          ` where n.nspname = 'public' and p.proname = 'sum_agent_run_usage';`,
      ).trim(),
    ).toBe('false|search_path=""');
  });
});
