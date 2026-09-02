import { describe, expect, it } from "vitest";
import { BUSINESS_AUDIT_ANCHOR } from "@/modules/opportunities/view";
import { PROJECT_SECTIONS, PROJECT_SUBSECTIONS, projectSectionHref } from "./project-shell";

/**
 * The workspace's anchors are a contract, not decoration.
 *
 * `buildOpportunityBlockNotice` hands the user a link to the audit section when
 * opportunities are blocked — that is the *only* way out of that state, and the
 * panel comment says as much ("never a heading with a disabled button and no
 * way forward"). If the section id and the domain anchor drift apart, the link
 * silently scrolls nowhere and the dead end comes back.
 *
 * A rename on either side fails here rather than in a user's browser — which is
 * what UI-11 relies on now that Business Health is canonical Home while the
 * audit id deliberately does not move.
 */

/** The rail and the two routes beneath it. */
const ALL_SECTIONS = [...PROJECT_SECTIONS, ...PROJECT_SUBSECTIONS];

describe("project workspace sections", () => {
  it("keeps the opportunity engine's audit anchor on canonical Home", () => {
    const target = BUSINESS_AUDIT_ANCHOR.replace(/^#/, "");
    expect(PROJECT_SECTIONS.map((section) => section.id)).not.toContain(target);
    expect(projectSectionHref("abc", "business-audit")).toBe(
      `/app/projects/abc${BUSINESS_AUDIT_ANCHOR}`,
    );
  });

  it("gives every section a unique id, so an anchor cannot be ambiguous", () => {
    // Across both tables: a subsection's id reaches the DOM through
    // `WorkspaceSection` exactly as a nav section's does, so a collision
    // between the two would be just as ambiguous as one within either.
    const ids = ALL_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every section a non-empty label", () => {
    for (const section of ALL_SECTIONS) {
      expect(section.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every project navigation destination an explicit icon", () => {
    for (const section of PROJECT_SECTIONS) {
      expect(section.icon.trim().length).toBeGreaterThan(0);
    }
  });

  it("names the project index for its business job rather than as generic Home", () => {
    expect(PROJECT_SECTIONS.find((section) => section.id === "home")).toMatchObject({
      label: "Business Health",
      icon: "business-health",
      segment: "",
    });
  });

  it("keeps project configuration distinct from account settings", () => {
    expect(PROJECT_SECTIONS.find((section) => section.id === "settings")?.label).toBe(
      "Project Settings",
    );
  });

  it("uses ids that are valid as URL fragments", () => {
    // Anchors end up in the address bar and in `href="#…"`. Anything needing
    // escaping would work in one browser and not the next.
    for (const section of ALL_SECTIONS) {
      expect(section.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("gives every section a distinct URL", () => {
    const hrefs = ALL_SECTIONS.map((section) => projectSectionHref("abc", section.id));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  /**
   * A subsection is reachable and is *not* in the rail. Both halves matter: the
   * first is why it is a route at all, the second is the whole reason the two
   * tables are separate. A subsection that leaked into `PROJECT_SECTIONS` would
   * quietly grow the navigation back to nine.
   */
  it("keeps subsections out of the navigation, and under their parent", () => {
    const navIds = new Set<string>(PROJECT_SECTIONS.map((section) => section.id));
    const navSegments = PROJECT_SECTIONS.map((section) => section.segment).filter(
      (segment) => segment !== "",
    );

    for (const subsection of PROJECT_SUBSECTIONS) {
      expect(navIds.has(subsection.id)).toBe(false);
      // Nested under a section that is in the rail, so the active state has a
      // parent to light up.
      const parent = subsection.segment.split("/")[0];
      expect(navSegments, `${subsection.id} has no parent section`).toContain(parent);
    }
  });
});
