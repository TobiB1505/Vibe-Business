import type { SandboxCommand } from "@/modules/validation/commands";
import { PREVIEW_BUDGETS } from "./budgets";

/**
 * The commands a preview runs (Sprint 10B-2 §14, §17; Sprint 0114).
 *
 * ## Two commands, both Vibe's
 *
 * A preview runs exactly one server command and one probe. Neither comes from
 * the repository, from a model, or from the client — the same rule validation
 * applies to its command plan, with less room for exceptions, because a preview
 * command decides what gets served on a public URL (CLAUDE.md rule 57).
 *
 * ## Why not `pnpm dev`
 *
 * It is the obvious choice and it is wrong: the `dev` script's *contents* are
 * repository-controlled text. Running it would mean a repository could decide
 * what Vibe starts on an exposed port — a second server, an inspector, anything
 * — by editing one line of JSON. The command Vibe issues has to be one Vibe
 * wrote.
 *
 * ## Why not `npx next dev`
 *
 * `npx` resolves and may fetch, and the preview runs under `deny-all` egress by
 * the time this runs. A command that needs the network to decide what to
 * execute is a command whose behaviour depends on something outside the tree.
 *
 * ## Why `next dev` and not `next start`
 *
 * **Reversed by ADR 0064, and the original reasoning is preserved because it
 * was right about what it was answering.**
 *
 * ADR 0016 §7 refused `next dev` in one sentence: *"a development server
 * rebuilds on demand, watches the filesystem, and serves unminified code with
 * error overlays — a different application from the one that was validated."*
 * Every clause of that is still true. What changed is that a preview no longer
 * claims to be the validated application.
 *
 * A preview now exists to answer *what does this change look like?*, and it is
 * offered **before** validation finishes rather than after — which is the whole
 * point, because the build is validation's last step and a person was otherwise
 * waiting roughly five minutes to look at code that was already written. A
 * development server needs no build, so it can answer that question in the
 * time an install takes.
 *
 * Three consequences, stated rather than discovered:
 *
 *  - the first request compiles the route it asks for, so the health probe is
 *    also the warm-up and needs a budget that covers a cold compile;
 *  - a broken change renders Next's error overlay instead of a blank page,
 *    which for a *preview* is the better outcome — the overlay is served from
 *    the sandbox's own origin and never enters Vibe's;
 *  - `NODE_ENV` is `development`, so an application that behaves differently
 *    there behaves differently here. That is the honest cost of seeing it
 *    sooner, and `modules/validation` remains the only thing that decides
 *    whether the change is sound.
 *
 * Every argument above now lives in `dev-servers.ts`, one row per framework,
 * and every sentence in this docblock applies to each of them: the table grew,
 * the discipline did not.
 *
 * The binary is the one the install put in `node_modules/.bin`. It is
 * repository-controlled code, and that is unavoidable and fine — running the
 * customer's application *is* the point — inside a microVM with no egress and
 * no credentials. What matters is that the *instruction* is deterministic.
 */

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
 * ## Why it carries the public hostname
 *
 * A loopback probe asks a question a whole class of development server always
 * answers yes to, and that made this check structurally incapable of failing
 * for the reason it most needed to. Vite's host gate — inherited by Astro,
 * Nuxt and SvelteKit, since all four are Vite servers — reads:
 *
 * ```js
 * if (extracted.type === "ipv4" || extracted.type === "ipv6") return true;
 * if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
 * ```
 *
 * Every IP literal is allowed unconditionally. So `http://127.0.0.1:3000/`
 * passes while the customer's own URL answers `403 Blocked request.` — a
 * preview recorded as `running` for a page nobody can open.
 *
 * Sending `Host:` makes the probe ask the browser's question instead. The
 * request still never leaves the VM; only the header changed. That is the whole
 * fix, and it is why the security argument above survives it word for word.
 *
 * ## What it proves and what it does not
 *
 * It proves the server started, bound the port Vibe chose, and answered HTTP
 * **for the hostname it will actually be reached by**. Combined with the
 * provider issuing a route for that port, that is what `preview_available`
 * claims. It still does not independently prove the public edge is serving —
 * nothing inside the sandbox can — and the product does not say it does.
 *
 * Under a development server it does one more thing, and the budget has to
 * allow for it: the first request is what compiles the route, so this probe is
 * the warm-up as well as the check. A cold compile is the slow case, not a
 * failure.
 *
 * `-o /dev/null` discards the body: a status line is the entire signal, and
 * page content is untrusted data with no business entering a diagnostic. That
 * holds for the block page too — the 403 is the signal, its text is not read.
 *
 * @param host the `Host` header to send. Omitted, the probe asks as loopback,
 * which is the second half of {@link hostGateVerdict}: the two answers together
 * tell a host gate apart from an application that refuses everyone.
 */
export function previewHealthProbeCommand(host?: string): SandboxCommand {
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
      ...(host === undefined ? [] : ["--header", `Host: ${host}`]),
      "-o",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      `http://127.0.0.1:${PREVIEW_BUDGETS.port}/`,
    ],
  };
}

/**
 * Whether a 403 is the dev server refusing this *hostname*, or the application
 * refusing *everyone*.
 *
 * A 403 at the root is genuinely ambiguous, and guessing either way is wrong in
 * a different direction. An application behind authentication answers 403 to
 * anyone, and failing its preview would be Vibe substituting its own opinion
 * for a liveness check — the same mistake {@link healthyStatusCode} refuses to
 * make about a 404. A host gate answers 403 to *one* hostname and serves every
 * other caller happily.
 *
 * So the two are told apart by asking twice, which needs no body and no
 * heuristic: the same server, the same port, one request presenting the public
 * hostname and one presenting none. Different answers mean the hostname is what
 * was rejected.
 *
 * Only reached on the failure path, so the ordinary preview still costs one
 * probe.
 */
export function hostGateVerdict(input: {
  withHost: number;
  withoutHost: number | null;
}): "host_rejected" | "application_refuses" {
  if (input.withHost !== 403) return "application_refuses";
  if (input.withoutHost === null) return "application_refuses";

  // A server that answers the loopback caller and refuses the public one is
  // gating on the name, whatever it happens to answer with.
  return healthyStatusCode(input.withoutHost) && input.withoutHost !== 403
    ? "host_rejected"
    : "application_refuses";
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
