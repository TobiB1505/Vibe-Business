/**
 * What a message may point at.
 *
 * Deliberately free of `server-only` and of every import that carries it: the
 * block registry in `nova/blocks.ts` is pure data that both server and client
 * components read, and it cannot reach into the tool registry, which holds
 * Supabase reads. So the kinds live here, on their own, and both sides import
 * them from the same place.
 *
 * An artifact is a **reference to a canonical row**, never a copy of one. The
 * thread renders the row as it is now, beside the message's own date, so a Move
 * that was replanned shows as it is rather than as it was described.
 */
export const AGENT_ARTIFACT_KINDS = ["opportunity", "audit"] as const;

export type AgentArtifactKind = (typeof AGENT_ARTIFACT_KINDS)[number];

export type AgentArtifactRef = { kind: AgentArtifactKind; subjectId: string };
