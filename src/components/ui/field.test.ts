import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is one well, and it is reached for rather than retyped.
 *
 * ## What this exists to catch
 *
 * Not a rendering bug — every hand-written field in the repository rendered
 * correctly. The defect was that there were five of them, with four fills,
 * three borders and two focus treatments between them, and the first two were
 * in the same file. `bg-field` and `bg-surface-1`, `rounded-field` and
 * `rounded-xl`, `focus:ring-1` and `focus:ring-4`. Nobody chose any of that;
 * each one was written next to whatever was already on screen.
 *
 * A shared constant did not prevent it, because a constant can be copied and
 * then edited. What prevents it is that a raw `<textarea>` or `<select>`
 * outside this file fails a test — the drift has to be argued for rather than
 * typed.
 *
 * ## Why it reads source text
 *
 * The claim is about the whole repository, not about one component's output,
 * and the only cheap way to ask "is anybody still writing their own" is to
 * look. Same reason `atmosphere.test.ts` and the material tests do.
 */

const FIELD = "src/components/ui/field.tsx";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

/**
 * The studies are excluded, and only the studies.
 *
 * A study's whole job is to render the thing that was replaced beside the
 * thing that replaced it, so it writes raw controls on purpose. Nothing under
 * `design-studies/` is product code — the fixture route is a 404 in production
 * — so a divergence there cannot reach a customer. Everywhere else it can.
 */
const STUDIES = "src/app/e2e/design-studies/";

/**
 * The code, without the prose about it.
 *
 * `choice-pills.tsx` explains at length why three native `<select>` elements
 * were the wrong control and are gone — and that sentence tripped the guard
 * that says they must be gone. Sprint 0154 recorded the same trap from the
 * other direction, where a docblock containing `role="alert"` made an
 * assertion pass with the attribute deleted. A guard about code reads code.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const TSX = sourceFiles("src")
  .filter((path) => path !== FIELD && !path.startsWith(STUDIES))
  .map((path) => ({ path, text: withoutComments(readFileSync(path, "utf8")) }));

const SOURCE = readFileSync(FIELD, "utf8");

/**
 * The one `<select>` that is not a field.
 *
 * A list filter changes what you are looking at. It collects no answer, is
 * never submitted, and cannot be wrong — so it is drawn as a segmented control
 * now, and the sort order that sits beside it keeps a native popup because
 * four interchangeable orderings are not worth showing all at once.
 *
 * That popup is the exception, and it is exactly one file: `list-controls.tsx`
 * is where the pattern lives. It used to be two — a copy on each index screen,
 * with two different fills — which is the shape of every divergence this test
 * exists to stop.
 */
const NOT_FIELDS = ["src/components/ui/list-controls.tsx"];

describe("every text-entry surface comes from one place", () => {
  it.each(["textarea", "select"])("no .tsx outside field.tsx writes its own <%s>", (tag) => {
    const offenders = TSX.filter(
      ({ path, text }) => text.includes(`<${tag}`) && !NOT_FIELDS.includes(path),
    ).map(({ path }) => path);
    expect(
      offenders,
      `<${tag}> is written by hand here. Use the component in ${FIELD} — ` +
        "five hand-written fields is how the product ended up with four fills.",
    ).toEqual([]);
  });

  it("keeps the named exception honest", () => {
    // An allowance for a file that no longer has the thing it allows is an
    // allowance nobody will notice has become a licence.
    for (const path of NOT_FIELDS) {
      const file = TSX.find((entry) => entry.path === path);
      expect(file?.text, `${path} is listed as an exception and does not exist`).toBeDefined();
      expect(file?.text, `${path} no longer writes a raw control — drop it`).toContain("<select");
    }
  });

  it("gives all three controls the same well", () => {
    // The constant is the well. If a control stops applying it, the three have
    // diverged again inside the one file that exists to stop them.
    const controls = ["Input", "Textarea", "Select"];
    for (const [index, control] of controls.entries()) {
      const start = SOURCE.indexOf(`function ${control}(`);
      expect(start, `${control} is gone from ${FIELD}`).toBeGreaterThan(-1);
      // Up to the next control, so a body cannot borrow the one below it.
      const next = controls[index + 1];
      const end = next ? SOURCE.indexOf(`function ${next}(`) : SOURCE.length;
      expect(SOURCE.slice(start, end), `${control} must be built on inputClassName`).toContain(
        "cn(inputClassName",
      );
    }
  });

  it("keeps the select's own arrow out of the click path", () => {
    // `appearance-none` removes the platform arrow, so this draws one. A mark
    // that takes the pointer is a select that does not open where it looks
    // like it should — and nothing about the screenshot would say why.
    expect(SOURCE).toContain("appearance-none");
    const chevron = SOURCE.slice(SOURCE.indexOf("<ChevronDownIcon"));
    expect(chevron.slice(0, chevron.indexOf("/>"))).toContain("pointer-events-none");
  });
});

