# Performance-, Datenbank-, Dead-Code- und Code-Health-Audit — 2026-09-01

**Scope:** vollständiger Performance-, Datenbank-, Caching-, Dead-Code- und Code-Health-Audit des aktuellen Repository-Stands — Rendering-Architektur, wahrgenommene Ladezeit, Next.js/React, Server/API/Execution, Supabase/PostgreSQL, Caching, Dead Code, Cleanup, Build/Bundle/Dependencies, Skalierung.
**Audited at:** Commit `f1dc651` (HEAD von `main` zum Auditzeitpunkt, identisch mit der Produktions-Deployment `dpl_HQoG5khr8jEY6Be4RzBSgng3u91H`) · 1.200 TS/TSX-Dateien (786 Nicht-Test, 414 Test), ~169k Nicht-Test-LOC, 97 Migrationen, 54 Live-Tabellen, 117 RLS-Policies, 283 Indizes.
**Method:** statische Lektüre aller Routen, Layouts, Server Actions, Stores und Migrationen; **lesende** Live-Diagnostik gegen das Vibe-Business-Supabase-Projekt (`pg_stat_statements`, `pg_stat_user_tables`, `pg_indexes`, `pg_policies`, `routine_privileges`, Performance-Advisor); Vercel-Projekt-Metadaten (Region, Build-Log, Web Analytics, Runtime-Errors); Quelltext von `@supabase/auth-js@2.112.4` zur Klärung der Session-Kosten; Repository-Qualitätsprüfungen (Abschnitt 12). Kein Produktivcode wurde verändert, nichts gelöscht, kein schreibendes Tool ausgeführt.
**Record status:** Audit-Record unter `docs/audits/` (CLAUDE.md Regel 83) — beschreibt den Stand bei `f1dc651` und wird nicht nachträglich an die Gegenwart angepasst.

