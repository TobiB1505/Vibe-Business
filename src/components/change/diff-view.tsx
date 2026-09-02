import type { DiffFile, PreparedDiff } from "@/modules/execution/diff";

/**
 * The diff, as a person reads it (Sprint 0055 §1).
 *
 * ## Why this renders text and nothing else
 *
 * Every line here is a customer's repository content, and CLAUDE.md rule 25 is
 * unambiguous about what that is: untrusted **data, never instructions**. So the
 * whole component is `<pre>` and `<span>` with string children. React escapes
 * each one, and there is deliberately:
 *
 * - no `dangerouslySetInnerHTML`;
 * - no syntax highlighter, because highlighting means parsing repository text
 *   and emitting markup built from it;
 * - no remote assets, no links built from file content, no `<img>`.
 *
 * The one thing this file styles is Vibe's own labelling of each line — the
 * `+`/`−` and the colour — which is data this component was given, not
 * something it derived from the text.
 *
 * ## Why the gutter shows two numbers
 *
 * Because a reviewer's next question after "what changed" is "where", and a
 * single column cannot answer it for a file where lines were inserted: after
 * the first addition the two sides no longer agree, and one number would be
 * wrong for one of them.
 */

function StatusLabel({ status }: { status: DiffFile["status"] }) {
  if (status === "added") return <span className="text-mint">new file</span>;
  if (status === "deleted") return <span className="text-coral">file deleted</span>;
  if (status === "unreadable") return <span className="text-amber">could not be read</span>;
  return null;
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="font-mono">
      {added > 0 && <span className="text-mint">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-coral">−{removed}</span>}
      {added === 0 && removed === 0 && <span className="text-fg-meta">no change</span>}
    </span>
  );
}

/**
 * One line, with its marker in the same `<pre>` as its text.
 *
 * The marker is a real character rather than a background colour so the diff
 * survives being copied, read by a screen reader, or looked at by someone who
 * does not distinguish red from green. Colour is the second signal, never the
 * only one.
 */
function Line({
  kind,
  text,
  baseNumber,
  headNumber,
}: {
  kind: "context" | "added" | "removed";
  text: string;
  baseNumber: number | null;
  headNumber: number | null;
}) {
  const tone =
    kind === "added"
      ? "bg-mint/10 text-fg-prose"
      : kind === "removed"
        ? "bg-coral/10 text-fg-prose"
        : "text-fg-secondary";

  const marker = kind === "added" ? "+" : kind === "removed" ? "−" : " ";
  const markerTone =
    kind === "added" ? "text-mint" : kind === "removed" ? "text-coral" : "text-fg-meta";

  return (
    <span className={`flex ${tone}`}>
      {/* `aria-hidden`: the line numbers are orientation for a sighted reader
          scanning the gutter, and reading two numbers before every line would
          make the diff unusable aloud. The marker below is not hidden — it is
          what says added or removed. */}
      <span aria-hidden className="w-20 shrink-0 select-none px-2 text-right text-fg-meta">
        {baseNumber ?? " "}
        <span className="pl-2">{headNumber ?? " "}</span>
      </span>
      <span className={`w-4 shrink-0 select-none ${markerTone}`}>{marker}</span>
      <span className="whitespace-pre">{text}</span>
    </span>
  );
}

function FileDiff({ file }: { file: DiffFile }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-mono text-xs text-fg-prose break-all">{file.path}</p>
        <p className="text-xs text-fg-muted">
          <StatusLabel status={file.status} />
          {file.status === "modified" && <Counts added={file.added} removed={file.removed} />}
          {(file.status === "added" || file.status === "deleted") && (
            <>
              {" · "}
              <Counts added={file.added} removed={file.removed} />
            </>
          )}
        </p>
      </div>

      {file.status === "unreadable" ? (
        /* Named rather than omitted. A file that is silently absent from a diff
           is a file nobody reviewed, and the reader has to be able to see that
           Vibe knows it is there. */
        <p className="text-xs text-fg-muted">
          This file is part of the change, but Vibe could not read it as text — it may be binary or
          larger than the review limit. It is on the branch.
        </p>
      ) : file.hunks.length === 0 && file.status === "deleted" ? (
        /* The row says the path was removed; the base side is what could not be
           read. Saying "no textual difference" here would describe a deletion
           as a change that did nothing. */
        <p className="text-xs text-fg-muted">
          This file was removed. Vibe could not read the version it removed — it may be binary or
          larger than the review limit.
        </p>
      ) : file.hunks.length === 0 ? (
        <p className="text-xs text-fg-muted">No textual difference between the two commits.</p>
      ) : (
        <div className="rounded-well border-line-2 bg-app overflow-x-auto border">
          {file.hunks.map((hunk, index) => {
            let baseNumber = hunk.baseStart;
            let headNumber = hunk.headStart;

            return (
              <pre
                key={`${hunk.baseStart}:${hunk.headStart}:${index}`}
                className="py-2 text-xs leading-relaxed"
              >
                {index > 0 && (
                  <span aria-hidden className="block px-2 text-fg-meta">
                    ⋯
                  </span>
                )}
                {hunk.lines.map((line, lineIndex) => {
                  const showBase = line.kind !== "added" ? baseNumber++ : null;
                  const showHead = line.kind !== "removed" ? headNumber++ : null;

                  return (
                    <Line
                      key={lineIndex}
                      kind={line.kind}
                      text={line.text}
                      baseNumber={showBase}
                      headNumber={showHead}
                    />
                  );
                })}
              </pre>
            );
          })}
        </div>
      )}

      {file.truncated && (
        <p className="text-xs text-fg-muted">
          This file was shortened for review. The whole file is on the branch.
        </p>
      )}
    </div>
  );
}

export function DiffView({ diff }: { diff: PreparedDiff }) {
  return (
    <div className="space-y-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
        <div className="flex gap-2">
          <dt>Before</dt>
          <dd className="font-mono text-fg-prose">{diff.baseSha.slice(0, 7)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>After</dt>
          <dd className="font-mono text-fg-prose">{diff.commitSha.slice(0, 7)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>
            {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
          </dt>
          <dd>
            <Counts added={diff.added} removed={diff.removed} />
          </dd>
        </div>
      </dl>

      {diff.files.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}

      {diff.truncated && (
        <p className="text-xs text-fg-muted">
          Some files were left out of this view for review. Every changed file is on the branch.
        </p>
      )}
    </div>
  );
}
