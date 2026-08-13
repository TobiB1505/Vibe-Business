import type { SandboxCommand } from "@/modules/validation/commands";
import { PREVIEW_BUDGETS } from "./budgets";

/**
 * The commands a preview runs (Sprint 10B-2 §14, §17).
 *
 * ## Two commands, both Vibe's
 *
 * A preview runs exactly one server command and one probe. Neither comes from
 * the repository, from a model, or from the client — the same rule validation
 * applies to its command plan, with less room for exceptions, because a preview
 * command decides what gets served on a public URL (CLAUDE.md rule 57).
 *
 * ## Why not `pnpm start`
 *
 * It is the obvious choice and it is wrong: the `start` script's *contents* are
 * repository-controlled text. Running it would mean a repository could decide
 * what Vibe starts on an exposed port — `next dev`, a second server, an
 * inspector, anything — by editing one line of JSON. The command Vibe issues
 * has to be one Vibe wrote.
 *
 * ## Why not `npx next start`
 *
 * `npx` resolves and may fetch, and the preview runs under `deny-all` egress.
 * A command that needs the network to decide what to execute is a command whose
 * behaviour depends on something outside the artifact.
 *
 * ## What actually runs
 *
 * The `next` binary the validated install put in `node_modules/.bin`, invoked
 * directly with flags Vibe chose. That binary is still repository-controlled
 * code — it came from the customer's lockfile — and that is unavoidable and
 * fine: running the built application *is* the point, and it happens inside an
 * isolated microVM with no egress and no credentials. What matters is that the
 * *instruction* is deterministic.
 *
 * Flags verified against the current Next.js CLI reference rather than
 * recalled: `next start` takes `-p/--port` and `-H/--hostname`, and requires a
 * prior `next build` — which the validated artifact already contains, which is
 * the entire reason preview restores an artifact instead of rebuilding.
 *
 * `next dev` is never used. A development server rebuilds on demand, watches
 * the filesystem, and serves unminified code with error overlays: it would be a
 * different application from the one that was validated, which is precisely the
 * thing a preview must not be.
 */

/** Where the validated install left the framework binary. */
const NEXT_BINARY = "node_modules/.bin/next";

/**
 * The production server, bound so the sandbox's exposed port can reach it.
 *
 * `-H 0.0.0.0` is load-bearing. Next.js binds all interfaces by default today,
 * but a preview that silently became loopback-only on a future default would
 * fail its health check with no explanation — so the binding is stated rather
 * than inherited.
 */
export function previewServerCommand(): SandboxCommand {
  return {
    command: NEXT_BINARY,
    args: ["start", "-H", "0.0.0.0", "-p", String(PREVIEW_BUDGETS.port)],
  };
}

/**
 * One bounded HTTP probe of the server's root (§17).
 *
 * ## Why this runs inside the sandbox
 *
 * The alternative is for Vibe's own runtime to fetch the public preview URL.
 * That would mean the application making an outbound request to a host that is,
 * by construction, serving code Vibe did not write — for a claim this probe
 * already establishes. Probing over loopback keeps every byte of the response
 * inside the microVM: nothing to sanitize, because nothing arrives.
 *
 * Loopback is not egress, so this works under `deny-all`. That is a statement
 * about what the firewall governs — Vercel's network policy restricts traffic
 * *leaving* the sandbox — and it is the one assumption in this file that a real
 * preview will confirm or refute (10B-3).
 *
 * ## What it proves and what it does not
 *
 * It proves the server started, bound the port Vibe chose, and answered HTTP.
 * Combined with the provider issuing a route for that port, that is what
 * `preview_available` claims. It does **not** independently prove the public
 * edge is serving, and the product does not say it does.
 *
 * `-o /dev/null` discards the body: a status line is the entire signal, and
 * page content is untrusted data with no business entering a diagnostic.
 */
export function previewHealthProbeCommand(): SandboxCommand {
  const timeoutSeconds = Math.max(1, Math.ceil(PREVIEW_BUDGETS.healthProbeTimeoutMs / 1000));

  return {
    command: "curl",
    args: [
      "--silent",
      "--show-error",
      // No `--location`: a redirect is a real answer from a running server, and
      // following one would turn a probe into a small crawler.
      "--max-time",
      String(timeoutSeconds),
      "-o",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      `http://127.0.0.1:${PREVIEW_BUDGETS.port}/`,
    ],
  };
}

/**
 * Whether a probe's status line means "this application is serving".
 *
 * Anything the HTTP layer produced counts as an answer except a 5xx: a 404 at
 * the root is a running application whose author has no index route, and
 * failing a preview for it would be Vibe substituting its own opinion about the
 * customer's site map for a liveness check.
 *
 * A 5xx is different. The server answered, but the application errored, and a
 * preview URL that renders a stack trace is not a preview anyone asked for.
 */
export function healthyStatusCode(statusCode: number): boolean {
  return statusCode >= 100 && statusCode < 500;
}

/** Parses the probe's only output. Anything unparseable is not a status. */
export function parseProbeStatus(output: string): number | null {
  const match = output.trim().match(/(\d{3})\s*$/);
  if (!match) return null;

  const code = Number.parseInt(match[1], 10);
  return Number.isFinite(code) ? code : null;
}
