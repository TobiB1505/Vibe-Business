import { describe, expect, it } from "vitest";
import { ACCOUNT_SECTIONS } from "./account-sections";
import { isNavItemActive } from "./nav-active";

/**
 * Where you are, according to the rail (UI-8).
 *
 * The failure this prevents is not cosmetic. A rail that marks two sections
 * current, or none, is a rail that has stopped answering the one question it
 * exists for — and the account rail's index route (`/app`) is a prefix of
 * every other signed-in path, so the naive `startsWith` gets it wrong on every
 * screen except the dashboard itself.
 */

const DASHBOARD = { href: "/app", exact: true };
const BILLING = { href: "/app/billing" };
const PREPARED = { href: "/app/projects/p1/prepared" };

describe("an index route matches exactly", () => {
  it("is current on its own path", () => {
    expect(isNavItemActive("/app", DASHBOARD)).toBe(true);
  });

  it("is not current on a sibling below it", () => {
    // The whole reason `exact` exists.
    expect(isNavItemActive("/app/billing", DASHBOARD)).toBe(false);
    expect(isNavItemActive("/app/projects/p1", DASHBOARD)).toBe(false);
    expect(isNavItemActive("/app/connect/github", DASHBOARD)).toBe(false);
  });
});

describe("every other item matches at a path boundary", () => {
  it("is current on its own path", () => {
    expect(isNavItemActive("/app/billing", BILLING)).toBe(true);
  });

  it("keeps a parent section current on a child route", () => {
    expect(isNavItemActive("/app/projects/p1/prepared/change-1", PREPARED)).toBe(true);
  });

  it("does not match a sibling that merely starts with the same characters", () => {
    // `/prepared` must never light up on `/prepared-something-else`.
    expect(isNavItemActive("/app/billing-history", BILLING)).toBe(false);
    expect(isNavItemActive("/app/projects/p1/prepared-archive", PREPARED)).toBe(false);
  });

  it("does not match a shorter path", () => {
    expect(isNavItemActive("/app", BILLING)).toBe(false);
  });
});

describe("the account rail as configured", () => {
  /**
   * Asserted against the real `ACCOUNT_SECTIONS` rather than a copy: the rule
   * being right is worthless if the rail is configured wrong, and forgetting
   * `exact` on the dashboard is exactly the mistake that would be made.
   */
  const paths = [
    "/app",
    "/app/billing",
    "/app/connect/github",
    "/app/connect/github/repositories",
    "/app/projects/p1",
    "/app/projects/p1/prepared",
  ];

  for (const pathname of paths) {
    it(`marks at most one section current on ${pathname}`, () => {
      const current = ACCOUNT_SECTIONS.filter((item) => isNavItemActive(pathname, item));

      expect(current.length, `sections current: ${current.map((i) => i.id).join(", ")}`)
        .toBeLessThanOrEqual(1);
    });
  }

  it("marks the dashboard current only on the dashboard", () => {
    const dashboard = ACCOUNT_SECTIONS.find((item) => item.id === "dashboard")!;

    expect(isNavItemActive("/app", dashboard)).toBe(true);
    for (const pathname of paths.filter((path) => path !== "/app")) {
      expect(isNavItemActive(pathname, dashboard), pathname).toBe(false);
    }
  });

  it("keeps the connect flow's own child routes under Connect project", () => {
    const connect = ACCOUNT_SECTIONS.find((item) => item.id === "connect")!;

    expect(isNavItemActive("/app/connect/github/repositories", connect)).toBe(true);
  });
});