describe("a refusal is announced", () => {
  /**
   * `aria-describedby` is read when focus *arrives* at a field. It says
   * nothing when text appears under a field the person has already left —
   * which is exactly when a rejected submission renders one, on every form in
   * the product. `role="alert"` is the difference between a message and a
   * message somebody hears.
   */
  /**
   * Code only.
   *
   * The first version of this assertion read the whole branch including its
   * docblock — which explains the fix and contains the string `role="alert"`
   * in prose. It passed with the attribute deleted. Comments go first, always.
   */
  const code = (source: string) =>
    source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");

  it("gives the error an assertive live region, in both layouts", () => {
    // Two branches render one, and a test reading `indexOf` would only ever
    // check the first — which is how a second layout ships announcing nothing.
    const source = code(readFileSync("src/components/ui/field.tsx", "utf8"));
    const errors = [...source.matchAll(/\{error && \(/g)].map((match) =>
      source.slice(match.index, source.indexOf("</p>", match.index)),
    );
    expect(errors.length, "Field renders no error branch").toBeGreaterThan(0);
    for (const error of errors) expect(error).toContain('role="alert"');
  });

  it("leaves the hint alone, which is not news", () => {
    const source = code(readFileSync("src/components/ui/field.tsx", "utf8"));
    for (const match of source.matchAll(/\{hint && \(/g)) {
      const hint = source.slice(match.index, source.indexOf("</p>", match.index));
      expect(hint).not.toContain("role=");
    }
  });
});

/**
 * The row layout, and the one thing that must not differ.
 *
 * `row` exists because a settings page is a list of things a founder has, not
 * a form they are filling in — and stacking a label over its control in a list
 * of one is what put 248px of card around the Profile page's single input.
 *
 * What it may change is where the parts sit. What it may not change is the
 * wiring, because the reason this is a prop rather than a second labelled
 * control written by hand is that both shapes keep one contract.
 */
describe("a settings row is the same field, laid out differently", () => {
  const code = (source: string) =>
    source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
  const SOURCE_CODE = code(readFileSync("src/components/ui/field.tsx", "utf8"));

  /**
   * The row branch alone.
   *
   * Bounded by the *next* function-body-level `return (`, which is the column
   * layout's. `lastIndexOf` was the first attempt and it is wrong: `FormError`
   * is declared after `Field` and has a return of its own, so the slice ran to
   * the end of the file and every assertion below was satisfied by the column
   * branch it was supposed to be measuring against. Two of the three passed
   * under the mutation they exist to catch.
   */
  const rowStart = SOURCE_CODE.indexOf('if (layout === "row")');
  const row = SOURCE_CODE.slice(rowStart, SOURCE_CODE.indexOf("\n  return (", rowStart));

  it("binds its label to the control it sits beside", () => {
    // Beside rather than above is a layout choice. An unbound label is not.
    expect(row).toContain("htmlFor={id}");
  });

  it("gives the hint the id the control points at", () => {
    // `aria-describedby={`${id}-hint`}` is written by the caller and resolves
    // to nothing if this branch names its hint differently.
    expect(row).toContain("id={`${id}-hint`}");
  });

  it("stacks on a phone rather than shrinking the label past its words", () => {
    // `flex-wrap` alone does not do it: `sm:flex-1` lets the label column
    // shrink below its own content, so a 314px control group beside it broke
    // "What should Nova call you?" to one word per line instead of wrapping
    // the row. Measured at 390px before this assertion existed.
    expect(row).toContain("flex-col");
    expect(row).toContain("sm:flex-row");
  });

  it("gives the words the width and the control its size", () => {
    // The pair, and only above `sm` — below it there is no width to share.
    expect(row).toContain("sm:flex-1");
    expect(row).toContain("sm:shrink-0");
  });
});
