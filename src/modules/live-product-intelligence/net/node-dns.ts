import "server-only";

import { lookup } from "node:dns/promises";
import type { DnsResolver, ResolvedAddress } from "./ports";

/**
 * Node DNS adapter (Sprint 3 §5).
 *
 * Uses `lookup` rather than `resolve4`/`resolve6` on purpose: `lookup`
 * goes through the operating system resolver, which is the same path the
 * HTTP client would take. That means `/etc/hosts` entries and search
 * domains are visible to our validation instead of being invisible to it
 * — a name mapped locally to 127.0.0.1 gets classified and blocked
 * rather than silently resolving differently at connect time.
 */
export const resolveDns: DnsResolver = async (hostname: string): Promise<ResolvedAddress[]> => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));
};
