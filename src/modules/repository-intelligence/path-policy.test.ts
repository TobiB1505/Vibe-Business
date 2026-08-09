import { describe, expect, it } from "vitest";
import {
  isBinaryPath,
  isGeneratedPath,
  isSensitivePath,
  isSourcePath,
  mayFetchContent,
  pathBasename,
  pathDepth,
  pathExtension,
} from "./path-policy";

describe("path helpers", () => {
  it("extracts basename, depth and extension", () => {
    expect(pathBasename("src/app/page.tsx")).toBe("page.tsx");
    expect(pathDepth("src/app/page.tsx")).toBe(3);
    expect(pathExtension("src/app/page.tsx")).toBe("tsx");
  });

  it("treats a leading-dot file as having no extension", () => {
    expect(pathExtension(".env")).toBe("");
    expect(pathExtension(".gitignore")).toBe("");
  });
});

describe("isSensitivePath", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    ".env.example",
    "config/.env.staging",
    "certs/server.pem",
    "keys/deploy.key",
    "certs/bundle.p12",
    "certs/bundle.pfx",
    "id_rsa",
    "ssh/id_ed25519",
    "credentials.json",
    "config/credentials",
    "secrets.yaml",
    "config/secret.json",
    "private-key.json",
    "private_key.pem",
    "service-account.json",
    "gcp/service_account-prod.json",
    ".npmrc",
    ".netrc",
  ])("treats %s as sensitive", (path) => {
    expect(isSensitivePath(path)).toBe(true);
    expect(mayFetchContent(path)).toBe(false);
  });

  it.each([
    "docs/credentials-guide.md",
    "docs/secrets.md",
    "src/lib/secretsManager.ts",
    "src/components/EnvBadge.tsx",
    "README.md",
    "package.json",
    "src/app/environment/page.tsx",
    "keys/README.md",
  ])("does not treat harmless path %s as sensitive", (path) => {
    expect(isSensitivePath(path)).toBe(false);
  });

  it("still treats a credential-named data file as sensitive despite the doc exemption", () => {
    expect(isSensitivePath("config/credentials-prod.json")).toBe(true);
    expect(isSensitivePath("secrets.yaml")).toBe(true);
  });
});

describe("isBinaryPath", () => {
  it.each([
    "public/logo.png",
    "assets/hero.jpg",
    "public/icon.svg",
    "media/demo.mp4",
    "fonts/Inter.woff2",
    "archive.tar.gz",
    "bin/app.exe",
    "data/local.sqlite",
    "docs/spec.pdf",
  ])("treats %s as binary", (path) => {
    expect(isBinaryPath(path)).toBe(true);
    expect(mayFetchContent(path)).toBe(false);
  });

  it.each(["package.json", "src/app/page.tsx", "README.md", "Dockerfile", "next.config.ts"])(
    "does not treat text file %s as binary",
    (path) => {
      expect(isBinaryPath(path)).toBe(false);
    },
  );
});

describe("isGeneratedPath", () => {
  it.each([
    "node_modules/react/index.js",
    ".next/server/app/page.js",
    "dist/bundle.js",
    "build/index.html",
    "coverage/lcov.info",
    "vendor/autoload.php",
    "target/debug/app",
    ".git/config",
    "apps/web/.next/static/chunk.js",
    "backend/__pycache__/main.cpython-311.pyc",
  ])("treats %s as generated", (path) => {
    expect(isGeneratedPath(path)).toBe(true);
    expect(mayFetchContent(path)).toBe(false);
  });

  it("matches whole segments only, so similarly named source files are kept", () => {
    expect(isGeneratedPath("src/lib/dist-utils.ts")).toBe(false);
    expect(isGeneratedPath("src/build-config.ts")).toBe(false);
    expect(isGeneratedPath("src/components/OutButton.tsx")).toBe(false);
  });
});

describe("mayFetchContent / isSourcePath", () => {
  it("allows ordinary project files", () => {
    expect(mayFetchContent("package.json")).toBe(true);
    expect(mayFetchContent("src/app/pricing/page.tsx")).toBe(true);
    expect(isSourcePath("src/app/pricing/page.tsx")).toBe(true);
  });

  it("excludes generated output from being treated as source", () => {
    expect(isSourcePath(".next/server/app/pricing/page.js")).toBe(false);
  });
});
