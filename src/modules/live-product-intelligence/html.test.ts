import { describe, expect, it } from "vitest";
import { parseAttributes, parseHtml } from "./html";

describe("parseHtml — metadata", () => {
  it("extracts the standard head fields", () => {
    const parsed = parseHtml(`<!doctype html>
<html lang="de">
<head>
  <title>Acme — Schneller liefern</title>
  <meta name="description" content="Acme hilft Teams.">
  <meta name="viewport" content="width=device-width">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="https://acme.test/">
  <meta property="og:title" content="Acme">
  <meta property="og:image" content="https://acme.test/og.png">
</head>
<body><h1>Hallo</h1></body>
</html>`);

    expect(parsed.title).toBe("Acme — Schneller liefern");
    expect(parsed.metaDescription).toBe("Acme hilft Teams.");
    expect(parsed.language).toBe("de");
    expect(parsed.canonical).toBe("https://acme.test/");
    expect(parsed.robotsMeta).toBe("index,follow");
    expect(parsed.hasViewportMeta).toBe(true);
    expect(parsed.openGraph["og:title"]).toBe("Acme");
  });

  it("returns nulls for a page without metadata rather than inventing values", () => {
    const parsed = parseHtml("<html><body><p>Bare</p></body></html>");

    expect(parsed.title).toBeNull();
    expect(parsed.metaDescription).toBeNull();
    expect(parsed.canonical).toBeNull();
    expect(parsed.language).toBeNull();
    expect(parsed.hasViewportMeta).toBe(false);
    expect(parsed.openGraph).toEqual({});
  });

  it("decodes HTML entities in extracted text", () => {
    const parsed = parseHtml("<html><head><title>Tom &amp; Jerry&#39;s</title></head></html>");
    expect(parsed.title).toBe("Tom & Jerry's");
  });

  it("survives malformed markup without throwing", () => {
    expect(() => parseHtml("<html><head><title>Broken</head><body><div><p>x")).not.toThrow();
    expect(() => parseHtml("")).not.toThrow();
    expect(() => parseHtml("<<<>>>")).not.toThrow();
  });
});

describe("parseHtml — script and style are data, never executed or read as copy", () => {
  it("does not treat script contents as page text", () => {
    const parsed = parseHtml(`<html><head><title>Safe</title></head><body>
      <script>var h1 = "<h1>Injected heading</h1>"; alert("x");</script>
      <h1>Real heading</h1>
    </body></html>`);

    expect(parsed.headings.map((heading) => heading.text)).toEqual(["Real heading"]);
  });

  it("does not extract links from inside script blocks", () => {
    const parsed = parseHtml(`<html><body>
      <script>document.write('<a href="/from-script">x</a>');</script>
      <a href="/real">Real</a>
    </body></html>`);

    expect(parsed.links.map((link) => link.href)).toEqual(["/real"]);
  });

  it("ignores markup hidden inside comments", () => {
    const parsed = parseHtml(`<html><body><!-- <a href="/commented">x</a> --><a href="/live">Live</a></body></html>`);
    expect(parsed.links.map((link) => link.href)).toEqual(["/live"]);
  });

  it("detects structured data without evaluating the script tag", () => {
    const parsed = parseHtml(`<html><body>
      <script type="application/ld+json">{"@type":"SoftwareApplication","name":"Acme"}</script>
    </body></html>`);

    expect(parsed.hasStructuredData).toBe(true);
    expect(parsed.structuredDataTypes).toEqual(["SoftwareApplication"]);
  });

  it("still reports structured data present when the JSON-LD is invalid", () => {
    const parsed = parseHtml(`<html><body>
      <script type="application/ld+json">{ not valid json </script>
    </body></html>`);

    expect(parsed.hasStructuredData).toBe(true);
    expect(parsed.structuredDataTypes).toEqual([]);
  });
});

describe("parseHtml — links and regions", () => {
  it("marks links inside nav and footer regions", () => {
    const parsed = parseHtml(`<html><body>
      <nav><a href="/pricing">Pricing</a></nav>
      <main><a href="/signup">Start free</a></main>
      <footer><a href="/privacy">Privacy</a></footer>
    </body></html>`);

    const byHref = new Map(parsed.links.map((link) => [link.href, link]));
    expect(byHref.get("/pricing")?.inNav).toBe(true);
    expect(byHref.get("/signup")?.inNav).toBe(false);
    expect(byHref.get("/privacy")?.inFooter).toBe(true);
  });

  it("collects headings up to level 3 only", () => {
    const parsed = parseHtml("<html><body><h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4></body></html>");
    expect(parsed.headings.map((heading) => heading.text)).toEqual(["One", "Two", "Three"]);
  });

  it("reads button labels", () => {
    const parsed = parseHtml("<html><body><button>Get started</button></body></html>");
    expect(parsed.buttons).toEqual(["Get started"]);
  });
});

describe("parseHtml — forms carry structure only", () => {
  it("records input types but never names or values", () => {
    const parsed = parseHtml(`<html><body>
      <form action="/login" method="post">
        <input type="email" name="user_email" value="someone@example.com">
        <input type="password" name="user_password" value="hunter2">
        <input type="hidden" name="csrf" value="secret-token">
        <button type="submit">Log in</button>
      </form>
    </body></html>`);

    const form = parsed.forms[0];
    expect(form.fieldTypes).toEqual(["email", "password"]);
    expect(form.hasPassword).toBe(true);
    expect(form.hasEmailField).toBe(true);
    expect(form.actionPath).toBe("/login");
    expect(form.submitLabel).toBe("Log in");

    // Nothing that could carry a secret or personal data is retained.
    const serialized = JSON.stringify(form);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("someone@example.com");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("user_password");
    expect(serialized).not.toContain("csrf");
  });

  it("counts two password fields for a registration form", () => {
    const parsed = parseHtml(`<html><body><form>
      <input type="password"><input type="password">
    </form></body></html>`);
    expect(parsed.forms[0].passwordCount).toBe(2);
  });

  it("detects a textarea as part of the structure", () => {
    const parsed = parseHtml(`<html><body><form>
      <input type="email"><textarea></textarea>
    </form></body></html>`);
    expect(parsed.forms[0].hasTextarea).toBe(true);
  });
});

describe("parseAttributes", () => {
  it("parses quoted, single-quoted and bare values", () => {
    expect(parseAttributes(`href="/a" rel='nofollow' target=_blank`)).toEqual({
      href: "/a",
      rel: "nofollow",
      target: "_blank",
    });
  });

  it("lowercases attribute names", () => {
    expect(parseAttributes(`HREF="/a"`)).toEqual({ href: "/a" });
  });
});