Status-Vokabular: **Confirmed** (im Code oder live belegt) · **Probable** (aus Code abgeleitet, Laufzeitwirkung nicht gemessen) · **Needs Runtime Verification** (nur mit Messdaten entscheidbar). Severity: Critical / High / Medium / Low. Ein Vorgänger-Audit ([2026-08-26 Launch Readiness](../2026-08-26-launch-readiness/README.md), Commit `39a2bbf`) wird referenziert; seitdem liegen 191 Commits und +55k Zeilen dazwischen, und dessen Datenbank-/Performance-Findings VB-022 bis VB-027 wurden in Wave 2 (#119) bearbeitet — jede Aussage wurde deshalb neu verifiziert und nicht übernommen.

---

## 1. Executive Summary

**Gesamtzustand: strukturell gut, mit einem unmessbaren systemischen Verdacht und einer Handvoll konkreter Wasserfälle.** Die Codebasis hat bereits eine Performance-Runde hinter sich, und es zeigt: Read Models sind pro Route getrennt, Layouts laden nur Rahmen-Daten, hot JSONB-Dokumente sind per Request memoisiert, Polling läuft über einen Hook, der auf Zustandsübergänge statt Ticks refresht, Marketing-Seiten sind statisch, Fonts sind CLS-sicher, im Client gibt es kein `fetch`, keinen globalen State und keine Server-SDKs. Alle 117 RLS-Policies sind live in der Initplan-Form, nur zwei zusammengesetzte FK-Spalten sind ohne Index. Die Datenbank ist mit 23 MB und maximal 1.026 Zeilen pro Tabelle winzig; alle Anwendungsqueries laufen laut `pg_stat_statements` unter 1,2 ms im Mittel. **Die Datenbank-Ausführung ist heute nachweislich kein Engpass.**

**Wo Vibe Business heute am meisten Geschwindigkeit verliert** — in dieser Reihenfolge:

1. **Geografie (Confirmed als Konfiguration, Wirkung Needs Runtime Verification).** Die Vercel-Functions laufen in `iad1` (US-Ost), die Datenbank in `eu-north-1` (Stockholm). Jeder der 2.500–7.000 täglichen PostgREST-Roundtrips ist transatlantisch. Weil das Kostenmodell dieser Anwendung „Anzahl sequentieller Roundtrips“ ist (kein Connection-Pool, kein SQL-Batching), multipliziert diese eine Einstellung jeden Wasserfall unten mit geschätzt 80–120 ms. Es gibt keine Function-Duration-Daten, die das belegen (Hobby-Plan, 1 h Log-Retention) — deshalb ist es Phase 0, nicht Phase 1.
2. **Sequentielle Roundtrip-Ketten im Request-Pfad.** Der Produkt-Scan-Poll macht 3 sequentielle Reads alle 1,8 s; das Projekt-Layout plus Page lösen Session und Projekt je zweimal; Onboarding hat bis zu 11 sequentielle Awaits ohne `loading.tsx`; ein Operation-Start kostet 25–40 sequentielle Roundtrips.
3. **Zwei Read-Model-Aufrufer, die die bereits geladene Evidenz nicht weiterreichen** — Health/Home und Action Plan — und damit den VB-022-Fix an genau einer bzw. zwei Stellen aushebeln (Action Plan: ~3 vermeidbare Queries pro Move, ≈40 Queries pro Render bei 5 Moves).
4. **Ein quadratisches Muster im Agent-Gateway**: pro Modell-Request werden alle Usage-Zeilen des Runs gelesen und in JS summiert.
5. **Wahrgenommene Ladezeit**: nur die Agent-Route streamt hinter `<Suspense>`; Health/Home (~23 Queries) und Action Plan blocken das gesamte HTML; vier Routen haben gar kein `loading.tsx`.

**Frontend, Backend, Datenbank oder UX?** Backend-Wasserfälle (Roundtrip-Zahl × Distanz) dominieren. Datenbank-Ausführung: unkritisch. Frontend-Bundle: solide, mit einem klaren Posten (`motion/react` in 20 Dateien ohne `LazyMotion`, kein Bundle-Budget). UX: gute Skelette und Langläufer-Feedback, aber Lücken bei Suspense und fehlenden `loading.tsx`.

**Gibt es einen einzelnen systemischen Hauptengpass?** Ja, wahrscheinlich: die Region-Trennung iad1 ↔ eu-north-1. Sie ist die einzige Einstellung, die jeden anderen Befund verstärkt. Sie ist Konfiguration, nicht Code, und muss vor der Umsetzung gemessen werden (ein Timing-Span um einen Supabase-Call reicht).

**Bereits gut gelöst (nicht regressieren):** Layout/Read-Model-Trennung (`src/modules/projects/workspace-context.ts`), Batch-Read-Models (`src/lib/db/latest-per-change.ts`: 261 → 1 Roundtrips), `cache()` auf den sechs Dokument-Gettern, 10-Minuten-Stall-Schwelle gegen endloses Laden (`src/modules/operations/view.ts:46`), `freshestOperation`-Anti-Flicker, Refresh nur bei Zustandsübergang, server-entschiedene Disabled-States, Self-hosted Fonts mit `adjustFontFallback`, `claim_gateway_request` als serialisiertes UPDATE, Streaming plus `after()`-Accounting im Gateway, guarded Status-UPDATEs überall, Materialisierungs-Primitive exactly-once, saubere Tailwind-Klassen, 0 `TODO/FIXME`, 0 `@ts-ignore`, 0 leere `catch`.

**Vor Launch erledigen (Phase 1):** Repair-RPC-Grant-Mismatch (Reliability), `welcomeGranted`-Regression, Gateway-Upstream-Timeout, Gateway-Summen-RPC, zwei fehlende Indizes, In-Flight-Guard und Fehlerpfad im Poll-Hook, Messbarkeit (Phase 0) inklusive Region-Latenz-Messung.

**Später:** Suspense/loading-Lücken, `LazyMotion`, Evidence-Weitergabe, `cache()` für Session/Projekt, Produkt-Scan-Append-Batching, Dead-Code-Register, Supabase-`Database`-Typen, Retention-ADR, Bundle-Gate.

---

## 2. Verifizierter Systemüberblick

| Aspekt | Stand bei `f1dc651` |
|---|---|
| Branch / Commit | `main` @ `f1dc651fb0b290b649bab0e434189843e51475f0` (2026-09-01); Audit-Branch `claude/vibe-performance-audit-7xv9hl` |
| Framework / Runtime | Next.js 16.3.3 (Turbopack-Build, App Router), React 19.2.8, Node 24 auf Vercel (`engines >=20.9.0` löst Vercel-Warnung aus), pnpm 11.21.0, TypeScript 5, Tailwind 4 |
| Daten | `@supabase/supabase-js` 2.112.4 / `@supabase/ssr` 0.12.5 über PostgREST (kein `pg`-Treiber, kein Pool, keine App-Transaktionen); PostgreSQL 17.6 in `eu-north-1`; `pg_stat_statements` aktiv; `max_connections` 60, 13 Backends |
| Durable Execution | `workflow` 4.8.5 („use workflow"/„use step" in 16/19 Dateien, Routen unter `/.well-known/workflow/*`, vom Proxy ausgenommen) |
| Rendering | statisch: `/`, `/privacy`, `/terms`, `/robots.txt`, `/sitemap.xml`, `/icon.svg`; **dynamisch: alle `/app/**`, `/login`, `/signup`, `/forgot-password`, `/reset-password`** (Build-Log der Prod-Deployment); Proxy (Middleware) auf allen Routen außer statischen Assets, `api/health`, `.well-known/workflow` (`src/proxy.ts:24-26`) |
| Auth-Pfad | Proxy `getClaims()` → `app/layout.tsx` `requireSession()` → Gruppen-/Projekt-Layout `requireSession()` → Page/Action `requireSession()` = 3–4 Verifikationen pro Seitenaufruf. **Kosten geklärt:** das Projekt signiert **ES256** (JWKS-Endpoint liefert einen EC-Key); `auth-js` cacht JWKS prozessweit (`GLOBAL_JWKS`, TTL 10 min) → Verifikation lokal, kein Auth-Roundtrip pro Check |
| Caching | kein Next Data Cache, kein `"use cache"`, kein `revalidate`, kein ISR unter `/app` (korrekt: Tenant-Daten); React `cache()` auf 6 Dokument-Gettern; keine Client-Caches; keine Realtime-Abos, Live-Updates ausschließlich per Polling (14 Call-Sites, 1,8–15 s) |
| Regionen | **Vercel `regions: ["iad1"]`**, Supabase `eu-north-1` |
| Zentrale User Journeys | Signup/Login → Onboarding (Repo verbinden → Produkt-Scan → Audit) → Projekt-Home/Business Health → Action Plan → Agent (Run → Validation → Preview → Approval → Merge) → Experiments/Impact; Billing (Stripe) |
| Verfügbare Messdaten | Live-DB-Statistiken (`pg_stat_statements`, Tabellengrößen, Index-Nutzung, Advisor), Vercel Web Analytics (30 Tage: `/` 123 PV, `/login` 42, `/app/projects/[projectId]` 30, `/app/billing` 16, `/plan` 16, `/product` 15), Vercel Runtime-Errors (7 d: eine Gruppe, `ai_usage_events` 42501 am 27.08. — nach den Migrationen vom 27./28.08. vermutlich behoben, zu verifizieren), Build-Log |
| Fehlende Messdaten | **Function-Durations/p95** (Hobby-Plan: 1 h Log-Retention), **Speed Insights RUM** (gemountet, nicht abrufbar), Sentry-Traces, EXPLAIN-Pläne bei Volumen (heute sinnlos: 23 MB), Bundle-Analyzer-Output, Browser-Profiling, Lasttests |

Traffic-Realität: 85 Besucher auf `/` in 30 Tagen, einstellige Nutzerzahlen in der App. Web Analytics zeigt Zugriffe auf nicht mehr existierende Routen (`/score`, `/prepared`, `/understanding`) ohne Redirects — Bookmarks aus früheren Routenschnitten laufen ins 404.

---

## 3. Route- und Flow-Inventar

Legende: **Seq** = sequentielle Awaits, **Par** = `Promise.all`, **Q** ≈ PostgREST-Roundtrips auf dem Render-Pfad (bei greifendem `cache()`), **Ext** = externe Netzwerkaufrufe im Render.

| Bereich / Route | Rendering | Datenquellen | zentrale Queries / Requests | potenzielle Warteketten | Cache-Verhalten | Risiko |
|---|---|---|---|---|---|---|
| `/`, `/privacy`, `/terms`, robots, sitemap | statisch | Katalog in-memory | 0 | **Proxy `getClaims()` auch hier** (`src/proxy.ts:24-26`) | CDN-statisch | Low |
| `/login`, `/signup` | dynamisch (`searchParams`, `getSession`) | Supabase Auth (lokal) | 0 DB | Proxy redirectet Signed-in bereits; Page prüft erneut (`src/app/login/page.tsx:30`) | keins | Low |
| `/auth/callback`, `/auth/confirm` | Route Handler | Supabase Auth | 1 Auth-Call | — | — | Low |
| `/app` (Dashboard) | dynamisch | `getDashboardOverview`, `getOnboardingRouting` | 7–8 Q + Layout 2 Q | 5 sequentielle Awaits (`(account)/page.tsx:31-57`); `projects`-Read ohne Limit (`dashboard.ts:341-348`); **Redirect-Kette Neu-Nutzer `/app` → `/app/onboarding` → `/app/onboarding/{id}`** (3 Hops, ~13 Queries umsonst) | keins | Medium |
| `/app/products` | dynamisch | `getProductsOverview` = Dashboard + 3 | 10–11 Q | 5 Wellen | keins | Low |
| `/app/billing` | dynamisch | `getBillingOverview` | 12+ Q | `findCreditAccountByUser` → `findActiveSubscription` sequentiell trotz Unabhängigkeit (`billing/overview.ts:249-250`); `describeActivity` sequentiell im Rückgabe-Literal; **Repair-Writes im GET** (`:303-312`, bewusst per ADR 0042); `reportOrphanedHolds` schreibt Audit-Events in Schleife (`:576-588`); Wallet doppelt gelesen (Layout `getHeaderCreditBalance` 2 seq. Reads + Page) | keins | Medium |
| `/app/settings`, `/app/profile`, `/app/repositories` | dynamisch | 1–2 Q | 3–4 | eigenes `loading.tsx` fehlt → **Dashboard-Skeleton wird angezeigt** | keins | Low |
| `/app/onboarding` | dynamisch | `projects` (ohne Limit), `getOnboardingRouting` | 2–3 Q | **kein `loading.tsx`** | keins | Medium |
| `/app/onboarding/[projectId]` | dynamisch | `getProjectOnboarding` (1 + 9 par.), Scan-Events, `getAuditReadiness` (ohne Prefetch → 6 Q), Audit, Ops, Fehler | 15–20 Q | **bis 11 sequentielle Awaits** (`page.tsx:56-154`), **Milestone-Write + Audit-Event im Render** (`:136-152`) unter 2,5-s-Poll, Profil-JSONB pro Poll (`onboarding/store.ts:267`), **kein `loading.tsx`** | keins | **High** |
| `/app/connect/github`, `/accounts`, `/repositories` | Route/dynamisch | GitHub App API | N GitHub-Probes vor Redirect (`connect/github/route.ts:56-61`) | **kein `loading.tsx`**, GitHub im Render | keins | Medium |
| `projects/[projectId]/layout.tsx` | dynamisch | Projekt, Counts, GitHub-Identity, Switcher, Agent-Rail | 4 seq + 4 par | `prepared`-Count geladen, **nie gerendert** (`layout.tsx:78-99`); Projekt-Read erneut in jeder Page | keins | Low |
| Projekt-Home `/app/projects/[id]` und Alias `/health` | dynamisch | `readAuditEvidence` (5 JSONB) + 10 Read Models | **22–24 Q** | `getAuditAccessStatus` **liest Evidenz erneut** (`health/content.tsx:118`, `business-audit/service.ts:196-206`), `getDeepScanAccessStatus` 3 seq. Reads inkl. 4. Projekt-Read; **kein Suspense**; 3 Snapshot-`result`-Dokumente nur für Hash-Vergleich übertragen | `cache()` auf 5/6 Gettern; `getFounderIntent` nicht | **High** |
| My Product `/product` | dynamisch | 9-way `Promise.all` + Events | ~10 Q | sauber; `getActiveProductScanOperation` 2 seq. Reads ohne aktiven Scan | `cache()` | Low |
| Deep Scan `/product/deep-scan` | dynamisch, `maxDuration=120` | 5-way `Promise.all` | 5 Q | — | keins | Low |
| Action Plan `/plan` | dynamisch | 6-way Par, dann **N+1 pro Move** | **≈40 Q bei 5 Moves** | `getActionPlanReadiness` pro Move ohne Evidence (`plan/page.tsx:112-121`, `action-plans/service.ts:139-144`), `getOpportunityReadiness` ohne Evidence (`opportunities/service.ts:50`); **kein Suspense** | `cache()` teilweise; `getLatestOpportunities`, `getFounderIntent` nicht | **High** |
| Agent `/agent` | dynamisch, **Shell + `<Suspense>`** (`agent/page.tsx:113`) | `readAgentWorkspace` 4 Wellen + `getPreparedChangeWorkspaceItem` 3 Wellen | 20–30 Q | **GitHub-Reads**, Sandbox-Status, Storage-Signaturen im Render (`execution/workspace.ts:738,467-471,547`); 3. Projekt-Read (`:741`); Credit-Repair im Read (`agent-workspace.ts:167-172`) | keins | Medium (dank Suspense) |
| Experiments `/experiments` | dynamisch | `getProjectImpact` 3 Wellen, `limit(20)` | 6–10 Q | bewusst kein Suspense (dokumentiert `:30-41`); keine GitHub-Calls | keins | Low |
| Settings `/settings` | dynamisch | 3 seq. Awaits (`settings/page.tsx:51-67`), zwei unabhängig | 3 Q | — | keins | Low |
| Activity `/settings/activity` | dynamisch | 1 Q, `.range()`, Cap 200 | 1 Q | Offset-Pagination ohne Offset-Obergrenze | keins | Low |
| `agent-dogfood/*` | Redirect nach `requireProjectAccess` | 2 Q | 1 verschwendeter Hop | — | Low |
| `/e2e/[scenario]` | `force-dynamic`, env-gated 404 | — | 2.044 LOC Fixture-Fläche im Prod-Build | — | Low (VB-043) |
| `/api/health` | `force-dynamic`, proxy-frei | — | — | — | — |
| `/api/billing/stripe/webhook` | nodejs, `force-dynamic` | Stripe SDK (Defaults), Claim/Reclaim/Release | 3–5 Q | **nicht vom Proxy ausgenommen** (Supabase-SSR-Client + `getClaims` pro Delivery) | — | Low |
| `/api/agent-gateway/v1/messages` | nodejs, `maxDuration=300` | 3 seq. DB-Roundtrips vor Upstream, 1–2 danach | 5 Q pro Modell-Request | **Usage-Sum über alle Run-Zeilen pro Request** (`gateway-state.ts:82-94`), **Upstream-`fetch` ohne Timeout** (`route.ts:228-232`), 3× `createServiceClient()`; nicht vom Proxy ausgenommen | — | **High** |
| Server Actions (26 Dateien) | — | Session + Client je Action | variabel | Operation-Start 25–40 seq. Roundtrips (`operations/service.ts:211-400`, `credits/operation-billing.ts:156-330`) | — | High |
| Workflow-Steps (6 Workflows) | `/.well-known/workflow/*` | Service-Client | Produkt-Scan: **4 Roundtrips pro Event × ≤24** (`product-scan/store.ts:56-127`) | Agent-Workflow pollt alle 20 s bis 25 min | — | Medium |
| Status-Polls (Client) | Server Actions | 3–6 Q pro Tick | 14 Call-Sites, 1,8–15 s, **kein Backoff, kein In-Flight-Guard** (`use-operation-poll.ts:144-164`); Staleness-Sweep inline pro Poll (`operations/service.ts:435`) | — | High |
| Cron / Queue | keine (ADR 0013: alles Workflow; kein Retention-Job) | — | — | — | siehe PERF-018 |

**Kritischer Pfad der zentralen Journeys** (Roundtrips, sequentiell, jeweils transatlantisch):
- *Login → Dashboard*: Proxy (lokal) → Layout 2 Q → Page 5 Wellen → ggf. 2 Redirect-Hops.
- *Projekt-Home*: Proxy → App-Layout → Projekt-Layout (Projekt-Read, dann 4 par.) → Page (Projekt-Read erneut → Evidence 6 par. → 10 par. mit verschachtelten 2–3 seq.) ≈ 6 sequentielle Wellen.
- *Produkt-Scan läuft*: pro 1,8 s 3 seq. Q; im Workflow 4 Q pro Event.
- *Agent-Run*: pro Modell-Request 3 seq. Q vor dem Upstream.

---

## 4. Findings

### PERF-001 – Vercel-Functions in `iad1`, Datenbank in `eu-north-1`
- **Status:** Confirmed (Konfiguration) / Needs Runtime Verification (Latenzwirkung)
- **Severity:** Critical (bei Bestätigung der Latenz), sonst High
- **Bereich:** Server / Database
- **Betroffener Flow:** alle
- **Evidenz:** Vercel-Deployment `dpl_HQoG5khr8jEY6Be4RzBSgng3u91H` `regions: ["iad1"]`; Supabase-Projekt `dcbwlctscooefwnivxzv` `region: eu-north-1`; kein `vercel.json`, kein `preferredRegion` im Repo (grep leer).
- **Aktuelles Verhalten:** Jeder PostgREST-Roundtrip überquert den Atlantik. Weil die App keinen Connection-Pool und keine Multi-Statement-Transaktionen hat, ist „Roundtrips × RTT" das gesamte Kostenmodell.
- **Warum problematisch:** Ein Projekt-Home mit ~6 sequentiellen Wellen kostet allein an Netz geschätzt 0,5–0,7 s vor dem ersten Byte; der 1,8-s-Poll mit 3 sequentiellen Reads verbraucht ein Drittel seines Intervalls im Netz.
- **Auswirkung für Nutzer:** spürbar langsame Navigation und Polls in der gesamten App, unabhängig von jeder Code-Optimierung.
- **Auswirkung bei Skalierung:** konstant pro Request, also linear mit Traffic; verstärkt jeden anderen Wasserfall.
- **Empfohlene Lösung:** Messen (Phase 0: ein Sentry-Span oder Timing-Log um einen Supabase-Call), dann Vercel-Function-Region auf `arn1` (Stockholm) oder `fra1` setzen (Projekt-Setting oder `vercel.json`); als ADR festhalten, weil es Deployment-Infrastruktur betrifft.
- **Erwarteter Nutzen:** Reduktion jedes DB-Roundtrips von ~100 ms auf ~5–20 ms; mutmaßlich der größte einzelne Hebel.
- **Regression-Risiko:** niedrig; Nutzer in Europa (Zielmarkt `.de`) profitieren, Edge-Cache unberührt.
- **Verifikation nach Umsetzung:** Timing-Span vor/nach; Speed Insights TTFB der App-Routen.
- **Abhängigkeiten:** Phase 0 Messung.

### PERF-002 – Agent-Gateway summiert pro Modell-Request alle Usage-Zeilen des Runs
- **Status:** Confirmed · **Severity:** High · **Bereich:** Server / Database · **Flow:** Agent Execution
- **Evidenz:** `src/modules/operations/agent-execution/gateway-state.ts:82-94` (Select `output_tokens, status` ohne Limit, `reduce` in JS); Request-Obergrenzen 140/180/260 (`src/modules/coding-agent/budget.ts:159-173`); Index `ai_usage_events_job_lookup_idx` vorhanden (live).
- **Aktuelles Verhalten:** Pro Sampling-Request: Run-Read → Usage-Read (alle Zeilen) → Claim-RPC, sequentiell, dann Upstream. Übertragene Zeilen pro Run ≈ N²/2 (≈10k–34k).
- **Warum problematisch:** Quadratischer Transfer auf dem heißesten Pfad eines Runs; drei transatlantische Hops vor jedem Modell-Call (PERF-001). `max_rows = 1000` würde die Summe bei >1000 Zeilen **stumm falsch** machen (PERF-018).
- **Nutzer:** langsamere Agent-Runs; **Skalierung:** wächst mit Run-Länge und parallelen Runs.
- **Lösung:** SQL-Funktion `sum_run_output_tokens(uuid)` nach dem Muster von `sum_ledger_deltas` (Migration `20260828163645`); Run-Read und Summe in einem RPC oder parallel.
- **Nutzen:** 2 Roundtrips → 1 Skalar; Ende der Quadratik. **Risiko:** niedrig (reine Lese-Aggregation; Budget-Semantik unverändert, Test `route.test.ts` deckt Refusals). **Verifikation:** Route-Tests grün; `pg_stat_statements` zeigt die neue Funktion statt des Selects. **Abhängigkeiten:** Migration.

### PERF-003 – Poll-Hook ohne In-Flight-Guard, Backoff und Fehlerpfad
- **Status:** Confirmed · **Severity:** High · **Bereich:** Frontend / UX · **Flow:** alle Polls (14 Call-Sites)
- **Evidenz:** `src/lib/client/use-operation-poll.ts:144-164` (`setInterval(() => void tick(), intervalMs)`, kein `try/catch`, kein In-Flight-Flag); Intervalle 1.800 ms (`product-scan-experience.tsx:49`) bis 15.000 ms; Supabase-Deadline 15 s (`src/lib/net/bounded-fetch.ts:152`).
- **Verhalten:** Ein Tick, der länger dauert als das Intervall, überlappt mit dem nächsten; bei 1,8 s und 15 s Deadline bis ~8 parallele Server-Action-POSTs pro Client. Ein Reject ist eine unbehandelte Promise-Rejection; der Timer läuft weiter. `unavailable` beendet nie.
- **Warum problematisch:** Retry-Storm-Muster gegen ein degradiertes Backend; keine Nutzer-Rückmeldung bei Fehlern.
- **Nutzer:** stille Verschlechterung statt Meldung; **Skalierung:** N aktive Poller × Überlappung.
- **Lösung:** In-Flight-Guard (`if (inFlight) return`), `try/catch` mit Fehlerzähler, exponentielles Backoff bis z. B. 4× Intervall, optional Stopp nach k Fehlern mit Hinweis; Intervalle als benannte Tiers am Hook exportieren.
- **Nutzen:** keine Request-Stapel, klare Fehlerzustände. **Risiko:** niedrig, aber der Hook ist ohne DOM-Testumgebung ungetestet (Datei-Kommentar) → Logik in pure Funktionen auslagern und testen. **Verifikation:** Unit-Tests der Timing-Logik; Browser-E2E des Produkt-Scans. **Abhängigkeiten:** keine.

### PERF-004 – Health/Home: Evidenz wird von `getAuditAccessStatus` erneut gelesen, kein Suspense
- **Status:** Confirmed · **Severity:** High · **Bereich:** Server / UX · **Flow:** Business Health (meistbesuchte App-Route)
- **Evidenz:** `src/app/app/projects/[projectId]/health/content.tsx:98` lädt `evidence`; `:118` ruft `getAuditAccessStatus(supabase, {projectId, userId})` ohne Evidence; `src/modules/business-audit/service.ts:196-206` → `getAuditReadiness(supabase, projectId)` ohne `prefetched` → zweiter `readAuditEvidence`; `getFounderIntent` nicht memoisiert (`src/modules/projects/founder-intent-store.ts`, kein `cache(`); 5 weitere Entitlement-Reads + sequentieller `hasFreeAuditGrant` (`:209`). `getDeepScanAccessStatus` (`src/modules/authenticated-product-intelligence/service.ts:567-582`) 3 sequentielle Reads inkl. 4. Projekt-Read. Kein `<Suspense>` in der Datei. `readAuditEvidence` überträgt drei Snapshot-`result`-Dokumente, obwohl `isProfileCurrent` (`service.ts:140-146`) nur Ids/Hashes braucht.
- **Verhalten:** ≈22–24 Queries, mehrere hundert KB JSONB, alles vor dem ersten HTML-Byte.
- **Lösung:** `evidence`-Parameter für `getAuditAccessStatus`/`getAuditEntitlementFacts`; Projekt an `getDeepScanAccessStatus` durchreichen; schmale `*_ID_COLUMNS`-Varianten für die Snapshot-Getter im Evidence-Read; `<Suspense>` um den Body wie `agent/page.tsx:113` (Header `WorkspaceSection` malt sofort).
- **Nutzen:** −6–8 Queries, −~300 KB Transfer, sichtbarer Rahmen sofort. **Risiko:** niedrig (reine Weitergabe; Contract-Tests `dashboard-contract`/`workspace-routes` vorhanden). **Verifikation:** Query-Zählung im Test (Muster VB-023), Speed Insights LCP der Route.

### PERF-005 – Action Plan: N+1 über Moves mit Evidenz- und Opportunities-Neulesen
- **Status:** Confirmed · **Severity:** High · **Bereich:** Server · **Flow:** Action Plan
- **Evidenz:** `src/app/app/projects/[projectId]/plan/page.tsx:112-121` (`Promise.all(map(getActionPlanReadiness))`); `src/modules/action-plans/service.ts:139-144` (`getAuditCurrency(supabase, projectId)` ohne Evidence, `getLatestOpportunities` nicht memoisiert); `src/modules/opportunities/service.ts:50` ebenso.
- **Verhalten:** ~3 vermeidbare Queries pro Move (Founder-Intent + Set + Opportunities), ≈40 Queries pro Render bei 5 Moves, kein Suspense.
- **Lösung:** Evidence einmal lesen und an `getActionPlanReadiness`/`getOpportunityReadiness`/`getAuditCurrency` übergeben; `getLatestOpportunities` und `getFounderIntent` per `cache()` memoisieren; Readiness für alle Moves aus einem Aufruf ableiten (Inputs sind identisch bis auf die Move-Id).
- **Nutzen:** ≈40 → ≈15 Queries. **Risiko:** niedrig; Readiness-Semantik unverändert. **Verifikation:** Test zählt Roundtrips über den Fake-Client. **Abhängigkeiten:** PERF-004 (gleiche Signaturänderung).

### PERF-006 – Onboarding-Projektseite: bis 11 sequentielle Awaits, Writes im Render, kein `loading.tsx`
- **Status:** Confirmed · **Severity:** High · **Bereich:** Server / UX · **Flow:** Onboarding
- **Evidenz:** `src/app/app/onboarding/[projectId]/page.tsx:56-154` (Awaits), `:136-152` (`markOnboardingMilestone` + `recordAuditEvent` im Render, `firstView`-gated); `operation-watcher.tsx:8` 2.500 ms Poll mit `router.refresh()`; `src/modules/onboarding/store.ts:267` lädt `getLatestProfile` (JSONB) pro Poll; kein `loading.tsx` unter `src/app/app/onboarding/`; Redirect-Kette `/app` (8 Q) → `/app/onboarding` (2 Q) → `/app/onboarding/{id}` (`(account)/page.tsx:60`, `onboarding/page.tsx:23`).
- **Verhalten:** Erstnutzer sehen beim wichtigsten Erst-Erlebnis keine Lade-Rückmeldung und zahlen die längste sequentielle Kette der App alle 2,5 s.
- **Lösung:** unabhängige Awaits in `Promise.all` bündeln; `getAuditReadiness` mit Prefetch; Milestone-Write in eine Server Action beim ersten Client-Render verschieben; `loading.tsx` für `/app/onboarding` und `/[projectId]`; Onboarding-Routing im Dashboard vor den Dashboard-Reads entscheiden (eine `projects`-Abfrage genügt beiden).
- **Nutzen:** 7–11 → 3 Wellen; sofortiges Skeleton; keine 3-Hop-Redirects. **Risiko:** mittel (Onboarding-State-Maschine; `first-journey.test.ts` und E2E `product-scan.spec.ts` vorhanden). **Verifikation:** E2E-Onboarding grün, Query-Zählung.

### PERF-007 – Operation-Start: 25–40 sequentielle Roundtrips, Sweep als N+1
- **Status:** Confirmed · **Severity:** High · **Bereich:** Server / Database · **Flow:** Audit-, Opportunity-, Plan-, Scan-, Agent-Start
- **Evidenz:** `src/modules/operations/service.ts:211-400`; `src/modules/credits/operation-billing.ts:156-330` (`ensureCreditAccount` zweimal `:210,:224`); `src/modules/credits/grants.ts:218-267` (`sweepExpiredCredits`: 4 Awaits pro fälligem Lot); `src/modules/credits/contention.ts:53` (`CONTENTION_ATTEMPTS = 10`), `lot-store.ts:354-395` CAS pro Lot; `operations/store.ts:594-611` zwei sequentielle Count-Queries.
- **Verhalten:** Jeder Klick auf „Audit starten" durchläuft Identität → Reuse → Race-Check → 2 Counts → Insert → Admission (Sweep, Hold-CAS, Allocation-CAS pro Lot) → Audit-Event → Workflow-Start → Attach.
- **Warum problematisch:** Die Kette ist korrekt (Billing zuerst, Idempotenz), aber viele Glieder sind unabhängig. Unter Contention bis 20 Roundtrips + ~825 ms Backoff pro CAS.
- **Lösung:** parallelisierbare Präfixe bündeln (Counts, Identität/Reuse), Sweep als eine Batch-Operation (Lots sammeln, Ledger-Einträge als Array, ein Audit-Event), doppelten `ensureCreditAccount` auf einen Re-Read nach dem Sweep reduzieren. **Nicht** die CAS-Attempts kürzen (Sprint 0057 E2b hat 3 als zu wenig gemessen).
- **Nutzen:** ~30 → ~15 Roundtrips beim Start. **Risiko:** mittel–hoch (Billing-Korrektheit; Concurrency-Gate in CI existiert). **Verifikation:** `pnpm billing:concurrency` grün, Query-Zählung im Fake. **Abhängigkeiten:** keine.

### PERF-008 – Produkt-Scan-Event-Append: 4 Roundtrips pro Event, sequentiell
- **Status:** Confirmed · **Severity:** High · **Bereich:** Server / Database · **Flow:** Produkt-Scan
- **Evidenz:** `src/modules/product-scan/store.ts:56-127` (Run-Check, Event-Key-Check, Max-Sequence, Insert, bei 23505 Re-Read); Schleifen `src/modules/operations/product-scan/execution.ts:101-102,176-177`; Unique `(operation_run_id, event_key)` und `(operation_run_id, sequence)` in `20260825120000_product_scan_events.sql:38-39`; Cap 24 Events.
- **Verhalten:** bis 96 sequentielle Roundtrips pro Scan im Workflow-Step, während der Client alle 1,8 s pollt.
- **Lösung:** ein `INSERT … ON CONFLICT (operation_run_id, event_key) DO NOTHING RETURNING` bzw. Array-Upsert je Event-Batch; Sequenz aus der Batch-Position ableiten.
- **Nutzen:** 96 → ≤4 Roundtrips; Events erscheinen früher im Poll. **Risiko:** niedrig (Constraints tragen die Semantik bereits). **Verifikation:** Store-Tests, E2E Produkt-Scan.

### PERF-009 – Gateway-Upstream-`fetch` ohne Timeout
- **Status:** Confirmed · **Severity:** High · **Bereich:** Server · **Flow:** Agent Execution
- **Evidenz:** `src/app/api/agent-gateway/v1/messages/route.ts:228-232` (bare `fetch`, kein `signal`); einzige externe Verbindung ohne `withBoundedFetch`; einzige Grenze `maxDuration = 300` (`:82`).
- **Verhalten:** Ein hängender Upstream-Socket hält eine Node-Function 300 s.
- **Lösung:** `AbortSignal.timeout(...)` passend zum Streaming (Verbindungs-/First-Byte-Timeout, nicht Gesamtdauer) und Refusal-Accounting wie bei Fehlern.
- **Nutzen:** begrenzte Function-Zeit, schnellere Fehlerpfade. **Risiko:** niedrig. **Verifikation:** Route-Test mit hängendem Fake-Upstream.

### PERF-010 – Fehlende Indizes für Start-Window-Counts und Spend-Watch
- **Status:** Confirmed (Index-Bestand live) / Needs Runtime Verification (Wirkung) · **Severity:** High (bei Volumen) · **Bereich:** Database · **Flow:** jeder Operation-Start, jeder bezahlte Call
- **Evidenz:** live `pg_indexes`: `operation_runs` hat auf `user_id` nur Partial-Indizes (`single_active_account_idx`, `active_erasure_idx`), keinen `(project_id|user_id, operation_type, created_at)`; `ai_usage_events` hat `(user_id)` aber kein `(user_id, created_at)`. Queries: `src/modules/operations/store.ts:594-611`, `src/modules/credits/spend-watch.ts:109-114` (bis 500 Zeilen, 24-h-Fenster). Ursache: FK-Index-Generator `20260827202440_wave2_database_hygiene.sql:113-120` prüft nicht `indpred is null` → 6 FKs nur partial abgedeckt (`operation_runs.user_id`, `billing_credit_grants.credit_account_id`, `execution_interrupts.agent_execution_run_id`, `change_outcome_verifications.project_id`, `business_outcome_measurements.project_id`, `repository_connections.project_id`).
- **Verhalten heute:** irrelevant (152 Runs). **Bei Skalierung:** Counts und Spend-Watch scannen die gesamte Nutzer-Historie.
- **Lösung:** Migration mit `create index concurrently` für `operation_runs (user_id, operation_type, created_at desc)`, `operation_runs (project_id, operation_type, created_at desc)`, `ai_usage_events (user_id, created_at desc)`; Generator um `indpred is null` ergänzen und erneut laufen lassen.
- **Nutzen:** O(Fenster) statt O(Historie). **Risiko:** niedrig (CONCURRENTLY außerhalb einer Transaktion). **Verifikation:** `EXPLAIN (ANALYZE, BUFFERS)` auf einem seeded Branch mit 100k Zeilen.

### PERF-011 – Repair-RPCs nur für `service_role` ausführbar, Aufrufer ist der Cookie-Client
- **Status:** Confirmed (Code + Live-Grants) · **Severity:** High (Reliability, nicht Latenz) · **Bereich:** Database / Server · **Flow:** Billing
- **Evidenz:** live `routine_privileges`: `repair_account_balance`, `repair_lot_allocation` EXECUTE nur `postgres`, `service_role` (Migration `20260823010000_billing_reconciliation_primitives.sql:300-301`); Aufruf `src/modules/credits/service.ts:220` → `credits/store.ts:718` mit dem `supabase`-Client, den `getBillingOverview` von der Billing-Page erhält (RLS-Cookie-Client). `sum_ledger_deltas` ist dagegen für `authenticated` freigegeben.
- **Verhalten:** Bei `BILLING_REPAIR_ENABLED=true` und Drift antwortet PostgREST 42501; der Fehler wird gefangen und als `credit_drift.repair_failed` pro Render auditiert. Der Repair-Pfad kann von der Billing-Page **nie** erfolgreich sein.
- **Lösung:** Entweder Repair über einen der reviewten Service-Role-Aufrufer (Regel 53, `REVIEWED_SITES`) oder gezielten EXECUTE-Grant an `authenticated` mit Ownership-Check in der Funktion (ADR-0042-konform). Die Aktivierungs-Checkliste (`docs/deployment/billing-reconciliation-sprint-f-activation.md:65`) entsprechend korrigieren.
- **Nutzen:** Repair-Layer funktioniert; kein Audit-Spam. **Risiko:** mittel (Billing-Autorität). **Verifikation:** Probe gegen Branch-DB mit erzeugter Drift; Audit-Log zeigt `credit_drift.repaired`.

### PERF-012 – `welcomeGranted` aus gekapptem Ledger-Fenster
- **Status:** Confirmed · **Severity:** Medium (Korrektheit, wächst mit Kontoalter) · **Bereich:** Server · **Flow:** Billing
- **Evidenz:** `src/modules/billing/overview.ts:327` über `entries` aus `listLedgerEntries` mit `LEDGER_READ_LIMIT = 100` (`src/modules/credits/store.ts:228`, `created_at desc`); Welcome-Grant ist der älteste Eintrag.
- **Verhalten:** Ab >100 Ledger-Einträgen wird `welcomeGranted` falsch `false`.
- **Lösung:** gezielter `.eq("idempotency_key", welcomeKey).limit(1)`-Read oder Flag am Konto. **Risiko:** niedrig. **Verifikation:** Unit-Test mit 101 Einträgen.

### PERF-013 – Session und Projekt pro Request mehrfach aufgelöst, ohne Memoisierung
- **Status:** Confirmed · **Severity:** Medium · **Bereich:** Server · **Flow:** alle `/app`-Routen
- **Evidenz:** `src/lib/supabase/proxy.ts:109`, `src/app/app/layout.tsx:11`, `src/app/app/projects/[projectId]/layout.tsx:65`, `src/modules/projects/workspace-context.ts:158` (4× `getClaims`), 3× `createClient()`; Projekt-Read in Layout (`workspace-context.ts:106`) und Page (`:161`), auf der Agent-Route ein drittes Mal (`execution/workspace.ts:741`); `prepared`-Count im Layout geladen, nie gerendert (`layout.tsx:78-99`). `getSession`, `getProjectWithRepository`, `getGithubIdentity` ohne `cache(`.
- **Bewertung:** `getClaims` ist wegen ES256 lokal — die Verifikation kostet wenig. Der Projekt-Read ist ein echter Roundtrip pro Layout+Page. Das doppelte Ownership-Gate ist **bewusst** (Layouts gaten nicht) und bleibt; `cache()` erhält beide Prüfungen und spart die zweite Query.
- **Lösung:** `cache()` um `getSession`, `createClient` (pro Request), `getProjectWithRepository`, `getGithubIdentity`; `prepared`-Count aus dem Layout entfernen oder rendern.
- **Nutzen:** −1–2 Roundtrips pro Navigation, −1 Count. **Risiko:** niedrig; Autorisierungssemantik unverändert (gleicher Request, gleiche Cookies). **Verifikation:** `route-guard`/`workspace-routes`-Tests grün; Query-Zählung.

### PERF-014 – `motion/react` in 20 Client-Dateien ohne `LazyMotion`; kein `next/dynamic`; kein Bundle-Budget
- **Status:** Confirmed (Import-Form) / Needs Runtime Verification (kB) · **Severity:** Medium · **Bereich:** Frontend · **Flow:** Projekt-Workspace, Agent, Plan, Produkt-Scan
- **Evidenz:** 20 Treffer `from "motion/react"`, 0 `LazyMotion`, 0 `next/dynamic`; VB-046 nannte 3 Dateien. Kein Analyzer/Size-Limit in `package.json`, `next.config.ts`, CI.
- **Lösung:** `LazyMotion` + `m` aus `motion/react-m` + `domAnimation` in den Workspace-Layouts; `next/dynamic` für `product-scan-experience.tsx` (1.151 LOC) und `audit-intelligence.tsx` (774 LOC); einmalig `@next/bundle-analyzer` lesen, dann ein Size-Gate in CI.
- **Nutzen:** geschätzt 30–45 kB gz pro Workspace-Chunk (zu messen). **Risiko:** niedrig (Motion-API bleibt). **Verifikation:** Analyzer vor/nach.

### PERF-015 – Loading-UX-Lücken und Skeleton-Text-Drift
- **Status:** Confirmed · **Severity:** Medium · **Bereich:** UX · **Flow:** Onboarding, GitHub-Connect, Account-Seiten, Experiments/Settings
- **Evidenz:** kein `loading.tsx` unter `src/app/app/onboarding/**` und `src/app/app/connect/**`; `/app/settings|profile|repositories` erben `(account)/loading.tsx` (Dashboard-Skeleton mit Produkt-Grid); Textabweichung `experiments/loading.tsx:17` vs `experiments/page.tsx:62` und `settings/loading.tsx:17` vs `settings/page.tsx:76` (sichtbarer Text-Swap beim Laden). Einzige Suspense-Grenze: `agent/page.tsx:113`.
- **Lösung:** vier `loading.tsx` ergänzen, drei routenspezifische ersetzen, Beschreibungstexte aus einer Quelle ziehen; Suspense auf Health und Plan (siehe PERF-004/005).
- **Risiko:** minimal. **Verifikation:** Browser-E2E-Screens.

### PERF-016 – Proxy auf Marketing-Routen und ohne Deadline
- **Status:** Confirmed · **Severity:** Medium · **Bereich:** Server · **Flow:** `/`, `/privacy`, `/terms`, sitemap, robots, Webhook, Gateway
- **Evidenz:** `src/proxy.ts:24-26` (Matcher), `src/lib/supabase/proxy.ts:69-97` (Client ohne `withBoundedFetch`, im Gegensatz zu `server.ts:34-38`); `getClaims()` `:109`.
- **Verhalten:** Statische Seiten und der Stripe-Webhook durchlaufen Session-Refresh; ein hängender Auth-Call hat auf dem request-kritischen Pfad keine Deadline (fällt offen, aber spät).
- **Lösung:** Matcher um Marketing/Legal/Sitemap/Robots/`api/billing/stripe/webhook`/`api/agent-gateway` erweitern (dort prüft jeder Handler selbst); `withBoundedFetch` auf den Proxy-Client.
- **Risiko:** niedrig; Auth-Gate bleibt `requireSession`. **Verifikation:** Proxy-Tests, E2E Login-Redirect.

### PERF-017 – Billing-Overview: unabhängige sequentielle Reads, Repair-Writes im GET
- **Status:** Confirmed · **Severity:** Medium · **Bereich:** Server · **Flow:** Billing
- **Evidenz:** `src/modules/billing/overview.ts:249-250` (Account → Subscription sequentiell), `:303-312` (Repair-Writes, ADR 0042 read-triggered), `:576-588` (Audit-Events in Schleife), `:340` `describeActivity` sequentiell; Header-Balance `:509-516` zwei sequentielle Reads; `listAllocationsForGrants` ohne Limit (`lot-store.ts:607`).
- **Bewertung:** Read-triggered Repair ist eine bewusste ADR-Entscheidung; Kosten sind dokumentiert und mit `BILLING_REPAIR_ENABLED` schaltbar. Nur die Sequenzialität ist vermeidbar.
- **Lösung:** `Promise.all([account, subscription])`; Audit-Events der Orphan-Reports als ein Batch-Insert; Header-Balance an die Page durchreichen.
- **Risiko:** niedrig. **Verifikation:** Billing-Tests.

### PERF-018 – Keine Retention; `max_rows = 1000` schneidet unbounded Reads stumm ab
- **Status:** Confirmed (Code/Config) / Needs Runtime Verification (Prod-`max_rows`) · **Severity:** High (langfristig) · **Bereich:** Database · **Flow:** alle Append-only-Tabellen
- **Evidenz:** einzige DELETEs `src/modules/operations/account-erasure/store.ts:96`, `src/modules/billing/store.ts:398`; `supabase/config.toml:18` `max_rows = 1000`; unbounded Reads u. a. `gateway-state.ts:82-85`, `lot-store.ts:182,607`, `action-plans/store.ts:365`, `completion-store.ts:54-92`, `operations/store.ts:247`.
- **Verhalten:** Tabellen wachsen unbegrenzt (`audit_events`, `ai_usage_events`, `billing_*`, `operation_runs`, Event-Tabellen). Bei >1000 Zeilen liefert PostgREST einen **korrekt aussehenden, aber unvollständigen** Datensatz — für eine Summe oder Vollständigkeitsannahme ist das ein falsches Ergebnis, kein Timeout.
- **Lösung:** ADR für Retention/Archivierung (Regel 24: braucht eine Entscheidung, keine stille Cron); bis dahin jeden Vollständigkeits-Read entweder aggregieren (RPC) oder explizit paginieren; `.limit()` dort, wo Unvollständigkeit harmlos ist.
- **Risiko:** ADR-Aufwand. **Verifikation:** `pg_stat_user_tables` monatlich; Test, der `max_rows`-Verhalten gegen den Gateway-Summen-Read simuliert.

### PERF-019 – Migrationen: 13× Drop/Re-Add des `operation_type`-CHECK ohne `NOT VALID`; kein Regressionsschutz für Policy-Form
- **Status:** Confirmed · **Severity:** Medium (Deploy-Zeit) · **Bereich:** Database
- **Evidenz:** 13 Migrationen (`20260812030000` … `20260827070000`) mit `drop constraint … add constraint operation_runs_operation_type_check`; `grep -i "not valid"` nur als Kommentar (`20260817140000:72`). Initplan-Rewrite katalogbasiert (`20260827202440:33-74`), Migrationstext ≠ deployter Text; kein Test erzwingt `(select auth.uid())` in neuen Policies (die zwei neuen Policies seit dem Rewrite sind korrekt).
- **Lösung:** Playbook `ADD CONSTRAINT … NOT VALID` + separates `VALIDATE CONSTRAINT`; Migrationstest, der `pg_policies` auf die gewrappte Form prüft.
- **Risiko:** minimal. **Verifikation:** `pnpm db:test`.

### PERF-020 – Staleness-Sweep inline pro Status-Poll
- **Status:** Confirmed · **Severity:** Low–Medium · **Bereich:** Server · **Flow:** alle Polls
- **Evidenz:** `src/modules/operations/service.ts:435` → `src/modules/operations/staleness.ts:154-196` (neuer Service-Client + PK-Read pro Poll).
- **Bewertung:** Bewusstes Design (kein Cron, Regel 24). Kosten: ein Roundtrip pro Poll pro aktivem Nutzer.
- **Lösung:** Sweep nur ausführen, wenn `started_at + deadline` überschritten ist (Vergleich im Speicher aus dem bereits gelesenen Run), sonst überspringen.
- **Risiko:** niedrig. **Verifikation:** Staleness-Tests.

### PERF-021 – Hydration- und Layout-Shift-Risiken
- **Status:** Probable · **Severity:** Low · **Bereich:** Frontend
- **Evidenz:** `preview-panel.tsx:212` (`useState(() => Date.now())`), `deep-scan-panel.tsx:71` (`Date.now()` im Render), `agent/agent-file-activity.tsx:48` und `modules/coding-agent/ui/format.ts:63` (`toLocale*` ohne Locale); `<img>` ohne Maße `review-panel.tsx:109`, `components/brand/product-logo.tsx:73`.
- **Lösung:** Server-Zeitstempel als Prop, `format-datetime.ts` konsequent nutzen, `width/height` bzw. `aspect-ratio`.
- **Verifikation:** Hydration-Warnungen in Dev-Konsole; CLS in Speed Insights.

### PERF-022 – Roher Sandbox-Output im Log; `alertOperator` nur teilweise ausgerollt
- **Status:** Confirmed · **Severity:** Medium (Sicherheit/Hygiene) · **Bereich:** Cleanup · **Flow:** Agent Execution
- **Evidenz:** `src/modules/operations/agent-execution/execution.ts:507-511` loggt `harness.output.slice(-2_000)` (Customer-`postinstall`-Ausgabe) an `redactCredentials` vorbei; 68 `console.*` in 34 Dateien, `alertOperator` in 8 Dateien (VB-012 halb geschlossen).
- **Lösung:** Output durch `redactCredentials`/`alertOperator`; Migration der verbleibenden `console.error`-Sites.
- **Risiko:** minimal.

### PERF-023 – Redirect-Kette und Bookmark-404s
- **Status:** Confirmed · **Severity:** Low · **Bereich:** UX
- **Evidenz:** siehe PERF-006; Web Analytics zeigt `/score`, `/prepared`, `/understanding` ohne Redirect; `/health` ist bewusst Alias (`health/page.tsx`).
- **Lösung:** `redirects()` in `next.config.ts` für die drei Alt-Routen; Onboarding-Entscheidung vor Dashboard-Reads.

### PERF-024 – Build-Log-Noise und Build-Cache
- **Status:** Confirmed · **Severity:** Low · **Bereich:** Cleanup
- **Evidenz:** Build-Log: `[auth.session] Supabase is not configured; treating as signed out` 24× während „Generating static pages" (Ursache: `DynamicServerError` aus `cookies()` wird in `src/modules/auth/session.ts:35-43` als „nicht konfiguriert" geloggt); Build-Cache 900 MB; `engines`-Warnung.
- **Lösung:** `DynamicServerError` in `getSession` durchreichen statt loggen; `engines` auf `24.x` pinnen.

