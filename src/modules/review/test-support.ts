import type { SupabaseClient } from "@supabase/supabase-js";
/**
 * The storage double, and nothing else any more.
 *
 * This file used to open with `fakeCaptureProvider` — a browser that opens no
 * browser, and the reason `pnpm test` never created a Browserbase session. It
 * went with the capture path in ADR 0074; what survives is the storage double
 * the artifact *read* still needs, because one historical approval still binds
 * to a screenshot and has to be able to show what it rested on.
 */

export type FakeStorage = {
  objects: Map<string, Uint8Array>;
  failUpload: boolean;
  failSign: boolean;
  /** Makes a prefix listing fail, which is how a sweep reports it saw nothing reliable. */
  failList: boolean;
  /** Makes a removal fail, which is the other half of a partial storage sweep. */
  failRemove: boolean;
  removed: string[];
  signed: string[];
  /** Every prefix `list` was asked for, in order — a sweep's own reads are assertable. */
  listed: string[];
};

export function fakeStorage(): FakeStorage {
  return {
    objects: new Map(),
    failUpload: false,
    failSign: false,
    failList: false,
    failRemove: false,
    removed: [],
    signed: [],
    listed: [],
  };
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
      if (storage.failRemove) return { data: null, error: { message: "remove failed" } };
      for (const path of paths) {
        storage.objects.delete(path);
        storage.removed.push(path);
      }
      return { data: null, error: null };
    },
    /**
     * One level below `prefix`, the way Supabase's own `list` behaves: a
     * nested object surfaces as the folder segment, not as its full path. A
     * sweep that assumed recursion would pass against a recursive fake and
     * then find nothing in production, so the fake keeps the real shape.
     */
    async list(prefix: string, options?: { limit?: number; offset?: number }) {
      storage.listed.push(prefix);
      if (storage.failList) return { data: null, error: { message: "list failed" } };

      const scope = prefix === "" ? "" : `${prefix}/`;
      const segments = new Set<string>();
      for (const key of storage.objects.keys()) {
        if (!key.startsWith(scope)) continue;
        const rest = key.slice(scope.length);
        if (rest.length === 0) continue;
        segments.add(rest.split("/")[0]);
      }

      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      const names = [...segments].sort().slice(offset, offset + limit);
      return { data: names.map((name) => ({ name })), error: null };
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
