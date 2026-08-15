"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import type { OutcomeCheckStatus } from "@/modules/outcome-verification/schema";
import type { OutcomeCard, OutcomeCheckLine } from "@/modules/outcome-verification/view";
import {
  checkProductionOutcomeAction,
  readProductionOutcomeAction,
  type OutcomeActionState,
} from "./outcome-actions";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * The Outcome section (Sprint 12A §29–§34).
 *
 * ## The three rows this panel exists to keep apart
 *
 * ```
 * Merged              ✅          delivery — the branch moved (Sprint 11C)
 * Production outcome  ✅/partial/not observed
 * Business impact     Not measured
 * ```
 *
 * The third row is the one that earns the panel. A user who has just watched a
 * merge succeed and a green tick appear will read "it worked" as "the business
 * is better", and nothing else on this screen contradicts that. So the ladder
 * is rendered on every terminal state, and `businessImpactMeasured` is a field
 * on the server's card rather than a string in this file, so it cannot be
 * dropped in a redesign (§33).
 *
 * ## The word that is never rendered
 *
 * `Deployed`. Vibe reads no deployment API. Observing the expected public
 * behaviour is *consistent with* the new build being live; it is not evidence of
 * it, and it carries no provenance for which commit is serving (§3, §34).
 *
 * ## Failed checks are never hidden
 *
 * A card that showed only its passing lines would turn a partial outcome into a
 * verified one by omission — which is exactly the misreading this sprint is
 * built around (§31).
 */

const CHECK_MARK: Record<OutcomeCheckStatus, string> = {
  passed: "✓",
  failed: "✕",
  // Deliberately neither a tick nor a cross. "We did not see it" is a third
  // thing, and rendering it as a failure would blame a product that may simply
  // not have finished deploying (§22).
  not_observed: "–",
  error: "!",
};

const CHECK_TONE: Record<OutcomeCheckStatus, string> = {
  passed: "text-emerald-400",
  failed: "text-amber-300",
  not_observed: "text-zinc-500",
  error: "text-zinc-500",
};

const CHECK_SUFFIX: Record<OutcomeCheckStatus, string> = {
  passed: "",
  failed: "",
  not_observed: " · not observed",
  // Says whose problem it was. A check that could not be read is a fact about
  // Vibe's observation, not about the customer's product (§23).
  error: " · Vibe could not check this",
};

function localTime(iso: string): string {
  // Deterministic across server and client — see format-datetime.ts. Falls
  // back to the raw value so an unparseable timestamp is visible rather than
  // silently blank.
  return formatTimestamp(iso) ?? iso;
}

function CheckList({ checks }: { checks: OutcomeCheckLine[] }) {
  if (checks.length === 0) return null;

  return (
    <ul className="space-y-0.5" data-testid="outcome-checks">
      {checks.map((check) => (
        <li key={check.checkId} className={`text-sm ${CHECK_TONE[check.status]}`}>
          <span aria-hidden="true">{CHECK_MARK[check.status]}</span>{" "}
          {check.label}
          {CHECK_SUFFIX[check.status]}
        </li>
      ))}
    </ul>
  );
}

/**
 * Delivery / product outcome / business impact, side by side (§33).
 *
 * Rendered for every terminal state rather than only the successful one,
 * because the row a user most needs on a `partial` is the same row they need on
 * a `verified`: the one saying nobody has measured whether this helped.
 */
function OutcomeLadder({
  productOutcome,
  businessImpact,
}: {
  productOutcome: string;
  /**
   * What the measurement domain currently says (Sprint 12B §33).
   *
   * Defaulted to "Not measured" rather than required, so the row survives a
   * caller that forgets it — and so this file still contains the literal that
   * Sprint 12A's assertions are written against. The default is also the
   * truthful answer for every project today.
   */
  businessImpact?: string;
}) {
  return (
    <dl className="space-y-1 rounded-md border border-zinc-800 p-3" data-testid="outcome-ladder">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-zinc-500">Merged</dt>
        <dd className="text-xs text-emerald-400">Yes</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-zinc-500">Production outcome</dt>
        <dd className="text-xs text-zinc-300">{productOutcome}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-zinc-500">Business impact</dt>
        {/* Not "pending" and not "0%". When nothing has been measured this
            says so plainly; when something has, it says what was observed —
            never a claim that the change caused it (Sprint 12B §33, §43). */}
        <dd className="text-xs text-zinc-500">{businessImpact ?? "Not measured"}</dd>
      </div>
    </dl>
  );
}

/** Restated wherever an outcome is visible, for the same reason the merge panel restates its own. */
function NotDeployed() {
  return (
    <p className="text-xs text-zinc-500">
      This verifies the intended public product behavior. It does not measure business impact, and
      Vibe has not verified a deployment.
    </p>
  );
}