### PERF-025 – Stale Aussagen in Current-State-Dokumenten (Regel 83)
- **Status:** Confirmed · **Severity:** Low · **Bereich:** Cleanup
- **Evidenz:** CLAUDE.md Regel 38 verbietet Browserbase/Playwright, beide sind Prod-Dependencies unter ADR 0012/0017 (die Regel 38 nicht als amendiert nennen); `next.config.ts:21-26` „Known gap: `browsers.json` not traced" vs. `patches/playwright-core@1.62.1.patch`, der genau das adressiert; `src/lib/docs/documentation-currency.test.ts:38-41` verweist auf einen ROADMAP-Eintrag zu Stub-Verzeichnissen, der nicht existiert; UX-CONTRACT/1,8-s-Poll (VB-044) nur teilweise geschlossen; `agent-dogfood/`-Verzeichnis ist produktiv (`agent/agent-start-action.tsx:14`).
- **Lösung:** Regel 38 auf den öffentlichen Scan eingrenzen und ADR 0012 als Amendment eintragen; Kommentar oder Patch korrigieren; ROADMAP-Eintrag nachtragen oder Testkommentar korrigieren; `agent-dogfood` umbenennen.

---

## 5. Dead-Code-Register

Alle Kandidaten wurden gegen Next-Konventionen, dynamische Imports, String-Referenzen, Tests, Scripts, vitest-/playwright-Configs, Migrationen und Doku-Zitate geprüft. Kein Tool-Ergebnis wurde ungeprüft übernommen; Knip war ohne Installation nicht verfügbar und wurde nicht ausgeführt.

