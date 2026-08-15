import { describe, expect, it } from "vitest";
import { BUSINESS_AUDIT_ANCHOR } from "@/modules/opportunities/view";
import { PROJECT_SECTIONS } from "./project-shell";

/**
 * The workspace's anchors are a contract, not decoration.
 *
 * `buildOpportunityBlockNotice` hands the user a link to the audit section when
 * opportunities are blocked — that is the *only* way out of that state, and the
 * panel comment says as much ("never a heading with a disabled button and no
 * way forward"). If the section id and the domain anchor drift apart, the link
 * silently scrolls nowhere and the dead end comes back.
 *
 * A rename on either side fails here rather than in a user's browser.
 */
describe("project workspace sections", () => {
  it("keeps a section whose id matches the anchor the opportunity engine links to", () => {
    const target = BUSINESS_AUDIT_ANCHOR.replace(/^#/, "");
    expect(PROJECT_SECTIONS.map((section) => section.id)).toContain(target);
  });

  it("gives every section a unique id, so an anchor cannot be ambiguous", () => {
    const ids = PROJECT_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every section a non-empty label", () => {
    for (const section of PROJECT_SECTIONS) {
      expect(section.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses ids that are valid as URL fragments", () => {
    // Anchors end up in the address bar and in `href="#…"`. Anything needing
    // escaping would work in one browser and not the next.
    for (const section of PROJECT_SECTIONS) {
      expect(section.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
