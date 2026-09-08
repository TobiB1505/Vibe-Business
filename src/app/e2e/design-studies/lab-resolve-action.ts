"use server";

import type { FounderInputFormState } from "@/components/founder-input/founder-input-card";

/**
 * The action the lab does not have.
 *
 * Answering a founder input writes a durable resolution and unblocks a paused
 * run. Nothing here is paused and nothing may be written, so this reports what
 * it is rather than succeeding quietly — a control that pretended to work is
 * the one lie a design sheet can tell without anybody noticing.
 *
 * It is a real server action and not a plain function because a server
 * component cannot hand a callback to a client one. That constraint is the
 * shape of the real boundary, which is the point: in production Nova's own
 * route supplies the resolution action, exactly as the agent route does today.
 */
export async function labResolveAction(): Promise<FounderInputFormState> {
  return { ok: false, message: "Nothing to answer here — this is the design lab." };
}