| ID | Kandidat | Evidenz | Einstufung | Risiko beim Entfernen | Verifikation |
|---|---|---|---|---|---|
| DEAD-001 | `src/components/marketing/business-map-preview.tsx` (98 LOC) | einziger Referenzierer `src/app/landing-contract.test.ts:46`, der selbst sagt, nichts importiere die Datei mehr | sicher entfernbar | keins | Test-Kommentar anpassen, `pnpm test` |
| DEAD-002 | `__resetBrowserProviderCacheForTests`, `__resetAIProviderCacheForTests`, `__resetSupabaseServiceEnvCacheForTests`, `__resetBrowserbaseEnvCacheForTests` | `browserbase/client.ts:36`, `ai/anthropic/client.ts:42`, `lib/env/supabase-service.ts:69`, `lib/env/browserbase.ts:71`; 0 Test-Aufrufer | sicher entfernbar | keins | grep leer, `pnpm test` |
| DEAD-003 | `hasSupabaseServiceRoleKey` (`lib/env/supabase-service.ts`) | 0 Referenzen | sicher entfernbar | keins | grep |
| DEAD-004 | UI-Exports `textActionClasses` (`ui/button.tsx`), `HomeIcon`/`ExperimentsIcon`/`CloseIcon` (`ui/dashboard-icons.tsx`), `CategoryChip` (`ui/status-pill.tsx`), `creditPriceLabel` (`ui/credit-price.tsx`), `productIsSetup` (`products/product-list-state.ts`), `ExecutionTimeline`/`ChangedFilesPanel`/`DeveloperInspector` (`coding-agent/ui/agent-execution-live-view.tsx`) | 0 Referenzen außerhalb der Datei | sicher entfernbar | keins | grep, typecheck |
| DEAD-005 | Fixture-Exports `fakeLens`, `treeFrom`, `approvalIdentityForFixture` | `action-plans/test-support.ts`, `repository-intelligence/test-support.ts`, `merge/test-support.ts`; 0 Aufrufer | sicher entfernbar | keins | `pnpm test` |
| DEAD-006 | `public/brand/vibe-credit.svg`, `vibe-credit-stack.svg`, `favicon-credit.svg`, `public/email/vibe-mark.png` | 0 Referenzen in `src`, `docs`, `e2e`; nur in `public/brand/README.md` gelistet | sicher entfernbar | keins | README aktualisieren |
| DEAD-007 | `premium-audit.json` (Repo-Root) | generiertes Artefakt eines externen Skills, 0 Findings, enthält `projectRoot: /Users/tobibayer/...` | sicher entfernbar (+ `.gitignore`) | keins | — |
| DEAD-008 | `premium-ui.json` | Input-Config eines externen Skills (`<skill-dir>`-Platzhalter), referenziert nicht existierende Route `business-brain`; kein Script/CI/Doku nutzt sie | wahrscheinlich entfernbar, Verifikation nötig | keins im Code | Nutzer fragen, ob der Skill noch verwendet wird |
| DEAD-009 | `startProductUnderstandingOperation`, `getActiveProductUnderstandingOperation` (`operations/service.ts:638` ff.) | 0 Caller; `onboarding/first-journey.test.ts:83` asserts Abwesenheit; VB-052 offen; Operation-Familie selbst bleibt live (Executor, Kill-Switch, Rate-Card) | wahrscheinlich entfernbar, Verifikation nötig | niedrig (nur Start-Pfad) | grep, Tests, Executor-Registrierung prüfen |
| DEAD-010 | ~60 verwaiste Domain-Funktionen (u. a. `evaluateMergeEligibility`, `getChangeMerge`, `buildProductDna`-Familie, `grantCredits`, `reserveCredits`, `cancelAgentRun`, `listActionPlans`, `recordValidatedArtifact`, `normalizeCheckoutSession`, Detektor-Helfer) | 0 Referenzen, keine Doku-Zitate | wahrscheinlich entfernbar, **einzeln** verifizieren | mittel: einige sind der einzige typisierte Lesepfad einer Tabelle (Store-Symmetrie) | pro Funktion: Migrationen, Probes, Doku |
| DEAD-011 | `scripts/uis1-screenshots.mjs`, `scripts/uis2-screenshots.mjs` + Env `BASE_URL`, `OUT_DIR`, `CHROMIUM_PATH` | kein `package.json`-Script, keine Doku; Output liegt in `docs/audits/2026-08-17-product-ux-audit/screenshots/` | wahrscheinlich entfernbar | keins | Nutzer fragen oder als Script dokumentieren |
| DEAD-012 | `src/types/README.md` (Stub) | Begründung „keine Business-Tabellen" ist mit 97 Migrationen falsch | wahrscheinlich entfernbar oder durch generierte Typen ersetzen | keins | — |
| DEAD-013 | stale `minimumReleaseAgeExclude` für `workflow@4.8.2`, `@workflow/core@4.8.2` (`pnpm-workspace.yaml:19-31`) | installiert 4.8.5 | wahrscheinlich entfernbar | keins | `pnpm install --frozen-lockfile` |
| DEAD-014 | redundanter Index `sandbox_usage_events_preview_idx` | live: vollständig vom Partial-Unique `preview_unique_idx` abgedeckt | wahrscheinlich entfernbar (Migration) | keins | `pg_stat_user_indexes` |
| DEAD-015 | 83 „unused_index"-Advisor-Treffer / 121 Indizes mit `idx_scan = 0` | 23 MB Datenbank, viele davon FK-Indizes für die Lösch-Kaskade | **nicht entfernen** (kein Beweis bei diesem Volumen) | Kaskaden/RLS-Prädikate | in 6 Monaten mit Traffic erneut prüfen |
| DEAD-016 | `src/modules/coding-agent/claude/` (Adapter + Tools, 0 Importer) | absichtlich verwaist; `execution-contract/security.test.ts:355-410` bewacht die Konfination | nicht entfernen | — | — |
| DEAD-017 | Stub-READMEs `src/modules/audits`, `previews`, `usage` | dokumentierte reservierte Grenzen | nicht entfernen | — | — |
| DEAD-018 | `src/modules/economy/*` ohne Prod-Consumer (7 von 31 Dateien) | READ-only-Analyse per README + `isolation.test.ts`; von `docs/business/*` zitiert | nicht entfernen | — | — |
| DEAD-019 | `src/app/e2e/**` (2.044 LOC im Prod-Build) | env-gated 404 (`page.tsx:164`), Guard-Test | nicht entfernen; VB-043 schließen | — | — |
| DEAD-020 | `src/app/app/projects/[projectId]/agent-dogfood/` | **produktiv genutzt** (`agent/agent-start-action.tsx:14`) | nicht entfernen, umbenennen | — | — |
| DEAD-021 | `patches/playwright-core@1.62.1.patch`, `@browserbasehq/sdk`, `playwright-core`, `typescript` als Prod-Dep | alle genutzt (`render-impact.ts:1` importiert `typescript` zur Laufzeit) | nicht entfernen | — | — |
| DEAD-022 | 6 `(): true`-Invarianten-Exports (`mergeIsNotDeployment` etc.) | ausführbare Dokumentation | nicht entfernen | — | — |
| DEAD-023 | `console.info`-Telemetrie in `execution.ts:489,615,2085` | bewusst, begründet | nicht entfernen (Level-Gate erwägen) | — | — |

