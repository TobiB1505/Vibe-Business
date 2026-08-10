import "server-only";

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { StringDecoder } from "node:string_decoder";
import { TransportError, type HttpTransport, type TransportRequest, type TransportResponse } from "./ports";

/**
 * Node HTTP adapter (Sprint 3 §5, §9).
 *
 * Built on `node:http`/`node:https` rather than `fetch` for three reasons
 * this sprint actually needs:
 *
 *  1. **Address pinning.** The `lookup` hook lets us connect to the exact
 *     address that passed validation, while `Host` and TLS SNI still
 *     carry the real hostname. `fetch` offers no supported way to do this.
 *  2. **No implicit redirects.** Redirects must be revalidated by the
 *     safe fetcher, so the transport must never follow one itself.
 *  3. **Streaming byte limits.** The socket is destroyed the moment a
 *     response exceeds its budget, rather than buffering an unbounded
 *     body and checking the size afterwards.
 */

/** TLS/certificate failures, separated from ordinary connection errors for a clearer user message. */
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "EPROTO",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "HOSTNAME_MISMATCH",
]);

function isTlsError(error: NodeJS.ErrnoException): boolean {
  return typeof error.code === "string" && TLS_ERROR_CODES.has(error.code);
}

export const nodeHttpTransport: HttpTransport = {
  request(options: TransportRequest): Promise<TransportResponse> {
    return new Promise<TransportResponse>((resolve, reject) => {
      const isHttps = options.url.protocol === "https:";
      const send = isHttps ? httpsRequest : httpRequest;
      const port = options.url.port !== "" ? Number(options.url.port) : isHttps ? 443 : 80;

      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        action();
      };

      const clientRequest = send(
        {
          protocol: options.url.protocol,
          hostname: options.url.hostname,
          port,
          path: `${options.url.pathname}${options.url.search}`,
          method: "GET",
          headers: { ...options.headers, host: options.url.host },
          // The DNS-rebinding defence: hand Node the address that already
          // passed validation instead of letting it resolve again.
          lookup: (_hostname, lookupOptions, callback) => {
            const family = options.addressFamily;
            if (typeof lookupOptions === "object" && lookupOptions !== null && lookupOptions.all) {
              (callback as unknown as (
                error: NodeJS.ErrnoException | null,
                addresses: { address: string; family: number }[],
              ) => void)(null, [{ address: options.pinnedAddress, family }]);
              return;
            }
            callback(null, options.pinnedAddress, family);
          },
          // Certificate validation stays on, and SNI keeps using the real
          // hostname even though the socket goes to a pinned address.
          ...(isHttps ? { servername: options.url.hostname, rejectUnauthorized: true } : {}),
          timeout: options.timeoutMs,
        },
        (response) => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
          }

          // A declared length over budget is refused before reading a byte.
          const declaredLength = Number.parseInt(headers["content-length"] ?? "", 10);
          if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
            response.destroy();
            finish(() => reject(new TransportError("too_large")));
            return;
          }

          const decoder = new StringDecoder("utf8");
          let body = "";
          let bytesRead = 0;
          let truncated = false;

          response.on("data", (chunk: Buffer) => {
            if (truncated) return;
            const remaining = options.maxBytes - bytesRead;
            if (chunk.length >= remaining) {
              body += decoder.write(chunk.subarray(0, remaining));
              bytesRead += remaining;
              truncated = true;
              // Stop the transfer at the limit rather than reading a
              // large body and discarding it afterwards.
              response.destroy();
              return;
            }
            body += decoder.write(chunk);
            bytesRead += chunk.length;
          });

          const complete = () => {
            body += decoder.end();
            finish(() =>
              resolve({ status: response.statusCode ?? 0, headers, body, bytesRead, truncated }),
            );
          };

          response.on("end", complete);
          // `destroy()` after truncation emits "close" without "end"; the
          // partial body we already have is still a valid result.
          response.on("close", () => {
            if (truncated) complete();
          });
          response.on("error", (error: NodeJS.ErrnoException) => {
            if (truncated) {
              complete();
              return;
            }
            finish(() => reject(new TransportError(isTlsError(error) ? "tls_error" : "connection_failed")));
          });
        },
      );

      clientRequest.on("timeout", () => {
        clientRequest.destroy();
        finish(() => reject(new TransportError("timeout")));
      });

      clientRequest.on("error", (error: NodeJS.ErrnoException) => {
        finish(() => reject(new TransportError(isTlsError(error) ? "tls_error" : "connection_failed")));
      });

      clientRequest.end();
    });
  },
};