export function OutcomePanel({
  projectId,
  preparedChangeId,
  card,
  businessImpactLabel,
}: {
  projectId: string;
  preparedChangeId: string;
  card: OutcomeCard;
  /** The business measurement's own short answer, for the ladder (Sprint 12B §33). */
  businessImpactLabel?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<OutcomeActionState>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [live, setLive] = useState<OutcomeCard | null>(null);

  const current = live ?? card;

  // Nothing to render at all when the change has not been merged. The merge
  // panel directly above already explains that gate, and a second component
  // narrating it would be noise (§29).
  const hidden = current.state === "unavailable" && current.failureMessage === null;

  const observing = current.state === "observing";

  const poll = useCallback(async () => {
    const next = await readProductionOutcomeAction(projectId, preparedChangeId);
    setLive(next);
    // Only when the answer actually changed. A refresh every fifteen seconds
    // for fifteen minutes would re-render the whole project page ~60 times to
    // learn nothing.
    if (next.state !== current.state) router.refresh();
  }, [projectId, preparedChangeId, current.state, router]);

  useEffect(() => {
    if (!observing) return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (!cancelled) void poll();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [observing, poll]);

  function check() {
    setPending(true);
    startTransition(async () => {
      setState(await checkProductionOutcomeAction(projectId, preparedChangeId));
      router.refresh();
      setPending(false);
    });
  }

  if (hidden) return null;

  return (
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <h4 className="text-sm font-medium text-zinc-200">Outcome</h4>

      {current.state === "not_started" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">Merged</p>
          <p className="text-sm text-zinc-400">Not yet verified in production</p>
          <p className="text-xs text-zinc-500">
            Vibe can check whether the intended change appears on your public product
            {current.publicOrigin ? (
              <>
                {" at "}
                <code className="text-zinc-300">{current.publicOrigin}</code>
              </>
            ) : null}
            . This reads public pages only, and changes nothing.
          </p>
          <button
            type="button"
            onClick={check}
            disabled={pending || !current.canVerify}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
          >
            Check production outcome
          </button>
        </div>
      ) : current.state === "observing" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">Checking production…</p>
          <p className="text-sm text-zinc-400">
            Vibe is checking whether the intended change appears on your public product.
          </p>
          {/* No percentage. Nobody knows how long somebody else's deployment
              takes, and a bar sitting at 60% would teach people to distrust it. */}
          <p className="text-xs text-zinc-500">
            Production may take a few minutes to update. Vibe will keep looking
            {current.windowEndsAt ? ` until ${localTime(current.windowEndsAt)}` : " for a short while"}.
            You can leave this page.
          </p>
          {current.checks.length > 0 && <CheckList checks={current.checks} />}
        </div>
      ) : current.state === "verified" ? (
        <div className="space-y-2">
          <p className="text-sm text-emerald-400">Production outcome verified</p>
          <CheckList checks={current.checks} />
          {current.observedAt && (
            <p className="text-xs text-zinc-500">Observed at {localTime(current.observedAt)}</p>
          )}
          <OutcomeLadder productOutcome="Verified" businessImpact={businessImpactLabel} />
          <NotDeployed />
        </div>
      ) : current.state === "partial" ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-300">Partially observed</p>
          {/* Every check, passing and not. Hiding the failures is how a partial
              outcome quietly becomes a verified one (§31). */}
          <CheckList checks={current.checks} />
          {current.observedAt && (
            <p className="text-xs text-zinc-500">Observed at {localTime(current.observedAt)}</p>
          )}
          <OutcomeLadder productOutcome="Partially observed" businessImpact={businessImpactLabel} />
          <NotDeployed />
        </div>
      ) : current.state === "not_observed" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">Not observed within verification window</p>
          <p className="text-sm text-zinc-400">
            Vibe did not observe the expected production behavior within 15 minutes.
          </p>
          <CheckList checks={current.checks} />
          {/* Deliberately does not say "deployment failed": Vibe reads no
              deployment API and does not know why (§22, §32). And it offers no
              remerge, revalidate, rebuild or redeploy — there is no hidden
              recovery here (§32, CLAUDE.md rule 60). */}
          <p className="text-xs text-zinc-500">
            This does not mean a deployment failed. Vibe does not read your hosting provider, so it
            cannot say why the behavior was not visible.
          </p>
          <OutcomeLadder productOutcome="Not observed" businessImpact={businessImpactLabel} />
        </div>
      ) : current.state === "failed" ? (
        <div className="space-y-2">
          {/* "Vibe could not check" — a statement about Vibe, never about the
              customer's product (§23). */}
          <p className="text-sm text-amber-300">Vibe could not check the production outcome</p>
          {current.failureMessage && <p className="text-sm text-zinc-400">{current.failureMessage}</p>}
          <p className="text-xs text-zinc-500">
            This says nothing about whether your product behaves as intended — only that Vibe could
            not observe it.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Not available</p>
          {current.failureMessage && <p className="text-xs text-zinc-500">{current.failureMessage}</p>}
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-red-400">{state.message}</p>}
    </section>
  );
}
