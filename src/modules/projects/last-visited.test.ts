import { describe, expect, it } from "vitest";
import { LAST_VISITED_COOKIE, lastVisitedCookie, resolveLastVisited } from "./last-visited";

/**
 * `/app` resolves to a product, and this decides which one.
 *
 * The two things worth asserting are a security property and a layout one, and
 * neither is visible on screen: a forged cookie must not steer the redirect,
 * and the cookie must be written at a path `/app` can actually read.
 */

const ORDERED = [{ id: "urgent" }, { id: "calm" }];

describe("which product /app opens", () => {
  it("prefers the one the founder was last in", () => {
    expect(resolveLastVisited(ORDERED, "calm")).toBe("calm");
  });

  it("falls back to the ranking when there is no hint", () => {
    // Most urgent first — the right answer on a first visit, and after a new
    // device, a private window or cleared site data.
    expect(resolveLastVisited(ORDERED, null)).toBe("urgent");
    expect(resolveLastVisited(ORDERED, undefined)).toBe("urgent");
    expect(resolveLastVisited(ORDERED, "")).toBe("urgent");
  });

  /**
   * The cookie is a hint from the browser, so anyone can set it.
   *
   * A value naming a project this account does not own has to be
   * indistinguishable from no value at all — otherwise `/app` becomes a way to
   * probe for ids, and every caller downstream has to remember to re-check.
   */
  it("ignores a hint the account does not own", () => {
    expect(resolveLastVisited(ORDERED, "someone-elses-project")).toBe("urgent");
  });

  it("has no answer for an account with no products", () => {
    // A different screen entirely — onboarding, not a product.
    expect(resolveLastVisited([], "calm")).toBeNull();
  });
});

describe("the cookie the browser sends back", () => {
  it("is scoped to the whole app, not to the route that wrote it", () => {
    // Without `path=/` the cookie belongs to `/app/projects/<id>` and `/app`
    // never sees it — a bug that looks exactly like the feature not existing.
    const cookie = lastVisitedCookie("project_1");
    expect(cookie).toContain(`${LAST_VISITED_COOKIE}=project_1`);
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toMatch(/max-age=\d+/);
  });

  it("encodes the value", () => {
    // Ids are uuids today. A raw `;` or `,` in a cookie value truncates it,
    // and the failure would be silent and id-shaped.
    expect(lastVisitedCookie("a;b")).toContain("a%3Bb");
  });
});