Umfang: sicher entfernbar ≈250 LOC + 4 Assets + 1 Artefakt; wahrscheinlich entfernbar ≈1.400 LOC (überwiegend DEAD-010). Dependencies: keine ungenutzte.

Cleanup-Kandidaten ohne Löschcharakter (Track H): 5 `sleep`-Implementierungen (3 nach `src/lib/async/`), 16 Inline-Kopien von `error instanceof Error ? error.message : …` mit 4 Truncation-Längen → ein `errorDetail()`; `AGENT_POLL_INTERVAL_MS = 20_000` doppelt (`economy/workflow-invocation-cost.ts:33`, `operations/agent-execution/workflow.ts:207`; Kostenmodell hängt am Gleichstand, Isolation-Regel verhindert Import → Gleichheits-Test); 11 `POLL_INTERVAL_MS`-Konstanten mit 5 Werten; 90 `as unknown as Row`-Casts → generierte Supabase-`Database`-Typen; `tsconfig` ohne `noUnusedLocals/noUnusedParameters`; `eslint-disable react-hooks/exhaustive-deps` unbegründet (`repositories-index.tsx:139`); `capture.ts:101` verschluckt Stabilisierungs-CSS-Fehler (Evidenzqualität); `execution.ts` 2.739 LOC mit ≥5 Verantwortlichkeiten.

