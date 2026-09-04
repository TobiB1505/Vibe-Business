#!/usr/bin/env node
/**
 * Projekt-Atlas — eine Übersichtsseite, die aus dem Repository selbst gebaut wird.
 *
 *   pnpm atlas   →   .atlas/index.html
 *
 * Jede Zahl auf der Seite ist aus dem Code, aus git oder aus den Dokumenten
 * abgeleitet. Nichts davon wird von Hand gepflegt, und deshalb kann die Seite
 * auch nicht veralten: sie wird neu gebaut statt nachgeführt. Ein handgeschriebenes
 * Übersichtsdokument wäre nach drei Sprints falsch.
 *
 * Das Skript liest nur. Es schreibt ausschliesslich nach .atlas/ (nicht im Repo).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, ".atlas");

const CODE_EXT = /\.(ts|tsx|mts|mjs)$/;
const TEST_FILE = /\.(test|probe|concurrency|migration)\.(ts|tsx|mts)$/;

/** Dateien mit diesen Namen enthalten Regler: Grenzen, Preise, Fristen, Zeitlimits. */
const KNOB_FILE =
  /(budget|budgets|limit|limits|pricing|polic(y|ies)|threshold|quota|retention|window|windows|timeout|operations|start-limits|gateway-config)\.ts$/;

