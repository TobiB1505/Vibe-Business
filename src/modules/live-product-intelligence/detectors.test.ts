import { describe, expect, it } from "vitest";
import { classifyCtaLabel, detectCtas, selectPrimaryCta } from "./cta";
import { classifyForm } from "./forms";
import { classifyLinkTarget, classifyPage } from "./classifier";
import { parseHtml } from "./html";

/**
 * Detector fixtures (Sprint 3 §36). Representative page shapes only — no
 * browser, no network.
 */

describe("CTA classification", () => {
  const positives: [string, string][] = [
    ["Start free", "trial"],
    ["Try it free", "trial"],
    ["Kostenlos testen", "trial"],
    ["Sign up", "signup"],
    ["Create an account", "signup"],
    ["Registrieren", "signup"],
    ["Get started", "get_started"],
    ["Jetzt starten", "get_started"],
    ["Buy now", "purchase"],
    ["Add to cart", "purchase"],
    ["In den Warenkorb", "purchase"],
    ["Subscribe", "subscribe"],
    ["Upgrade", "subscribe"],
    ["Book a demo", "demo"],
    ["Contact sales", "contact"],
    ["Kontakt aufnehmen", "contact"],
    ["Log in", "login"],
    ["Anmelden", "login"],
  ];

  it.each(positives)("classifies %s as %s", (label, category) => {
    expect(classifyCtaLabel(label)?.category).toBe(category);
  });

  const negatives = [
    "About us",
    "Careers",
    "Read the docs",
    "Our story",
    "Blog",
    "Impressum",
    "",
    "A very long paragraph of marketing copy that happens to mention signing up somewhere inside it",
  ];

  it.each(negatives)("does not classify %s as a CTA", (label) => {
    expect(classifyCtaLabel(label)).toBeNull();
  });

  it("prefers a body signup CTA over a nav login link as the primary action", () => {
    const signals = detectCtas([
      { label: "Log in", path: "/", inNav: true },
      { label: "Start free", path: "/", inNav: false },
    ]);

    expect(selectPrimaryCta(signals)?.label).toBe("Start free");
  });

  it("returns null when nothing matched rather than guessing", () => {
    expect(selectPrimaryCta([])).toBeNull();
  });

  it("deduplicates the same CTA repeated on one page", () => {
    const signals = detectCtas([
      { label: "Get started", path: "/", inNav: false },
      { label: "Get started", path: "/", inNav: false },
    ]);
    expect(signals).toHaveLength(1);
  });
});

describe("form classification", () => {
  const formFrom = (html: string) => parseHtml(`<html><body>${html}</body></html>`).forms[0];

  it("classifies a login form", () => {
    const form = formFrom(`<form action="/login"><input type="email"><input type="password"><button>Log in</button></form>`);
    expect(classifyForm(form)).toEqual({ kind: "login_like", confidence: "high" });
  });

  it("classifies a signup form by its confirmation password", () => {
    const form = formFrom(`<form><input type="email"><input type="password"><input type="password"></form>`);
    expect(classifyForm(form).kind).toBe("signup_like");
  });

  it("classifies a signup form by its submit label", () => {
    const form = formFrom(`<form><input type="email"><input type="password"><button>Sign up</button></form>`);
    expect(classifyForm(form).kind).toBe("signup_like");
  });

  it("classifies a contact form", () => {
    const form = formFrom(`<form action="/contact"><input type="text"><input type="email"><textarea></textarea><button>Send</button></form>`);
    expect(classifyForm(form).kind).toBe("contact_like");
  });

  it("classifies a newsletter capture", () => {
    const form = formFrom(`<form><input type="email"><button>Subscribe</button></form>`);
    expect(classifyForm(form).kind).toBe("newsletter_like");
  });

  it("classifies a search form", () => {
    const form = formFrom(`<form><input type="search"><button>Search</button></form>`);
    expect(classifyForm(form).kind).toBe("search_like");
  });

  it("falls back to unknown rather than guessing", () => {
    const form = formFrom(`<form><input type="text"><input type="checkbox"></form>`);
    expect(classifyForm(form).kind).toBe("unknown");
  });
});

describe("page classification", () => {
  const classify = (path: string, html: string, requestedPath = path) =>
    classifyPage({ requestedPath, finalPath: path, html: parseHtml(html) });

  it("detects the homepage", () => {
    expect(classify("/", "<html><head><title>Acme</title></head></html>").surfaces).toContain("homepage");
  });

  const pathCases: [string, string][] = [
    ["/pricing", "pricing"],
    ["/preise", "pricing"],
    ["/login", "login"],
    ["/anmelden", "login"],
    ["/signup", "signup"],
    ["/registrieren", "signup"],
    ["/app", "dashboard_app"],
    ["/dashboard/overview", "dashboard_app"],
    ["/checkout", "checkout_billing"],
    ["/contact", "contact"],
    ["/kontakt", "contact"],
    ["/docs/getting-started", "docs_help"],
    ["/blog/hello", "blog_content"],
    ["/privacy", "privacy"],
    ["/datenschutz", "privacy"],
    ["/terms", "terms"],
    ["/impressum", "terms"],
  ];

  it.each(pathCases)("classifies %s as %s", (path, surface) => {
    expect(classify(path, "<html></html>").surfaces).toContain(surface);
  });

  it("detects a login page from its form even when the URL is unusual", () => {
    const result = classify("/enter", `<html><body><form><input type="email"><input type="password"></form></body></html>`);
    expect(result.surfaces).toContain("login");
  });

  it("detects pricing from the page title when the path is unusual", () => {
    const result = classify("/p", "<html><head><title>Pricing — Acme</title></head></html>");
    expect(result.surfaces).toContain("pricing");
  });

  it("records a protected dashboard redirecting to login as evidence for both", () => {
    const result = classifyPage({
      requestedPath: "/app",
      finalPath: "/login",
      html: parseHtml(`<html><head><title>Log in</title></head><body><form><input type="password"></form></body></html>`),
    });

    expect(result.surfaces).toContain("login");
    expect(result.surfaces).toContain("dashboard_app");

    const dashboardEvidence = result.evidence.get("dashboard_app") ?? [];
    expect(dashboardEvidence.some((item) => item.kind === "redirect")).toBe(true);
  });

  it("does not invent surfaces for a bare page", () => {
    const result = classify("/about", "<html><head><title>About us</title></head><body><p>Hi</p></body></html>");
    expect(result.surfaces).toEqual([]);
  });
});

describe("classifyLinkTarget", () => {
  it("recognises a surface from a link path alone", () => {
    expect(classifyLinkTarget("/pricing")).toBe("pricing");
    expect(classifyLinkTarget("/privacy")).toBe("privacy");
  });

  it("returns null for an ordinary path", () => {
    expect(classifyLinkTarget("/about")).toBeNull();
  });
});