---

## 6. Datenbank- und Index-Register

Live-Basis: 54 Tabellen, 283 Indizes, 117 Policies (alle Initplan), 23 MB, größte Tabelle 1.026 Zeilen. Alle App-Statements < 1,2 ms mean. **Deshalb sind alle Indexaussagen „bestätigt fehlend" strukturell, ihre Wirkung aber erst mit Volumen messbar.**

| Query / Flow | Tabellen | aktuelles Muster | Indexstatus | Problem | Empfehlung | Verifikation |
|---|---|---|---|---|---|---|
| Ownership-Read (`projects` id+user_id) | `projects` | PK + `user_id`; **7.221 Aufrufe**, 0,08 ms | ✔ | 2–3× pro Navigation | `cache()` (PERF-013) | `pg_stat_statements` Call-Count |
| Operation-Status-Polls | `operation_runs` | PK-Read; 4.362/4.348/3.373/2.994 Aufrufe | ✔ | Frequenz, nicht Kosten | Poll-Backoff (PERF-003) | dito |
| Account-Start-Window-Count | `operation_runs` `user_id, operation_type, created_at ≥` | `count exact head` | **bestätigt fehlend** (nur Partial-Indizes auf `user_id`) | Full-Scan der Nutzer-Historie | `(user_id, operation_type, created_at desc)` | EXPLAIN bei 100k |
| Projekt-Start-Window-Count | `operation_runs` `project_id, operation_type, created_at ≥` | `count exact head` | `identity_idx (project_id, operation_type, input_identity, status)` ohne `created_at` | Heap-Filter | `(project_id, operation_type, created_at desc)` | EXPLAIN |
| Spend-Watch | `ai_usage_events` `user_id, created_at ≥`, limit 500 | Select nach jedem Paid-Call | **bestätigt fehlend** `(user_id, created_at)` | Scan der Nutzer-Historie | `(user_id, created_at desc)` | EXPLAIN |
| Gateway-Token-Summe | `ai_usage_events` `job_id` | Select aller Zeilen, JS-Summe | ✔ `job_lookup_idx` | Transfer quadratisch, `max_rows`-Risiko | RPC-Aggregat | Route-Test, Statement-Count |
| Ledger-Summe | `billing_credit_ledger` | RPC `sum_ledger_deltas` (VB-025) | ✔ `(credit_account_id, created_at desc)` | O(Ledger) im DB, pro Billing-Render | ok bis 100k; später Checkpoint | — |
| Repair-Scan | `billing_credit_ledger` `materialized_at IS NULL` | in `repair_account_balance` | **Vorschlag**: Partial-Index fehlt | O(Ledger) | `(credit_account_id) WHERE materialized_at IS NULL` | EXPLAIN |
| Ledger-Liste | `billing_credit_ledger` | limit 100 | ✔ | `welcomeGranted` aus Fenster (PERF-012) | gezielter Read | Unit-Test |
| `listAllLots` | `billing_credit_grants` `credit_account_id` ohne Status | unbounded | nur Partial `WHERE status='active'` | Scan bei vielen Lots | Vollindex oder Status-Filter | EXPLAIN |
| Activity-Feed | `audit_events` `user_id, project_id`, order `(created_at desc, id desc)`, range | Offset ohne Obergrenze | ✔ Partial `(project_id, created_at desc, id desc)` | O(offset) tiefe Seiten | Keyset auf `(created_at, id)` | EXPLAIN bei 100k |
| Merge-Eligibility-Lookup | `audit_events` `metadata->>'prepared_change_id'` | JSONB-Filter | **unindexiert** (Vorschlag) | Scan der Projekt-Historie | Expression-Index oder Spalte | EXPLAIN |
| Agent-Events-Read | `agent_execution_events` `(run, audience, sequence)`, cap 2000 | Cursor | ✔ exakt | — | — | — |
| Produkt-Scan-Append | `product_scan_events` | 4 seq. Roundtrips pro Event | ✔ Constraints vorhanden | Roundtrips | Ein Upsert (PERF-008) | Store-Test |
| Health-Evidence | 5 Snapshot-/Audit-Tabellen, JSONB `result` | 6 par. Reads, 3 nur für Hash | ✔ `(project_id, created_at)` | Transfer | ID-only-Varianten | Bytes im Test |
| `latest-per-change` Batch | `validation_runs` etc. `.in(ids)` + order | 1 Read ≤200 + Fallback | ✔ | BitmapOr + Sort unvermeidbar über PostgREST | ok | EXPLAIN (Vorschlag) |
| RLS `operation_runs` | `CASE project_id IS NULL … EXISTS(projects)` | pro Statement (Initplan) | `user_id`-Zweig nur Partial | teuerste Policy auf meistgelesener Tabelle | Vollindex `user_id` (PERF-010) | EXPLAIN als `authenticated` |
| RLS EXISTS-through-`projects` (98 Policies) | Event-/Billing-Tabellen | Semi-Join pro Statement | ✔ PK/`user_id` | Join pro Read (klein) | ok | EXPLAIN bei Volumen |
| FK-Generator-Lücke | 6 FKs nur Partial-Index (Liste PERF-010) | — | **bestätigt** | Lösch-Kaskade scannt | Generator um `indpred is null` | `pg_indexes` |
| Redundanter Index | `sandbox_usage_events_preview_idx` | — | **bestätigt redundant** | Write-Amplification | drop | — |
| CHECK-Revalidation | `operation_runs_operation_type_check` 13× | Drop/Re-Add | — | ACCESS EXCLUSIVE bei Deploy | `NOT VALID` + `VALIDATE` | `pnpm db:test` |
| Retention | alle Append-only | keine | — | `max_rows` stumm | ADR (PERF-018) | `pg_stat_user_tables` |

