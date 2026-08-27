import { cn } from "@/lib/utils/cn";

/**
 * The Agent route's header (UI-19, `AgentHeader.dc.html`).
 *
 * ## Three cells, not a paragraph
 *
 * The same three facts that make an agent bearable — it works somewhere
 * private, the founder decides what is applied, and it is aligned with their
 * business — set beside the title rather than buried in prose. They are the
 * answer to the question a founder actually arrives with, and answering it
 * once at the top means the rest of the screen can be about the work.
 *
 * All three are true by construction rather than by promise: the sandbox holds
 * no credential, nothing reaches the default branch without a human approving
 * one exact commit, and the agent's context is the founder's own Product
 * Profile and Move.
 *
 * ## Why it is not the assurance strip
 *
 * `AgentAssuranceBar` says a narrower thing at a different moment — during a
 * run, when the worry is concrete and the words are about *this* run being
 * isolated. This is the standing claim about the surface. Saying both at once
 * would be the duplication; saying them at their own moments is not.
 */

const FACTS = [
  {
    key: "secure",
    title: "Secure & isolated",
    detail: "Work happens in a private environment",
    accent: true,
    icon: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  {
    key: "control",
    title: "Always under control",
    detail: "You decide what gets applied",
    accent: false,
    icon: (
      <>
        <circle cx="12" cy="7.5" r="3.5" />
        <path d="M4.5 21v-1.5a7.5 7.5 0 0 1 15 0V21" />
      </>
    ),
  },
  {
    key: "aligned",
    title: "Built for you",
    detail: "Aligned with your goals and business",
    accent: true,
    icon: (
      <>
        <path d="M12 3c.6 3.5 2.5 5.4 6 6-3.5.6-5.4 2.5-6 6-.6-3.5-2.5-5.4-6-6 3.5-.6 5.4-2.5 6-6Z" />
        <path d="M18.5 15.5c.25 1.6 1.1 2.45 2.5 2.75-1.4.3-2.25 1.15-2.5 2.75-.25-1.6-1.1-2.45-2.5-2.75 1.4-.3 2.25-1.15 2.5-2.75Z" />
      </>
    ),
  },
] as const;

/**
 * Rendered into `WorkspaceSection`'s own `actions` slot, which already places
 * it beside the title. A second heading here would give the route two `h1`s
 * and the document outline two answers to what this page is.
 */
export function AgentTrustPanel() {
  return (
    <div
      data-testid="agent-trust"
      className="rounded-panel border-line-2 bg-surface-2 flex flex-none flex-col divide-y divide-[var(--color-line-2)] border sm:flex-row sm:divide-x sm:divide-y-0"
    >
      {FACTS.map((fact) => (
        <div key={fact.key} className="flex max-w-[230px] gap-3 px-5 py-4">
          <svg
            viewBox="0 0 24 24"
            width="19"
            height="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("mt-px flex-none", fact.accent ? "text-mint" : "text-fg-secondary")}
            aria-hidden="true"
          >
            {fact.icon}
          </svg>
          <span className="flex flex-col gap-1">
            <span className="text-fg-body text-[0.8125rem] font-semibold">{fact.title}</span>
            <span className="text-fg-muted text-xs leading-relaxed">{fact.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
