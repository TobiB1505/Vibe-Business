import type { SandboxCommand } from "@/modules/validation/commands";
import { PREVIEW_BUDGETS } from "./budgets";
import type { PreviewProfile } from "./schema";

/**
 * Which development server starts which application (Stufe 4).
 *
 * ## Why this is a table and not a lookup on the validation profile
 *
 * It used to be `Record<ValidationProfile, PreviewProfile | null>`, which was
 * exactly right while both were Next.js-only: one profile meant one framework
 * meant one server command. The build contract broke that identity. A validation
 * profile now says *how a change is checked* — a locked install and the
 * repository's own scripts, which are the same commands for every framework —
 * and says nothing about what to start. Only the application's own frameworks
 * can answer that.
 *
 * So one validation profile fans out to several preview profiles, and to none
 * at all for an application whose framework has no row here.
 *
 * ## `null` is a first-class answer
 *
 * It means: **checking and merging work; there is nothing to look at.** Not
 * "this project is unsupported". A guessed start command produces a public URL
 * nobody should trust, which is worse than no URL — so a framework Vibe has no
 * server command for gets a preview-shaped silence and an honest sentence,
 * rather than `pnpm dev` and hope.
 *
 * ## Order is the correctness argument
 *
 * Every row is matched most-specific-first, because these are not mutually
 * exclusive: a Next.js application also declares `react`, a SvelteKit one also
 * declares `vite`, and a Nuxt one also declares `vue`. Matching in declaration
 * order would start the wrong server for the right reason.
 *
 * ## What has not changed
 *
 * Everything `commands.ts` argues about the one command it used to hold applies
 * to every row here: not `pnpm dev`, because the `dev` script's *contents* are
 * repository-controlled text and a repository must not decide what Vibe starts
 * on a public URL; not `npx`, because a command that needs the network to
 * decide what to execute behaves according to something outside the tree. The
 * binary is the one the install put in `node_modules/.bin`, and the
 * *instruction* is Vibe's (rule 57).
 */

type DevServer = {
  /** Framework id from the application's own manifest. */
  frameworkId: string;
  profile: PreviewProfile;
  /** Where the install put the framework binary. */
  binary: string;
  args: (port: number) => readonly string[];
};

/**
 * Binding to all interfaces is load-bearing and therefore stated.
 *
 * The sandbox exposes a port from outside the process; a server that silently
 * became loopback-only on some future default would fail its health check with
 * no explanation. Every row says which flag it uses rather than inheriting a
 * default, because the flags genuinely differ.
 */
const DEV_SERVERS: readonly DevServer[] = [
  {
    frameworkId: "nextjs",
    profile: "next_dev_v1",
    binary: "node_modules/.bin/next",
    args: (port) => ["dev", "-H", "0.0.0.0", "-p", String(port)],
  },
  {
    frameworkId: "nuxt",
    profile: "nuxt_dev_v1",
    binary: "node_modules/.bin/nuxt",
    args: (port) => ["dev", "--host", "0.0.0.0", "--port", String(port)],
  },
  {
    frameworkId: "astro",
    profile: "astro_dev_v1",
    binary: "node_modules/.bin/astro",
    args: (port) => ["dev", "--host", "0.0.0.0", "--port", String(port)],
  },
];

/**
 * The preview profile for an application, or `null` when none can start it.
 *
 * Deliberately absent, and each for its own reason:
 *
 *  - **Vite and SvelteKit.** Vite ≥ 5.4.12 refuses requests whose `Host` is not
 *    in `server.allowedHosts`, and the sandbox serves the application on a
 *    public hostname. The health probe reaches the server over loopback, so it
 *    *passes* — and the customer's URL answers "Blocked request." A row that
 *    records `running` for a page nobody can open is the failure rule 69 names,
 *    so it waits for a real preview against a real Vite project rather than for
 *    an argument. Astro shares the mechanism and is shipped because the same
 *    dogfood settles both.
 *  - **Remix.** `remix dev` and the Vite plugin are two different servers behind
 *    one framework id. Ambiguous is not a thing to resolve by picking.
 *  - **Express, NestJS, Angular, and every non-Node framework.** No development
 *    server Vibe can name without reading repository configuration.
 */
export function previewProfileForFrameworks(frameworks: readonly string[]): PreviewProfile | null {
  return DEV_SERVERS.find((server) => frameworks.includes(server.frameworkId))?.profile ?? null;
}

/**
 * The server command for an application, or `null` when none can start it.
 *
 * Resolved from the frameworks rather than from the stored profile id, so the
 * command and the profile can never describe different servers.
 */
export function previewServerCommandFor(frameworks: readonly string[]): SandboxCommand | null {
  const server = DEV_SERVERS.find((candidate) => frameworks.includes(candidate.frameworkId));
  if (!server) return null;

  return { command: server.binary, args: [...server.args(PREVIEW_BUDGETS.port)] };
}

/** Every framework a preview can be started for. Published for tests and copy. */
export const PREVIEWABLE_FRAMEWORKS: readonly string[] = DEV_SERVERS.map(
  (server) => server.frameworkId,
);
