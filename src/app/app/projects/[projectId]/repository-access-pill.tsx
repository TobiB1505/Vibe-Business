import { StatusPill } from "@/components/ui/status-pill";
import { checkInstallationStillAccessible } from "@/modules/github/repositories";

/**
 * Whether Vibe can still reach the connected repository (UI-4 §3).
 *
 * ## Why this is its own component
 *
 * Answering it means minting an installation token and listing the
 * repositories it can reach — two GitHub round trips. That used to happen
 * inside the shared project context, so every route paid for it before it
 * could paint, and every route but this pill discarded the answer.
 *
 * It is now a leaf the layout streams: the workspace renders immediately and
 * this arrives when GitHub answers. Nothing else waits on it, and nothing
 * gates on it — the durable workflows re-check access for themselves before
 * they write, because a render-time answer authorizes nothing.
 *
 * The word carries the state, so colour is never the only signal — and
 * "GitHub access unavailable" stays the product's existing wording rather
 * than a friendlier, vaguer one.
 */
export async function RepositoryAccessPill({ installationId }: { installationId: number }) {
  const accessible = await checkInstallationStillAccessible(installationId);

  return (
    <StatusPill tone={accessible ? "success" : "waiting"} dot>
      {accessible ? "Connected" : "GitHub access unavailable"}
    </StatusPill>
  );
}

/**
 * What stands in the pill's place while GitHub is being asked.
 *
 * It states that the check is happening rather than guessing its outcome:
 * rendering "Connected" optimistically would be the product asserting
 * something it does not yet know.
 */
export function RepositoryAccessPillFallback() {
  return <StatusPill tone="neutral">Checking GitHub access…</StatusPill>;
}
