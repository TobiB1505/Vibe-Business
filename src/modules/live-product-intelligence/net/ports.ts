/**
 * Ports the safe fetcher talks to. Both are deliberately free of Node
 * types so the entire SSRF and crawl layer can be unit tested with plain
 * in-memory fakes and no network or DNS access (Sprint 3 §34).
 */

/**
 * Resolves a hostname to every address it currently maps to.
 *
 * Returning *all* addresses matters: a rebinding attack typically answers
 * with one public and one private address, and validating only the first
 * would wave it through.
 */
export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type TransportRequest = {
  url: URL;
  /**
   * The already-validated address the connection must be made to.
   *
   * This is the DNS-rebinding defence (Sprint 3 §5): the transport must
   * not resolve the hostname again, because a second lookup can legally
   * return a different — private — address than the one that passed
   * validation microseconds earlier. The hostname still drives the `Host`
   * header and TLS SNI so the request stays correct for the origin.
   */
  pinnedAddress: string;
  addressFamily: 4 | 6;
  timeoutMs: number;
  /** Hard ceiling enforced while the body streams in, not after buffering. */
  maxBytes: number;
  headers: Record<string, string>;
};

export type TransportResponse = {
  status: number;
  /** Header names lowercased. */
  headers: Record<string, string>;
  /** Body decoded as UTF-8, cut off at `maxBytes`. */
  body: string;
  bytesRead: number;
  /** True when the body hit `maxBytes` and was cut short. */
  truncated: boolean;
};

export type TransportFailure = "timeout" | "tls_error" | "connection_failed" | "too_large";

export class TransportError extends Error {
  constructor(public readonly failure: TransportFailure) {
    super(failure);
    this.name = "TransportError";
  }
}

export interface HttpTransport {
  /**
   * Performs exactly one HTTP request. Redirects are never followed here
   * — the safe fetcher handles them so each hop is revalidated
   * (Sprint 3 §5).
   */
  request(request: TransportRequest): Promise<TransportResponse>;
}
