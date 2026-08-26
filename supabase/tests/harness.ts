import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

/**
 * The real-PostgreSQL schema-authority harness (VB-001 M1, ADR 0056 §5).
 *
 * ## Why this is not the concurrency harness
 *
 * `src/modules/credits/concurrency/` deliberately drives everything through
 * PostgREST, because the invariants it proves are about code that must express
 * itself in what PostgREST can say. The invariants here are the opposite: role
 * switching (`set local role authenticated`), privilege catalogs, transaction
 * boundaries and trigger context. PostgREST can express none of them, so a
 * proof through it would be a proof about something else.
 *
 * ## Why this is not `pnpm test`
 *
 * It needs PostgreSQL binaries on the path. A unit suite that silently requires
 * a database is a unit suite people stop running — the same reasoning
 * `vitest.concurrency.config.mts` records for keeping Docker out of `pnpm test`.
 *
 * ## Where it may run
 *
 * Nowhere but a cluster it created itself. There is no connection string to
 * point somewhere else and no environment variable that could redirect it: the
 * harness runs `initdb` into a fresh temporary directory, starts that cluster
 * on a unix socket, and destroys it afterwards. Reaching a deployed database is
 * not forbidden here, it is unexpressible.
 */

const PG_BIN_CANDIDATES = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin"];

function pgBin(): string {
  const found = PG_BIN_CANDIDATES.find((dir) => existsSync(join(dir, "initdb")));
  if (!found) {
    throw new Error(
      `No PostgreSQL server binaries found in ${PG_BIN_CANDIDATES.join(", ")}. ` +
        `This suite provisions its own cluster and cannot run without them.`,
    );
  }
  return found;
}

/**
 * `initdb` refuses to run as root, which is the normal case in a container.
 * When we are root, everything runs as the unprivileged `postgres` account
 * instead; otherwise it runs as the current user and no `su` is involved.
 */
function asServerUser(bin: string, command: string): string {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!isRoot) return execFileSync("sh", ["-c", `PATH=${bin}:$PATH ${command}`]).toString();
  return execFileSync("su", ["postgres", "-c", `PATH=${bin}:$PATH ${command}`]).toString();
}

export type Cluster = {
  /** Runs SQL and returns unaligned, tuples-only rows. Throws on error. */
  sql: (statements: string) => string;
  /** Runs SQL expecting failure; returns the error text. Throws if it succeeds. */
  sqlExpectingError: (statements: string) => string;
  stop: () => void;
};

/** Roles and schemas the platform supplies and the migrations assume exist. */
const PLATFORM_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant anon, authenticated, service_role to postgres;

create schema auth;
create schema storage;
grant usage on schema auth, storage to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb,
  created_at timestamptz not null default now()
);
create function storage.foldername(name text) returns text[] language sql immutable as $fn$
  select string_to_array(name, '/')
$fn$;

-- The wide platform default on \`public\`, which ADR 0043's grant migration
-- restates and this repository has not yet revoked. Reproduced so the privilege
-- assertions measure the deployed situation rather than a tidier one.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/**
 * Provisions a cluster, applies the platform stub and then every migration in
 * `supabase/migrations` in filename order — the same order `supabase db push`
 * uses, each file in its own transaction, which is what lets a migration use
 * `LOCK TABLE`.
 */
export function startCluster(repoRoot: string): Cluster {
  const bin = pgBin();
  const dataDir = mkdtempSync(join(tmpdir(), "vibe-m1-pg-"));
  const socketDir = mkdtempSync(join(tmpdir(), "vibe-m1-sock-"));
  const port = 5000 + Math.floor(Math.random() * 4000);

  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (isRoot) {
    execFileSync("chown", ["-R", "postgres:postgres", dataDir]);
    execFileSync("chmod", ["1777", socketDir]);
  }

  asServerUser(bin, `initdb -U postgres -A trust -D ${dataDir}`);
  asServerUser(
    bin,
    `pg_ctl -D ${dataDir} -o "-p ${port} -k ${socketDir} -c listen_addresses=''" ` +
      `-l ${dataDir}/server.log -w start`,
  );

  const psql = (args: string[], input: string): { out: string; err: string; ok: boolean } => {
    const file = join(socketDir, "stmt.sql");
    writeFileSync(file, input);
    try {
      const out = execFileSync(
        join(bin, "psql"),
        ["-h", socketDir, "-p", String(port), "-U", "postgres", "-v", "ON_ERROR_STOP=1", ...args, "-f", file],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return { out, err: "", ok: true };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      return { out: e.stdout ?? "", err: e.stderr ?? "", ok: false };
    }
  };

  const sql = (statements: string): string => {
    const result = psql(["-tA"], statements);
    if (!result.ok) throw new Error(`SQL failed:\n${result.err}\n--- statements ---\n${statements}`);
    return result.out.trim();
  };

  const sqlExpectingError = (statements: string): string => {
    const result = psql(["-tA"], statements);
    if (result.ok) {
      throw new Error(`Expected failure but the statements succeeded:\n${statements}\n${result.out}`);
    }
    return result.err.trim();
  };

  sql(PLATFORM_STUB);

  const migrations = join(repoRoot, "supabase", "migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    const body = readFileSync(join(migrations, file), "utf8");
    const result = psql(["-1", "-q"], body);
    if (!result.ok) throw new Error(`Migration ${file} failed:\n${result.err}`);
  }

  return {
    sql,
    sqlExpectingError,
    stop: () => {
      try {
        asServerUser(bin, `pg_ctl -D ${dataDir} -m immediate -w stop`);
      } catch {
        // A cluster that already died is the outcome we wanted anyway.
      }
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(socketDir, { recursive: true, force: true });
    },
  };
}
