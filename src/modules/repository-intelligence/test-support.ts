import { buildDetectionContext, type DetectionContext } from "./context";
import type { RepositoryHead, RepositoryReader, RepositoryTree, TreeEntry } from "./reader";

/**
 * In-memory repository fixtures for tests. Lets every detector and the
 * full pipeline be exercised without a single GitHub call — the spec's
 * "no real GitHub network calls in normal CI tests" requirement.
 */

export type FixtureFile = { path: string; content?: string; size?: number };

export function treeFrom(files: FixtureFile[]): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const directories = new Set<string>();

  for (const file of files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
    entries.push({
      path: file.path,
      type: "blob",
      size: file.size ?? (file.content ? Buffer.byteLength(file.content, "utf8") : 64),
    });
  }

  for (const directory of directories) {
    entries.push({ path: directory, type: "tree" });
  }

  return entries;
}

export function contextFrom(files: FixtureFile[]): DetectionContext {
  const entries = treeFrom(files);
  const fetched = files
    .filter((file): file is FixtureFile & { content: string } => typeof file.content === "string")
    .map((file) => ({ path: file.path, content: file.content }));
  return buildDetectionContext(entries, fetched).context;
}

export type FakeReaderOptions = {
  files: FixtureFile[];
  commitSha?: string;
  defaultBranch?: string;
  truncated?: boolean;
};

/** Records every call so tests can assert on fetch behaviour and budgets. */
export class FakeRepositoryReader implements RepositoryReader {
  readonly fetchedPaths: string[] = [];
  private readonly files: Map<string, string>;
  private readonly entries: TreeEntry[];

  constructor(private readonly options: FakeReaderOptions) {
    this.entries = treeFrom(options.files);
    this.files = new Map(
      options.files
        .filter((file): file is FixtureFile & { content: string } => typeof file.content === "string")
        .map((file) => [file.path, file.content]),
    );
  }

  async getHead(): Promise<RepositoryHead> {
    return {
      defaultBranch: this.options.defaultBranch ?? "main",
      commitSha: this.options.commitSha ?? "a".repeat(40),
    };
  }

  async getTree(): Promise<RepositoryTree> {
    return { entries: this.entries, truncated: this.options.truncated ?? false };
  }

  async getTextFile(path: string, _commitSha: string, maxBytes: number): Promise<string | null> {
    this.fetchedPaths.push(path);
    const content = this.files.get(path);
    if (content === undefined) return null;
    if (Buffer.byteLength(content, "utf8") > maxBytes) return null;
    return content;
  }
}

export function packageJson(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}
