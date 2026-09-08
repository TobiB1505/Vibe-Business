/**
 * The tools a founder might already be building with (ADR 0097).
 *
 * A closed list, and closed for a reason a free-text field would not serve:
 * the tool decides one Vibe-authored preamble sentence, and a founder typing
 * "my agent" would get a prompt written for nobody. `other` is the honest
 * member for exactly that case — it gets the tool-agnostic preamble rather
 * than a guess.
 *
 * Nothing here is a claim about what those tools can do. Vibe does not test
 * them, does not integrate with them, and does not know their versions. The
 * preamble differs only where the *shape* of the handoff differs: an agent
 * with the repository checked out is told which branch to work from, and a
 * hosted builder is not, because it has no branch.
 */
export const HANDOFF_TOOLS = ["claude_code", "codex", "cursor", "lovable", "other"] as const;
export type HandoffTool = (typeof HANDOFF_TOOLS)[number];

/** Whether the tool works against the founder's checked-out repository. */
export const TOOL_WORKS_IN_REPOSITORY: Record<HandoffTool, boolean> = {
  claude_code: true,
  codex: true,
  cursor: true,
  lovable: false,
  // Unknown, so the prompt says nothing about a branch rather than guessing
  // one. A wrong branch instruction is worse than no branch instruction.
  other: false,
};

/**
 * Why the prompt was issued — a refusal, or a reach Vibe does not have.
 *
 * `build` is the original: Vibe will not write this code, and says so. `verify`
 * is the opposite shape arriving at the same screen — Vibe *cannot reach* the
 * check. Its validation sandbox runs with no network and no credential, by
 * design, so it can never complete a real checkout or a real signup; the
 * founder's own tool has the keys, the running app and the session.
 *
 * Two words rather than one, because one of them grants something. A `build`
 * handoff is what admits a `vibe` + `product_change` step to founder
 * attestation — the single place work the agent exists to do may be closed by
 * hand — and that permission must never follow from a prompt issued to check
 * something. The database enforces the same split.
 */
export const HANDOFF_PURPOSES = ["build", "verify"] as const;
export type HandoffPurpose = (typeof HANDOFF_PURPOSES)[number];
