import { describe, expect, it } from "vitest";
import { parseHtml } from "./html";
import { classifyRendering } from "./rendering";

/**
 * Sprint 0082 — the shells are real, not invented.
 *
 * Each fixture below is the shape the named tool actually emits before its own
 * JavaScript runs. A hand-written approximation would prove only that the
 * classifier agrees with the fixture's author.
 */
const VITE_SPA = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Acme</title>
    <script type="module" crossorigin src="/assets/index-a1b2c3.js"></script>
    <link rel="stylesheet" href="/assets/index-d4e5f6.css" />
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>`;

const CREATE_REACT_APP = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<title>React App</title></head><body>
<noscript>You need to enable JavaScript to run this app.</noscript>
<div id="root"></div>
<script src="/static/js/main.chunk.js"></script></body></html>`;

const VUE_SPA = `<!DOCTYPE html><html><head><title>Shop</title></head>
<body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>`;

const SERVER_RENDERED = `<!DOCTYPE html><html lang="en"><head><title>Acme — Ship faster</title>
<meta name="description" content="Acme helps teams ship."/></head>
<body><div id="__next"><header><nav><a href="/pricing">Pricing</a><a href="/login">Log in</a></nav></header>
<main><h1>Ship faster</h1><p>Acme gives your team one place to plan, build and release software,
without the four tools you are paying for today. Start free and invite your team in a minute.</p>
<a href="/signup">Start free</a></main></div>
<script src="/_next/static/chunks/main.js"></script></body></html>`;

const COMING_SOON = `<!DOCTYPE html><html><head><title>Acme</title></head>
<body><p>Acme is coming soon. Write to hello@acme.example.</p></body></html>`;

describe("classifyRendering", () => {
  it("calls a Vite shell client-rendered", () => {
    expect(classifyRendering(parseHtml(VITE_SPA))).toBe("client_rendered");
  });

  it("calls a Create React App shell client-rendered", () => {
    expect(classifyRendering(parseHtml(CREATE_REACT_APP))).toBe("client_rendered");
  });

  it("calls a Vue shell client-rendered from the mount element alone", () => {
    // No noscript at all — the empty `#app` has to carry it by itself.
    const parsed = parseHtml(VUE_SPA);
    expect(parsed.requiresJavaScript).toBe(false);
    expect(classifyRendering(parsed)).toBe("client_rendered");
  });

  it("leaves a server-rendered page alone, mount element and all", () => {
    // `#__next` is present here too. What separates it is that the markup is
    // *inside* it, which is exactly the thing the signal is built on.
    const parsed = parseHtml(SERVER_RENDERED);
    expect(parsed.hasEmptyMountElement).toBe(false);
    expect(classifyRendering(parsed)).toBe("readable");
  });

  it("does not accuse a genuinely thin page of being unreadable", () => {
    // Vibe read this one correctly. Calling it "could not read" would be a
    // false alarm, and a false alarm teaches a founder to ignore the real one.
    expect(classifyRendering(parseHtml(COMING_SOON))).toBe("empty");
  });

  it("ignores a JavaScript notice on a page that already gave us something", () => {
    const withNotice = SERVER_RENDERED.replace(
      "<main>",
      "<noscript>Please enable JavaScript for the best experience.</noscript><main>",
    );
    expect(classifyRendering(parseHtml(withNotice))).toBe("readable");
  });

  it("treats a heading as proof the server sent markup", () => {
    const oneHeading = `<html><body><div id="root"></div><h1>Acme</h1></body></html>`;
    expect(classifyRendering(parseHtml(oneHeading))).toBe("readable");
  });

  it("treats a form as proof the server sent markup", () => {
    const loginOnly = `<html><body><div id="app"></div>
      <form action="/login"><input type="email"/><input type="password"/><button>Log in</button></form>
      </body></html>`;
    expect(classifyRendering(parseHtml(loginOnly))).toBe("readable");
  });

  it("does not count script bodies or attributes as text a reader sees", () => {
    const noisyShell = `<html><body>
      <div id="root" data-config="a very long configuration blob repeated many times over and over"></div>
      <script>const state = ${JSON.stringify("x".repeat(4000))};</script>
      </body></html>`;
    expect(classifyRendering(parseHtml(noisyShell))).toBe("client_rendered");
  });
});