// ---------------------------------------------------------------- Hilfsmittel

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (CODE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lines(file) {
  return readFileSync(file, "utf8").split("\n").length;
}

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const de = (n) => Number(n).toLocaleString("de-DE");

/**
 * Der erste Satz eines Kommentars erklärt den Regler; alles danach ist Herleitung
 * und würde die Tabelle unlesbar machen. Der volle Text bleibt als Tooltip erhalten.
 */
function ohneMarkdown(text) {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function kurz(text, max = 180) {
  const clean = ohneMarkdown(text)
    .split(/\s#{2,}\s|\s```/)[0]
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > 60 ? cut.slice(0, end + 1) : cut.trimEnd() + " …";
}

// ------------------------------------------------------------- Datenbanktabellen

function readTables() {
  const dir = join(ROOT, "supabase/migrations");
  const names = new Set();
  if (!existsSync(dir)) return [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi,
    )) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

// ------------------------------------------------------------------ Entscheidungen

function readDecisions() {
  const dir = join(ROOT, "docs/decisions");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f))) {
    const text = readFileSync(join(dir, file), "utf8");
    const title = (text.match(/^#\s+(.+)$/m) ?? [, file])[1];
    const status = (text.match(/^Status:\s*(.+)$/m) ?? [, "—"])[1];
    const date = (text.match(/^Date:\s*(.+)$/m) ?? [, ""])[1];
    const modules = new Set([...text.matchAll(/src\/modules\/([a-z-]+)/g)].map((m) => m[1]));
    out.push({ file, number: file.slice(0, 4), title, status, date, modules: [...modules] });
  }
  return out.sort((a, b) => b.number.localeCompare(a.number));
}

// ---------------------------------------------------------------- Offene Lücken

function readRoadmap() {
  const file = join(ROOT, "docs/ROADMAP.md");
  if (!existsSync(file)) return [];
  const sections = [];
  let current = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (!/^What may be in this file/.test(heading[1])) {
        current = { title: heading[1], entries: [] };
        sections.push(current);
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const bold = line.match(/^\*\*(.+?)\*\*/);
    if (bold) {
      const title = bold[1].replace(/`/g, "");
      current.entries.push({
        title,
        closed: /^(closed|geschlossen)\b/i.test(title),
        words: line.split(/\s+/).length,
      });
      // Absichtlich kein Erraten: die ROADMAP trägt den echten Stand im Fliesstext,
      // und ein geratener Haken wäre schlimmer als gar keiner.
    }
  }
  return sections.filter((s) => s.entries.length > 0);
}

// ------------------------------------------------------------------- Stellschrauben

const VALUE_OK = /^[-\w"'`.\s*+/]{1,60}$/;

/** Zählt die Einträge einer als Liste geschriebenen Konstante (z. B. eine Preistabelle). */
function listEntries(text, start) {
  let arrayDepth = 0;
  let braceDepth = 0;
  let objects = 0;
  let separators = 0;
  let content = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === "[") arrayDepth += 1;
    else if (c === "]") {
      arrayDepth -= 1;
      if (arrayDepth === 0) break;
    } else if (c === "{") {
      if (arrayDepth === 1 && braceDepth === 0) objects += 1;
      braceDepth += 1;
    } else if (c === "}") braceDepth -= 1;
    else if (c === "," && arrayDepth === 1 && braceDepth === 0) separators += 1;
    else if (arrayDepth === 1 && braceDepth === 0 && !/\s/.test(c)) content = true;
  }
  // Objektlisten zählen sich selbst; bei Listen aus Namen oder Zahlen zählen die Kommas.
  if (objects > 0) return objects;
  if (separators > 0) return separators;
  return content ? 1 : 0;
}

function readListKnobs(rel, text) {
  const out = [];
  for (const m of text.matchAll(
    /(?:\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*)?^export const ([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*\[/gm,
  )) {
    const count = listEntries(text, m.index + m[0].length - 1);
    if (count === 0) continue;
    const doc = (m[1] ?? "")
      .split("\n")
      .map((l) => l.trim().replace(/^\*\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({
      file: rel,
      name: m[2],
      value: `Liste · ${count} ${count === 1 ? "Eintrag" : "Einträge"}`,
      doc,
    });
  }
  return out;
}

function readKnobs(files) {
  const knobs = [];
  for (const file of files) {
    if (!KNOB_FILE.test(file) || TEST_FILE.test(file)) continue;
    const rel = relative(ROOT, file);
    const content = readFileSync(file, "utf8");
    knobs.push(...readListKnobs(rel, content));
    const src = content.split("\n");
    let doc = [];
    let inBlock = false;
    let group = null;

    const flush = () => {
      const text = doc.join(" ").replace(/\s+/g, " ").trim();
      doc = [];
      return text;
    };

    for (const raw of src) {
      const line = raw.trimEnd();
      const t = line.trim();

      if (inBlock) {
        if (t.includes("*/")) inBlock = false;
        else doc.push(t.replace(/^\*\s?/, ""));
        continue;
      }
      const oneLineDoc = t.match(/^\/\*\*\s*(.*?)\s*\*\/$/);
      if (oneLineDoc) {
        doc = [oneLineDoc[1]];
        continue;
      }
      if (t.startsWith("/**")) {
        inBlock = true;
        doc = [t.replace(/^\/\*\*\s?/, "")].filter(Boolean);
        continue;
      }
      if (t.startsWith("//")) {
        doc.push(t.replace(/^\/\/\s?/, ""));
        continue;
      }

      const decl = line.match(/^export const ([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*(.*)$/);
      if (decl) {
        const [, name, rest] = decl;
        if (rest.startsWith("{")) {
          group = name;
          flush();
        } else {
          const value = rest.replace(/;\s*$/, "").trim();
          if (VALUE_OK.test(value) && !value.includes("(") && value !== "") {
            knobs.push({ file: rel, name, value, doc: flush() });
          } else flush();
          group = null;
        }
        continue;
      }

      if (group) {
        if (/^\}/.test(t)) {
          group = null;
          flush();
          continue;
        }
        const entry = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?),?$/);
        if (entry) {
          const value = entry[2].replace(/,$/, "").trim();
          if (VALUE_OK.test(value) && !value.includes("(") && !value.startsWith("{")) {
            knobs.push({ file: rel, name: `${group}.${entry[1]}`, value, doc: flush() });
          } else flush();
          continue;
        }
      }
      if (t !== "") doc = [];
    }
  }
  return knobs;
}

// ------------------------------------------------------------------------ Module

function readModules(tables) {
  const dir = join(ROOT, "src/modules");
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const modules = new Map();

  for (const name of names) {
    const moduleDir = join(dir, name);
    const files = walk(moduleDir);
    const src = files.filter((f) => !TEST_FILE.test(f));
    const tests = files.filter((f) => TEST_FILE.test(f));
    const srcLoc = src.reduce((n, f) => n + lines(f), 0);
    const testLoc = tests.reduce((n, f) => n + lines(f), 0);

    const readmePath = join(moduleDir, "README.md");
    const hasReadme = existsSync(readmePath);
    let summary = "";
    if (hasReadme) {
      // Der erste Absatz nach der Überschrift, nicht die erste Zeile: READMEs sind
      // auf 80 Zeichen umbrochen, eine einzelne Zeile bricht mitten im Satz ab.
      const text = readFileSync(readmePath, "utf8").split("\n");
      const start = text.findIndex((l) => l.startsWith("# "));
      const paragraph = [];
      for (const line of text.slice(start + 1)) {
        const t = line.trim();
        if (t === "") {
          if (paragraph.length > 0) break;
          continue;
        }
        if (t.startsWith("#") || t.startsWith(">") || t.startsWith("|")) continue;
        paragraph.push(t);
      }
      summary = kurz(ohneMarkdown(paragraph.join(" ")), 260);
    }

    const body = src.map((f) => readFileSync(f, "utf8")).join("\n");
    const deps = new Set([...body.matchAll(/from "@\/modules\/([a-z-]+)/g)].map((m) => m[1]));
    deps.delete(name);

    const touched = tables.filter((t) => new RegExp(`["'\`]${t}["'\`]`).test(body));

    const rel = `src/modules/${name}`;
    const lastTouched = git(["log", "-1", "--format=%ad", "--date=short", "--", rel]);
    const recentCommits = git(["log", "--since=90.days", "--oneline", "--", rel])
      .split("\n")
      .filter(Boolean).length;

    modules.set(name, {
      name,
      files: src.length,
      testFiles: tests.length,
      srcLoc,
      testLoc,
      hasReadme,
      summary,
      deps: [...deps].sort(),
      dependents: [],
      tables: touched,
      decisions: [],
      lastTouched,
      recentCommits,
      knobs: [],
    });
  }

  for (const m of modules.values()) {
    for (const dep of m.deps) modules.get(dep)?.dependents.push(m.name);
  }
  for (const m of modules.values()) m.dependents.sort();

  return modules;
}

// ------------------------------------------------------------------------ Befunde

function findings(m) {
  const out = [];
  if (!m.hasReadme)
    out.push({
      level: "rot",
      text: "Kein README — niemand kann nachlesen, wofür das Modul da ist",
    });
  if (m.testFiles === 0) out.push({ level: "rot", text: "Keine Tests" });
  if (m.srcLoc > 10000)
    out.push({
      level: "gelb",
      text: `Sehr gross (${de(m.srcLoc)} Zeilen) — schwer im Kopf zu behalten`,
    });
  if (m.deps.length > 8)
    out.push({ level: "gelb", text: `Hängt von ${m.deps.length} anderen Modulen ab` });
  if (m.dependents.length > 8)
    out.push({
      level: "gelb",
      text: `${m.dependents.length} Module hängen daran — Änderungen wirken weit`,
    });
  if (m.testFiles > 0 && m.testLoc < m.srcLoc / 4)
    out.push({ level: "gelb", text: "Wenig Testcode im Verhältnis zum Code" });
  return out;
}

// -------------------------------------------------------------------- Seitenbau

function render(data) {
  const { modules, knobs, roadmap, totals, stamp } = data;
  const list = [...modules.values()];

  const ampel = (m) => {
    const f = findings(m);
    if (f.some((x) => x.level === "rot")) return "rot";
    if (f.length > 0) return "gelb";
    return "gruen";
  };

  const moduleRows = list
    .slice()
    .sort((a, b) => b.srcLoc - a.srcLoc)
    .map((m) => {
      const f = findings(m);
      return `
      <details class="mod ${ampel(m)}" data-such="${esc(m.name + " " + m.summary + " " + m.tables.join(" "))}">
        <summary>
          <span class="dot"></span>
          <span class="mname">${esc(m.name)}</span>
          <span class="meta">${de(m.srcLoc)} Zeilen · ${m.testFiles} Testdateien · ${m.recentCommits} Commits in 90 Tagen</span>
          ${f.length ? `<span class="badge">${f.length} Befund${f.length === 1 ? "" : "e"}</span>` : `<span class="badge ok">in Ordnung</span>`}
        </summary>
        <div class="body">
          ${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : `<p class="summary missing">Kein README — es gibt keine Beschreibung dieses Moduls.</p>`}
          ${f.length ? `<ul class="findings">${f.map((x) => `<li class="${x.level}">${esc(x.text)}</li>`).join("")}</ul>` : ""}
          <dl>
            <dt>Grösse</dt><dd>${de(m.srcLoc)} Zeilen Code in ${m.files} Dateien · ${de(m.testLoc)} Zeilen Tests in ${m.testFiles} Dateien</dd>
            <dt>Zuletzt angefasst</dt><dd>${esc(m.lastTouched || "—")}</dd>
            <dt>Benutzt</dt><dd>${m.deps.length ? m.deps.map((d) => `<code>${esc(d)}</code>`).join(" ") : "<em>nichts anderes</em>"}</dd>
            <dt>Wird benutzt von</dt><dd>${m.dependents.length ? m.dependents.map((d) => `<code>${esc(d)}</code>`).join(" ") : "<em>niemandem</em>"}</dd>
            <dt>Datenbanktabellen</dt><dd>${m.tables.length ? m.tables.map((t) => `<code>${esc(t)}</code>`).join(" ") : "<em>keine</em>"}</dd>
            <dt>Entscheidungen (ADR)</dt><dd>${m.decisions.length ? m.decisions.map((d) => `<code>${esc(d)}</code>`).join(" ") : "<em>keine, die dieses Modul namentlich nennt</em>"}</dd>
            <dt>Stellschrauben</dt><dd>${m.knobs.length ? `${m.knobs.length} — siehe <a href="#schrauben">Register</a>` : "<em>keine gefunden</em>"}</dd>
          </dl>
        </div>
      </details>`;
    })
    .join("");

  const knobsByModule = new Map();
  for (const k of knobs) {
    const m = k.file.match(/^src\/modules\/([a-z-]+)\//)?.[1] ?? "(ausserhalb der Module)";
    if (!knobsByModule.has(m)) knobsByModule.set(m, []);
    knobsByModule.get(m).push(k);
  }
  const knobBlocks = [...knobsByModule.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(
      ([m, ks]) => `
      <div class="knobgroup" data-such="${esc(m + " " + ks.map((k) => k.name).join(" "))}">
        <h3>${esc(m)} <span class="count">${ks.length}</span></h3>
        <table>
          <thead><tr><th>Regler</th><th>Wert</th><th>Was er bedeutet</th></tr></thead>
          <tbody>
            ${ks
              .map(
                (
                  k,
                ) => `<tr><td><code>${esc(k.name)}</code><div class="path">${esc(k.file)}</div></td>
                        <td class="val"><code>${esc(k.value)}</code></td>
                        <td title="${esc(kurz(k.doc, 700))}">${esc(kurz(k.doc)) || "<em>nicht beschrieben</em>"}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`,
    )
    .join("");

  const roadmapBlocks = roadmap
    .map(
      (s) => `
      <div class="gapgroup">
        <h3>${esc(s.title)}</h3>
        <ul class="gaps">
          ${s.entries
            .map(
              (e) =>
                `<li class="${e.closed ? "done" : "open"}"><span class="mark">${e.closed ? "erledigt" : "Eintrag"}</span> ${esc(e.title)}</li>`,
            )
            .join("")}
        </ul>
      </div>`,
    )
    .join("");

  const coupling = list
    .slice()
    .sort((a, b) => b.dependents.length + b.deps.length - (a.dependents.length + a.deps.length))
    .slice(0, 12)
    .map(
      (m) =>
        `<tr><td><code>${esc(m.name)}</code></td><td>${m.deps.length}</td><td>${m.dependents.length}</td><td>${de(m.srcLoc)}</td></tr>`,
    )
    .join("");

  const aktiv = list
    .slice()
    .filter((m) => m.recentCommits > 0)
    .sort((a, b) => b.recentCommits - a.recentCommits)
    .slice(0, 12)
    .map(
      (m) =>
        `<tr><td><code>${esc(m.name)}</code></td><td>${m.recentCommits}</td><td>${esc(m.lastTouched)}</td></tr>`,
    )
    .join("");

  const rot = list.filter((m) => ampel(m) === "rot").length;
  const gelb = list.filter((m) => ampel(m) === "gelb").length;
  const gruen = list.length - rot - gelb;
  const offeneGaps = roadmap.reduce((n, s) => n + s.entries.filter((e) => !e.closed).length, 0);

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Projekt-Atlas — Vibe Business</title>
<style>
  :root {
    --bg: #fbfaf8; --card: #ffffff; --ink: #1c1a17; --mute: #6b6559; --line: #e6e1d8;
    --rot: #b3261e; --gelb: #a06800; --gruen: #2f6f3e; --accent: #2f5fa0;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16150f; --card:#1e1d17; --ink:#eceadf; --mute:#a19a89; --line:#332f26;
            --rot:#ef8b83; --gelb:#e0b357; --gruen:#82c495; --accent:#8fb4e8; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 32px 20px 96px; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 20px; margin: 48px 0 6px; letter-spacing: -0.01em; }
  h3 { font-size: 15px; margin: 24px 0 8px; }
  .lede { color: var(--mute); margin: 0 0 28px; max-width: 62ch; }
  .hint { color: var(--mute); font-size: 13.5px; margin: 0 0 16px; max-width: 68ch; }
  code { font: 12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
         background: color-mix(in srgb, var(--ink) 7%, transparent);
         padding: 1px 5px; border-radius: 4px; }
  a { color: var(--accent); }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin:20px 0 8px; }
  .kpi { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .kpi b { display:block; font-size:22px; font-weight:650; letter-spacing:-0.02em; }
  .kpi span { color:var(--mute); font-size:12.5px; }
  .ampelbar { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0 0; font-size:13.5px; color:var(--mute); }
  .ampelbar b { color:var(--ink); }
  #suche { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:9px;
           background:var(--card); color:var(--ink); font-size:14px; margin:14px 0 6px; }
  details.mod { background:var(--card); border:1px solid var(--line); border-radius:10px;
                margin-bottom:7px; overflow:hidden; }
  details.mod summary { cursor:pointer; padding:11px 14px; display:flex; align-items:center;
                        gap:10px; flex-wrap:wrap; list-style:none; }
  details.mod summary::-webkit-details-marker { display:none; }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .rot .dot { background:var(--rot); } .gelb .dot { background:var(--gelb); } .gruen .dot { background:var(--gruen); }
  .mname { font-weight:600; }
  .meta { color:var(--mute); font-size:12.5px; }
  .badge { margin-left:auto; font-size:12px; color:var(--mute);
           border:1px solid var(--line); border-radius:99px; padding:1px 9px; }
  .badge.ok { color:var(--gruen); }
  .body { padding:2px 14px 16px; border-top:1px solid var(--line); }
  .summary { margin:12px 0; max-width:70ch; }
  .summary.missing { color:var(--mute); font-style:italic; }
  ul.findings { margin:0 0 14px; padding-left:18px; }
  ul.findings li.rot { color:var(--rot); } ul.findings li.gelb { color:var(--gelb); }
  dl { display:grid; grid-template-columns:170px 1fr; gap:6px 14px; margin:0; font-size:13.5px; }
  dt { color:var(--mute); } dd { margin:0; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; background:var(--card);
          border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th { text-align:left; font-weight:600; color:var(--mute); font-size:12.5px; }
  th, td { padding:7px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  td.val code { white-space:nowrap; }
  .path { color:var(--mute); font-size:11.5px; margin-top:2px; }
  .knobgroup .count { color:var(--mute); font-weight:400; }
  ul.gaps { list-style:none; margin:0 0 8px; padding:0; }
  ul.gaps li { padding:7px 12px; border:1px solid var(--line); border-radius:8px;
               background:var(--card); margin-bottom:5px; }
  ul.gaps li.done { opacity:0.55; }
  .mark { font-size:11px; text-transform:uppercase; letter-spacing:0.04em; margin-right:8px; }
  li.open .mark { color:var(--gelb); } li.done .mark { color:var(--gruen); }
  footer { margin-top:56px; color:var(--mute); font-size:12.5px; border-top:1px solid var(--line); padding-top:14px; }
  .hidden { display:none !important; }
</style>
</head>
<body>
<div class="wrap">

<h1>Projekt-Atlas</h1>
<p class="lede">Diese Seite wird aus dem Repository gebaut, nicht von Hand geschrieben.
Jede Zahl stammt aus dem Code, aus git oder aus den Dokumenten. Sie beantwortet drei Fragen:
<b>Was gibt es?</b> — <b>Wo kann ich drehen?</b> — <b>Was fehlt noch?</b></p>

<div class="kpis">
  <div class="kpi"><b>${de(totals.loc)}</b><span>Zeilen Code in <code>src/</code></span></div>
  <div class="kpi"><b>${list.length}</b><span>Module · ${de(totals.moduleLoc)} Zeilen</span></div>
  <div class="kpi"><b>${totals.tables}</b><span>Datenbanktabellen</span></div>
  <div class="kpi"><b>${totals.decisions}</b><span>Entscheidungen (ADR)</span></div>
  <div class="kpi"><b>${totals.sprints}</b><span>Sprint-Protokolle</span></div>
  <div class="kpi"><b>${knobs.length}</b><span>Stellschrauben</span></div>
  <div class="kpi"><b>${offeneGaps}</b><span>Lücken-Einträge</span></div>
</div>
<div class="ampelbar">
  <span><b style="color:var(--gruen)">${gruen}</b> Module ohne Befund</span>·
  <span><b style="color:var(--gelb)">${gelb}</b> mit Hinweisen</span>·
  <span><b style="color:var(--rot)">${rot}</b> mit ernstem Befund</span>
</div>

<input id="suche" type="search" placeholder="Suchen — Modulname, Tabelle, Regler …" autocomplete="off">

<h2>Die Module</h2>
<p class="hint">Ein Modul ist ein abgegrenzter Teil des Systems. Rot heisst: hier fehlt etwas
Grundsätzliches (Beschreibung oder Tests). Gelb heisst: funktioniert, ist aber schwer zu warten —
zu gross, zu stark verflochten, oder zu dünn getestet. Zum Aufklappen anklicken.</p>
${moduleRows}

<h2>Verflechtung</h2>
<p class="hint">Wie stark ein Modul mit dem Rest verdrahtet ist. „Hängt daran" ist die wichtigere
Spalte: je höher, desto mehr bricht, wenn du dieses Modul änderst.</p>
<table>
  <thead><tr><th>Modul</th><th>Benutzt</th><th>Hängt daran</th><th>Zeilen</th></tr></thead>
  <tbody>${coupling}</tbody>
</table>

<h2>Woran zuletzt gearbeitet wurde</h2>
<p class="hint">Commits der letzten 90 Tage, pro Modul. Das ist die ehrlichste Antwort auf
„woran arbeiten wir gerade" — sie kommt aus git, nicht aus einem Plan.</p>
<table>
  <thead><tr><th>Modul</th><th>Commits (90 Tage)</th><th>Zuletzt</th></tr></thead>
  <tbody>${aktiv}</tbody>
</table>

<h2 id="schrauben">Stellschrauben</h2>
<p class="hint">Alle Regler des Systems an einer Stelle: Grenzen, Preise, Fristen, Zeitlimits.
Das sind die Werte, an denen man dreht, ohne Logik zu ändern. Gefunden in Dateien, die
Budgets, Preise, Richtlinien oder Limits enthalten.</p>
${knobBlocks}

<h2>Offene Lücken</h2>
<p class="hint">Aus <code>docs/ROADMAP.md</code>, nur die Schlagzeilen — der Fliesstext dazu steht
in der Datei. Eine Lücke ist etwas, das heute <em>nicht</em> stimmt oder fehlt, kein Wunschfeature.
„Erledigt" steht nur da, wo die ROADMAP es ausdrücklich sagt — der übrige Stand steckt im
Fliesstext der Datei und wird hier bewusst nicht geraten.</p>
${roadmapBlocks}

<footer>
Gebaut am ${esc(stamp.when)} aus Commit <code>${esc(stamp.commit)}</code> auf Branch <code>${esc(stamp.branch)}</code>.
Neu bauen mit <code>pnpm atlas</code>. Diese Datei liegt in <code>.atlas/</code> und gehört nicht ins Repository.
</footer>
</div>

<script>
  const suche = document.getElementById("suche");
  const treffer = [...document.querySelectorAll("[data-such]")];
  suche.addEventListener("input", () => {
    const q = suche.value.trim().toLowerCase();
    for (const el of treffer) {
      el.classList.toggle("hidden", q !== "" && !el.dataset.such.toLowerCase().includes(q));
    }
  });
</script>
</body>
</html>`;
}

// ------------------------------------------------------------------------- Lauf

const tables = readTables();
const modules = readModules(tables);
const allFiles = walk(join(ROOT, "src"));
const knobs = readKnobs(allFiles);
const decisions = readDecisions();
const roadmap = readRoadmap();

for (const d of decisions) {
  for (const name of d.modules) modules.get(name)?.decisions.push(d.number);
}
for (const k of knobs) {
  const name = k.file.match(/^src\/modules\/([a-z-]+)\//)?.[1];
  modules.get(name)?.knobs.push(k);
}

const sprintsDir = join(ROOT, "docs/sprints");
const totals = {
  loc: allFiles.reduce((n, f) => n + lines(f), 0),
  moduleLoc: [...modules.values()].reduce((n, m) => n + m.srcLoc + m.testLoc, 0),
  tables: tables.length,
  decisions: decisions.length,
  sprints: existsSync(sprintsDir)
    ? readdirSync(sprintsDir).filter((f) => /^\d{4}-/.test(f)).length
    : 0,
};

const stamp = {
  when: new Date().toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" }),
  commit: git(["rev-parse", "--short", "HEAD"], "unbekannt"),
  branch: git(["rev-parse", "--abbrev-ref", "HEAD"], "unbekannt"),
};

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, "index.html");
writeFileSync(out, render({ modules, knobs, decisions, roadmap, totals, stamp }), "utf8");

console.log(`Projekt-Atlas gebaut: ${relative(ROOT, out)}`);
console.log(
  `  ${modules.size} Module · ${knobs.length} Stellschrauben · ${decisions.length} Entscheidungen · ${totals.tables} Tabellen`,
);
