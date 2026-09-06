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

const TSX = sourceFiles("src")
  .filter((path) => path !== FIELD && !path.startsWith(STUDIES))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

const SOURCE = readFileSync(FIELD, "utf8");

/**
 * The two `<select>`s that are not fields.
 *
 * These filter a list rather than collect an answer, and they are drawn as
 * bare text on the surface — no well, no border. That is a different control
 * with a different job, and putting it in a field's clothes would say the list
 * is something you fill in.
 *
 * They are named here rather than exempted by a pattern, so the list can only
 * grow by someone editing this file and saying why. The filter treatment is
 * still open; when it is decided these move to whatever it produces and this
 * array goes back to being empty.
 */
const NOT_FIELDS = [
  "src/app/app/(account)/products/products-index.tsx",
  "src/app/app/(account)/repositories/repositories-index.tsx",
];

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

  it("keeps the named exceptions honest", () => {
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