Locking/Transaktionen: keine Advisory-Locks, kein `SKIP LOCKED`, 9 kurze `FOR UPDATE` in Billing-/Founder-RPCs, keine App-Transaktionen (PostgREST); CAS-Retry-Schleifen in `lot-store.ts`/`credits/store.ts` mit 10 Versuchen und Jitter — korrekt für PostgREST. Connections: stateless HTTPS, 13/60 Backends. Realtime: keine.

---

## 7. Caching-Matrix

| Daten / Operation | aktuelles Verhalten | Änderungsfrequenz | Nutzerbezug | Cache-Kandidat | Key / Scope / TTL / Invalidierung | Sicherheitsrisiko |
|---|---|---|---|---|---|---|
| Session-Claims | 3–4× `getClaims` pro Request, lokal (ES256, JWKS-Cache 10 min prozessweit) | pro Token-Refresh | ja | **React `cache()`**, nur Request-Scope | Key: Request; TTL: Render; Invalidierung: nächster Request | keins, solange nie cross-request |
| Projekt-Kontext (`getProjectWithRepository`) | 2–3 Reads pro Navigation | selten | ja (Ownership) | React `cache()` | Key: `(client, projectId)`; Render | keins (RLS-Client bleibt) |
| GitHub-Identity, Founder-Intent, Opportunities-Set | ungecacht, mehrfach pro Render | selten / pro Operation | ja | React `cache()` | Render | keins |
| Snapshot-/Audit-/Profil-Dokumente | React `cache()` auf 6 Gettern | pro Operation | ja | bleibt; zusätzlich ID-only-Varianten | Render | keins |
| Repo-/Live-/Deep-Scan-Intelligence, Audit, Opportunities, Action Plan (Ergebnisse) | pro Request aus DB | nur durch neue Operation | ja (Tenant) | **kein Next Data Cache** (Tenant-Daten, RLS-Cookie-Client); optional `revalidateTag`-Design erst mit Service-Role-Reads + Tenant-Key | — | hoch bei falschem Key → nicht empfohlen |
| Projekt-Metadaten (Name, Repo) | per Layout | selten | ja | wie Projekt-Kontext | Render | keins |
| Activity-Feed | paginiert, frisch | pro Aktion | ja | kein Cache | — | — |
| Statusanzeigen laufender Prozesse | Polling 1,8–15 s | sekündlich | ja | **kein Cache**, Backoff | — | Run-Korrektheit |
| Billing-Balance / Ledger | frisch, mit Read-Repair | pro Operation | ja | **kein Cache** | — | Billing-Korrektheit |
| Marketing `/`, `/privacy`, `/terms`, sitemap, robots | statisch (CDN) | Deploy | nein | bereits statisch; Proxy ausnehmen (PERF-016) | Build | keins |
| Fonts, Icons, `_next/static` | immutable, CDN | Deploy | nein | ok | — | — |
| Route-Prefetch (Sidebar-Links) | Next-Default (Viewport) für dynamische Routen | — | ja | `prefetch={false}` auf 7-Item-Rail erwägen (messen) | — | keins |
| Client-State (SWR o. ä.) | keiner | — | — | nicht einführen | — | — |

Regel für alle Vorschläge: nur Request-scoped Memoisierung; nichts Nutzerspezifisches, Billing- oder Run-bezogenes überlebt einen Request oder wechselt den Nutzer.

---

## 8. Quick Wins

| # | Änderung | Umfang | Nutzen | Risiko |
|---|---|---|---|---|
| Q1 | `Promise.all` für Account/Subscription (`overview.ts:249-250`), Settings-Reads, Start-Window-Counts, Operation/Events im Scan-Poll (`product-scan-status-action.ts`) | je 2–5 Zeilen | −1 Roundtrip pro Stelle | minimal |
| Q2 | Ungenutzten `prepared`-Count aus dem Projekt-Layout entfernen | 3 Zeilen | −1 Query pro Projekt-Navigation | minimal |
| Q3 | `AbortSignal.timeout` am Gateway-Upstream-`fetch` | 5 Zeilen | begrenzte Function-Zeit | niedrig |
| Q4 | In-Flight-Guard + `try/catch` im Poll-Hook | ~15 Zeilen | keine Request-Stapel | niedrig |
| Q5 | `evidence` an `getAuditAccessStatus` durchreichen | Signatur + 2 Call-Sites | −6–8 Queries auf Health | niedrig |
| Q6 | `cache()` um `getSession`, `getProjectWithRepository`, `getFounderIntent`, `getLatestOpportunities` | 4 Wrapper | −2–4 Roundtrips pro Render | niedrig |
| Q7 | Vier fehlende `loading.tsx`, drei routenspezifische, zwei Textabgleiche | Dateien kopieren | sofortiges Feedback | minimal |
| Q8 | `welcomeGranted` gezielt lesen | 5 Zeilen | Korrektheit | minimal |
| Q9 | Proxy-Matcher um Marketing/Sitemap/Robots/Webhook/Gateway ergänzen | 1 Regex | −1 Auth-Client pro Request | niedrig |
| Q10 | Drei Redirects für Alt-Routen in `next.config.ts` | 10 Zeilen | Bookmarks funktionieren | minimal |
| Q11 | Migration: 3 Indizes `CONCURRENTLY` | 1 Datei | Skalierungsschutz | niedrig |
| Q12 | `execution.ts:507` durch `redactCredentials` | 2 Zeilen | Log-Hygiene | minimal |

---

## 9. Priorisierter Umsetzungsplan

### Phase 0 – Messbarkeit und Baseline
- **Ziel:** Zahlen statt Vermutungen für PERF-001 und die Route-Latenzen.
- **Dateien:** `src/lib/supabase/server.ts`/`service.ts` (Timing-Span im `fetch`-Wrapper oder Sentry-Span), Speed-Insights-Dashboard, `pg_stat_statements`-Snapshot als Datei unter `docs/audits/…/baseline/`.
- **Änderungen:** ein Sentry-Span pro Supabase-Call (0,1 Sampling reicht), einmaliger `@next/bundle-analyzer`-Lauf (nicht committen), k6- oder Playwright-Timing für Health/Plan/Dashboard gegen Preview.
- **Abhängigkeiten:** Sentry-DSN gesetzt. **Risiken:** keine. **Tests:** bestehende.
- **Akzeptanz:** p50/p95 DB-RTT aus Vercel-Region dokumentiert; TTFB/LCP p75 für 6 Routen; Bundle-Größe pro Route-Chunk. **Rollback:** Span entfernen.

### Phase 1 – P0 Launch-Blocker
- **Ziel:** Korrektheits- und Grenzfehler mit Kostenwirkung schließen.
- **Bereiche:** PERF-011 (Repair-Grant), PERF-012 (`welcomeGranted`), PERF-009 (Gateway-Timeout), PERF-002 (Summen-RPC), PERF-010 (3 Indizes), PERF-003 (Poll-Guard), Region-Entscheidung aus Phase 0 als ADR.
- **Abhängigkeiten:** Migrationen (`pnpm db:status` vor `db:push`, Regel 30). **Risiken:** Billing-Autorität (PERF-011) → gegen Branch-DB proben.
- **Tests:** `route.test.ts`, Billing-Tests, `pnpm billing:concurrency`, Hook-Logik als pure Funktionen.
- **Akzeptanz:** Repair-Probe liefert `credit_drift.repaired`; Gateway-Statement-Count 3 → 2 pro Request; Poll erzeugt unter simulierten 5-s-Antworten nie >1 laufenden Request. **Rollback:** Migrationen sind additiv (Index-Drop möglich), Code per Revert.

### Phase 2 – Kritische Datenbank- und Request-Pfade
- **Ziel:** Roundtrip-Ketten halbieren.
- **Bereiche:** PERF-004, PERF-005, PERF-006, PERF-007, PERF-008, PERF-013, PERF-017, PERF-020; Vercel-Region umstellen (wenn Phase 0 es belegt).
- **Abhängigkeiten:** Signaturänderungen `getAuditAccessStatus`/`getActionPlanReadiness`; Contract-Tests anpassen.
- **Risiken:** Onboarding-State-Maschine, Billing-Start-Kette → schrittweise, ein Flow pro PR.
- **Tests:** Query-Zähl-Tests nach Muster VB-023, E2E Onboarding/Produkt-Scan, Concurrency-Gate.
- **Akzeptanz:** Health ≤15 Queries, Plan ≤15 bei 5 Moves, Onboarding ≤3 Wellen, Scan-Append ≤4 Roundtrips, Operation-Start ≤15 Roundtrips; TTFB p75 App-Routen ≤600 ms. **Rollback:** pro PR.

### Phase 3 – Frontend, Bundle und Lade-UX
- **Ziel:** wahrgenommene Geschwindigkeit.
- **Bereiche:** Suspense auf Health/Plan (Muster `agent/page.tsx`), PERF-015, PERF-014 (`LazyMotion`, `next/dynamic`), PERF-016, PERF-021, PERF-023, Poll-Tiers am Hook, `prefetch`-Messung.
- **Risiken:** Motion-Umbau berührt 20 Dateien → in zwei PRs (Agent, Rest).
- **Tests:** Browser-E2E (`workspace-routes.test.ts`, `product-scan.spec.ts`), Analyzer vor/nach.
- **Akzeptanz:** erstes HTML auf Health/Plan <300 ms nach TTFB; Workspace-Chunk −30 kB gz; keine Hydration-Warnung; CLS p75 ≤0,1. **Rollback:** pro PR.

### Phase 4 – Dead Code und sichere Bereinigung
- **Ziel:** DEAD-001…008 entfernen, DEAD-009…014 nach Verifikation; PERF-024, PERF-025, PERF-022.
- **Risiken:** minimal; `documentation-currency.test.ts` beachten (README-Anpassungen, Regel-38-Text, `RETIRED_CLAIMS`).
- **Tests:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- **Akzeptanz:** grep-leer für jeden entfernten Export; Doku-Test grün. **Rollback:** Revert.

