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
  /**
   * Whether this server refuses requests for a hostname it was not told about.
   *
   * True for every Vite-based server. Next.js has no such gate, and marking it
   * anyway would set a variable its process ignores.
   */
  hostGated?: true;
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
    hostGated: true,
  },
  {
    frameworkId: "astro",
    profile: "astro_dev_v1",
    binary: "node_modules/.bin/astro",
    args: (port) => ["dev", "--host", "0.0.0.0", "--port", String(port)],
    hostGated: true,
  },
  // Last, deliberately. Astro, Nuxt and SvelteKit are Vite servers and declare
  // `vite` alongside their own id, so any earlier position would start the bare
  // Vite server for an application that has a framework-aware one.
  {
    frameworkId: "vite",
    profile: "vite_dev_v1",
    binary: "node_modules/.bin/vite",
    args: (port) => ["--host", "0.0.0.0", "--port", String(port)],
    hostGated: true,
  },
];

/**
 * The environment that lets a server answer for the hostname Vibe gave it.
 *
 * ## Why this exists at all
 *
 * Vite ≥ 5.4.12 refuses any request whose `Host` is not in
 * `server.allowedHosts`, with `403 Blocked request.` — and a sandbox serves the
 * application on a hostname the repository has never heard of. Astro, Nuxt and
 * SvelteKit inherit it, because all of them *are* Vite servers.
 *
 * ## Why an environment variable and not a config edit
 *
 * Writing `allowedHosts` into the customer's `vite.config` would mean Vibe
 * editing repository content to make its own preview work, on a tree it is
 * about to serve publicly. Vite reads the value from the environment instead:
 *
 * ```js
 * if (process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS && Array.isArray(server.allowedHosts))
 * ```
 *
 * Comma-separated, and discarded only if it contains `\`, `"` or `'` — which a
 * hostname does not. So Vibe names the host it issued itself, and the
 * repository stays untouched.
 *
 * ## Why depending on a private variable is acceptable here
 *
 * The leading underscores say Vite does not promise it. The reason that is a
 * tolerable dependency rather than a hidden one: if it ever stops working —
 * removed upstream, an older Vite, an `allowedHosts` that is not an array — the
 * health probe now carries the same hostname and the preview fails loudly as
 * `preview_host_rejected`. The failure mode of this bet is a named refusal, not
 * a silent lie, which is the property that made it worth taking.
 *
 * Empty for a server with no host gate: Next.js has none, and an environment
 * variable set for a process that ignores it is noise in a diff.
 */
export function previewServerEnvironmentFor(
  frameworks: readonly string[],
  host: string,
): Record<string, string> {
  const server = DEV_SERVERS.find((candidate) => frameworks.includes(candidate.frameworkId));
  if (!server || !server.hostGated) return {};

  return { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: host };
}

/**
 * The preview profile for an application, or `null` when none can start it.
 *
 * Deliberately absent, and each for its own reason:
 *
 *  - **SvelteKit.** Its own binary is `vite`, so it matches the Vite row and
 *    gets a working server; it has no row of its own because there is no
 *    separate command to name.
 *  - **Remix.** `remix dev` and the Vite plugin are two different servers behind
 *    one framework id. Ambiguous is not a thing to resolve by picking.
 *  - **Express, NestJS, Angular, and every non-Node framework.** No development
 *    server Vibe can name without reading repository configuration.
 *
 * ## Why Vite is here now
 *
 * It was held back with this reasoning, which was right: Vite ≥ 5.4.12 refuses
 * requests whose `Host` is not in `server.allowedHosts`, the health probe
 * reached the server over loopback so it *passed*, and the customer's URL
 * answered "Blocked request." — a row recording `running` for a page nobody can
 * open, which is the failure rule 69 names.
 *
 * What was wrong was the plan for settling it: *dogfood a Vite preview and
 * decide*. There was no Vite preview to dogfood, because there was no row. The
 * question could not be asked until the thing being questioned existed.
 *
 * So it was settled by reading Vite's own source instead. Both halves are now
 * closed — {@link previewServerEnvironmentFor} tells the server its hostname,
 * and the probe asks under that hostname, so a preview that would have lied
 * fails as `preview_host_rejected`. Astro shipped one sprint carrying this
 * defect; the same two changes repair it.
 */
export function previewProfileForFrameworks(
  frameworks: readonly string[],
  options: { moduleLinker?: "node_modules" | "pnp" | null } = {},
): PreviewProfile | null {
  // Under Plug'n'Play there is no `node_modules/.bin/`, so every binary in the
  // table above is absent — the server would fail to start, not fail to serve.
  // Validation is unaffected, so this costs the preview and nothing else.
  if (options.moduleLinker === "pnp") return null;

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
