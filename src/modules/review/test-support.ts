import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrowserCaptureProvider,
  CaptureOutcome,
  CaptureRequest,
  CaptureUsage,
} from "./browser-port";

/**
 * A capture provider that opens no browser (Sprint 11A §39, §40).
 *
 * Every normal test runs against this. `pnpm test` must never create a
 * Browserbase session: it would cost money, need credentials CI does not have,
 * and make the suite depend on a vendor's uptime.
 *
 * More importantly, this fake is what makes the sprint's *policy* properties
 * testable. It records every request it was given, so "both sides were captured
 * at the same viewport under the same settle strategy" is a check against a
 * recording rather than a reading of the source — and a mutation that lets the
 * two sides diverge fails here.
 */

export type FakeCaptureOptions = {
  /** Fail the capture at this index, with this layer. */
  failAt?: { index: number; layer: "provider" | "target" | "adapter" };
  /** Bytes each successful capture returns. Distinct per side by default. */
  bytesFor?: (index: number) => Uint8Array;
  usage?: Partial<CaptureUsage>;
  /** Make `captureAll` throw, for the unexpected-adapter-error path. */
  throws?: boolean;
};

export type FakeCaptureProvider = BrowserCaptureProvider & {
  /** Every request, in order. The transcript most assertions care about. */
  requests(): CaptureRequest[];
  /** How many sessions were opened. Zero is the assertion §40 cares about. */
  sessions(): number;
};

export function fakeCaptureProvider(options: FakeCaptureOptions = {}): FakeCaptureProvider {
  const requests: CaptureRequest[] = [];
  let sessions = 0;

  return {
    id: "browserbase",

    async captureAll(input) {
      sessions += 1;
      requests.push(...input);

      if (options.throws) throw new Error("capture provider exploded");

      const outcomes: CaptureOutcome[] = input.map((request, index) => {
        if (options.failAt?.index === index) {
          return { ok: false, layer: options.failAt.layer, detail: "fake capture failure" };
        }

        return {
          ok: true,
          value: {
            // Different bytes per side by default, so a test that accidentally
            // compares an image to itself does not pass.
            bytes: options.bytesFor?.(index) ?? new Uint8Array([1, 2, 3, index]),
            width: request.viewport.width,
            height: request.viewport.height,
            httpStatus: 200,
          },
        };
      });

      return {
        outcomes,
        usage: {
          durationMs: options.usage?.durationMs ?? 4321,
          captures: options.usage?.captures ?? outcomes.filter((outcome) => outcome.ok).length,
        },
      };
    },

    requests() {
      return [...requests];
    },
    sessions() {
      return sessions;
    },
  };
}

/**
 * Object storage that keeps bytes in a map.
 *
 * Models the two things the domain depends on: an upload can fail, and a
 * removal actually removes. Signing returns a marker rather than a URL, because
 * what matters to a test is *whether a URL was minted for an authorized
 * caller*, never what it looks like.
 */
export type FakeStorage = {
  objects: Map<string, Uint8Array>;
  failUpload: boolean;
  failSign: boolean;
  removed: string[];
  signed: string[];
};

export function fakeStorage(): FakeStorage {
  return { objects: new Map(), failUpload: false, failSign: false, removed: [], signed: [] };
}

/**
 * A Supabase client whose `.storage` is the fake above.
 *
 * Composed onto an existing fake database client so one object can serve both
 * the table queries and the bucket, exactly as the real client does.
 */
export function withFakeStorage(client: SupabaseClient, storage: FakeStorage): SupabaseClient {
  const bucket = () => ({
    async upload(path: string, bytes: Uint8Array) {
      if (storage.failUpload) return { data: null, error: { message: "upload failed" } };
      storage.objects.set(path, bytes);
      return { data: { path }, error: null };
    },
    async remove(paths: string[]) {
      for (const path of paths) {
        storage.objects.delete(path);
        storage.removed.push(path);
      }
      return { data: null, error: null };
    },
    async createSignedUrl(path: string) {
      if (storage.failSign || !storage.objects.has(path)) {
        return { data: null, error: { message: "not found" } };
      }
      storage.signed.push(path);
      return { data: { signedUrl: `signed:${path}` }, error: null };
    },
  });

  return Object.assign(Object.create(Object.getPrototypeOf(client) as object), client, {
    storage: { from: () => bucket() },
  }) as SupabaseClient;
}