### Phase 5 – Strukturelle Refactorings
- **Ziel:** Wartbarkeit mit Performance-Bezug.
- **Bereiche:** generierte Supabase-`Database`-Typen (ersetzt ~80 `as unknown as`), Split von `agent-execution/execution.ts` (2.739 LOC), `errorDetail()`-Helfer, `sleep`-Konsolidierung, `AGENT_POLL_INTERVAL_MS`-Gleichheits-Test, `noUnusedLocals/noUnusedParameters`, `vitest` include `.test.{ts,tsx}`.
- **Risiken:** Typ-Generierung kann bestehende Row-Typen verschieben → schrittweise pro Store.
- **Akzeptanz:** 0 `as unknown as Row` in Stores; größte Datei <1.200 LOC; typecheck grün. **Rollback:** pro Modul.

### Phase 6 – Skalierung und dauerhafte Performance-Regressionstests
- **Ziel:** Kipppunkte vor dem Eintreten sehen.
- **Bereiche:** Retention-ADR (PERF-018), `NOT VALID`-Playbook + Policy-Form-Test (PERF-019), Keyset-Pagination Activity, Expression-Index `audit_events.metadata->>prepared_change_id`, Partial-Index für Repair-Scan, Bundle-Size-Gate + Lighthouse CI in `ci.yml`, Lasttest gegen Branch-DB mit 100k/1M Zeilen (EXPLAIN-Skript aus dem Vorgänger-Audit), monatlicher `pg_stat_user_tables`/`unused_index`-Review.
- **Akzeptanz:** CI schlägt fehl bei Bundle-Wachstum >10 %; EXPLAIN-Pläne der 6 Register-Queries sind Index-Scans bei 1M Zeilen; Retention-Entscheidung als ADR. **Rollback:** Gates deaktivierbar.

---

## 10. Nicht empfohlene Optimierungen

| Idee | Warum nicht |
|---|---|
| Next Data Cache / `"use cache"` / ISR / `revalidate` für `/app/**` | Tenant-, Billing- und Run-Daten hinter RLS-Cookie-Client; falscher Key = Datenleck zwischen Nutzern; Gewinn gegenüber Request-Memoisierung gering |
| Cross-Request-Cache für Session oder Projekt-Kontext | Autorisierung muss pro Request neu entschieden werden (Regel 53/67); `getClaims` ist mit ES256 bereits lokal |
| Client-seitiger Cache/SWR für Balance, Runs, Approvals | Billing-/Run-Korrektheit; UX-CONTRACT verlangt server-entschiedene Zustände |
| Supabase Realtime statt Polling | neue Hintergrund-/Push-Technologie ohne ADR (Regel 24); Polling mit Backoff löst das Problem billiger |
| Ownership-Gate nur im Layout oder nur im Proxy | Layouts gaten Pages nicht; Proxy ist explizit nicht die Sicherheitsgrenze (`lib/supabase/proxy.ts`) |
| `CONTENTION_ATTEMPTS` senken | Sprint 0057 E2b hat 3 als zu wenig gemessen; Verlust wäre Korrektheit unter Last |
| Read-triggered Billing-Repair abschalten „wegen Kosten" | ADR 0042; das Problem ist der Grant (PERF-011), nicht der Read |
| 83/121 „ungenutzte" Indizes droppen | 23 MB und Wochen an Statistik beweisen nichts; viele sichern Lösch-Kaskaden und RLS-Prädikate |
| `pg_cron`/Scheduler für Retention oder Sweeps | Regel 24: braucht ADR; Vercel Workflows sind die entschiedene Technologie |
| `getUser()` durch `getSession()` ersetzen | `getSession()` verifiziert nicht; Sicherheitsverlust für Nanosekunden |
| Proxy komplett entfernen | Token-Refresh für Server Components hängt daran |
| Große Refactorings der Store-Symmetrie (DEAD-010 pauschal) | Nutzen klein, Risiko einzelner Lesepfade; nur einzeln mit Verifikation |
| Partial Prerendering für App-Routen | erst sinnvoll, wenn Layout-Rahmen wirklich statisch wäre; Sidebar trägt Nutzerdaten (Balance, Identity) |
| Edge-Runtime für Pages | Supabase/Octokit/Stripe-Pfade sind Node-gebunden; Region-Fix (PERF-001) bringt mehr |

---

## 11. Offene Verifikationen

| Punkt | Benötigte Daten | Warum erst dann |
|---|---|---|
| PERF-001 Latenzwirkung iad1↔eu-north-1 | Function-Durations (Vercel Observability/Pro) oder Sentry-Span um Supabase-Calls | Hobby-Plan: 1 h Log-Retention, keine p95 |
| Web-Vitals-Baseline (LCP/INP/CLS p75 je Route) | Speed Insights RUM (gemountet, nicht per MCP lesbar) | Budgets ohne Baseline sind Setzungen |
| Bundle-Größen, `motion`-Anteil, größte Chunks | `@next/bundle-analyzer`-Lauf (Turbopack-Build-Log enthält keine Größen) | kB-Aussagen wären erfunden |
| Wirkung fehlender Indizes (PERF-010), RLS-Semi-Join-Flattening, `latest-per-change`-Plan | `EXPLAIN (ANALYZE, BUFFERS)` auf seeded Branch-DB (100k/1M Zeilen) als `authenticated` | Produktions-DB hat 1.026 Zeilen maximal |
| Prod-`max_rows` (PERF-018) | Supabase-Dashboard → API-Settings | `config.toml` gilt lokal |
| Octokit-Throttling mit Custom-`fetch` aktiv? | Log/Test gegen GitHub-Rate-Limit | statisch nicht entscheidbar |
| `ai_usage_events` 42501-Fehler vom 27.08. behoben? | Runtime-Errors nach der nächsten Agent-Session | letzte Sichtung vor den Grant-Migrationen |
| `browsers.json`-Tracing auf Vercel (`next.config.ts:21-26` vs. Patch) | ein Deep-Scan auf Production | Kommentar und Patch widersprechen sich |
| Poll-Überlappung real (PERF-003) | Browser-Profiling mit gedrosseltem Netz | Verhalten aus Code sicher, Häufigkeit nicht |
| Retention-Kipppunkte | reale Tabellenvolumen nach 3–6 Monaten (`pg_stat_user_tables`) | heute 23 MB |
| Cold-Start-Anteil der 7 Node-Lambdas | Vercel Observability | keine Daten |
| Lasttest (k6) Operation-Start, Poll-Fanout, Gateway bei 5 parallelen Runs | Staging/Preview mit Test-Account | Serverless-Limits, Supabase-Connections (60) |

---

## 12. Repository-Qualitätsprüfungen (Track I)

Ausgeführt in dieser Session auf `f1dc651` nach `pnpm install --frozen-lockfile` (Lockfile konsistent):

| Prüfung | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | ok, 23 s; Lockfile konsistent mit `package.json` |
| `pnpm lint` | **0 Fehler, 22 Warnungen**, alle `@typescript-eslint/no-unused-vars`, in 11 Dateien: `src/lib/supabase/server.ts:52` (`_headers`), `src/modules/business-audit/validate.ts:166` (`normalizeScore` — toter Helfer), `src/modules/execution-context/completion.ts:668` (`_version`, `_mode`), `src/app/app/(account)/billing/actions.ts`, `src/app/app/onboarding/[projectId]/actions.ts`, `src/app/app/projects/[projectId]/agent-dogfood/[stepKey]/actions.ts` sowie 5 Testdateien. Kein `no-unused-vars` als Error konfiguriert → Warnungen akkumulieren (Phase 5) |
| `pnpm typecheck` | ok; Workflow-Compiler: 158 Steps, 15 Workflows; Route-Typen generiert |
| `pnpm test` | **414 Dateien, 7.154 Tests, alle grün, 38 s** (Node, kein DOM) |
| `pnpm build` | ok (Turbopack); Route-Modi wie in Abschnitt 2 (6 statisch, Rest dynamisch); 21× `[auth.session] Supabase is not configured` beim Prerender (PERF-024); keine weiteren Warnungen; keine Bundle-Größen im Output |
| E2E (`pnpm test:e2e`), Concurrency-Gate, Migrationstests | nicht in dieser Session ausgeführt (Browser/Docker/Postgres nötig); laufen in CI (`ci.yml`, `concurrency.yml`) |

Vercel-Build-Log der Produktions-Deployment (Turbopack): Route-Tabelle wie in Abschnitt 2; Warnungen: `engines >=20.9.0` (Auto-Upgrade-Hinweis), 24× `[auth.session] Supabase is not configured` beim Prerender (PERF-024); Build-Cache 900 MB; TypeScript 22,6 s; Static-Generation 28 Seiten in 0,8 s. Keine Bundle-Größen im Log; kein Analyzer, kein Size-Budget, kein Lighthouse CI konfiguriert.

Dependencies: alle 21 Prod- und 11 Dev-Dependencies haben Importer; keine Duplikat-Bibliotheken; Overrides `undici ^7.29.0`, `nanoid ^5.1.16` (VB-007) begründet; `allowBuilds` restriktiv; ein Patch (`playwright-core`) begründet; stale `minimumReleaseAgeExclude` (DEAD-013). Keine Versionsänderung empfohlen.

---

## Performance-Budgets (Vorschlag)

| Metrik | Marketing (`/`, `/privacy`, `/terms`) | App-Seiten (Settings, Activity, Product) | Daten-Dashboards (Home/Health, Plan, Agent, Billing) | Langläufer (Scan, Audit, Agent, Validation) |
|---|---|---|---|---|
| LCP p75 | ≤2,0 s | ≤2,5 s | ≤2,5 s (Header-Streaming), Body ≤3,5 s | erstes Fortschrittssignal ≤3 s |
| INP p75 | ≤150 ms | ≤200 ms | ≤200 ms | ≤200 ms |
| CLS p75 | ≤0,05 | ≤0,1 | ≤0,1 | ≤0,1 |
| Initiales JS (gz) | ≤120 kB | ≤200 kB | ≤250 kB | — |
| Route-Navigation (wahrgenommen) | — | ≤500 ms bis Skeleton | ≤500 ms bis Skeleton | — |
| Server Response Time (TTFB) p75 | CDN <100 ms | ≤400 ms | ≤600 ms | — |
| API/Server-Action p95 | — | ≤500 ms | ≤800 ms (Start-Actions) | — |
| Typische DB-Query p95 | — | ≤20 ms Ausführung, ≤30 ms RTT nach Region-Fix | dito | — |
| Dashboard First Meaningful Content | — | — | ≤1,0 s nach TTFB | — |
| Polling | — | ≥2 s, Backoff bis 4×, 10-min-Stall | ≥2,5 s | ≥2,5 s, 20 s im Workflow |
| Listen/Payload | — | ≤200 Zeilen/Seite, RSC-Payload ≤300 kB | ≤300 kB | Events ≤24 (Scan), ≤2000 (Agent) |
| Dauer | — | — | — | Scan ≤90 s, Audit ≤4 min, Validation ≤5 min/Step, Agent ≤25 min, mit sichtbarem Zwischenstand alle ≤20 s |

Die Budgets sind Ziele für Phase 0–3, keine Launch-Gates, bis eine RUM-Baseline vorliegt.
