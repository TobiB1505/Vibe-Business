# Region-Verifikation — PERF-001, 2026-09-01

**Gegenstand:** Prüfung, ob die Umstellung der Vercel-Function-Region von `iad1` (US-Ost) auf Stockholm real wirksam ist, ob sie messbar Latenz spart und ob sie Regressionen verursacht hat.
**Bezug:** [PERF-001 im Performance-Audit](README.md#perf-001--vercel-functions-in-iad1-datenbank-in-eu-north-1), dort mangels Laufzeitdaten als *Needs Runtime Verification* geführt.
**Verifiziert am:** 2026-09-01, 19:55–20:15 UTC · Deployment `dpl_4Ja5i67…` (Commit `f1dc651`).
**Methode:** ausschließlich lesend — Vercel-Projekt-, Deployment- und Domain-Metadaten, Vercel Runtime-Logs und Runtime-Errors, Vercel Web Analytics, Supabase-Projektmetadaten und Supabase-Edge-Log-Stream, Repository-Inspektion. Keine kostenpflichtige Operation, keine Billing-/Credit-/Ledger-/Repair-Aktion, keine Webhook-Zustellung, kein Schreibzugriff, keine Migration, keine Env-Änderung, kein Deployment, kein Lasttest.
**Record status:** Dieses Dokument ist ein Record unter `docs/audits/` (CLAUDE.md Regel 83). Es beschreibt einen Messstand und wird nicht nachträglich an die Gegenwart angepasst. Der [Audit-Record](README.md) selbst wurde nicht verändert.
**Datenschutz:** Aus den Logs sind keine Projekt-IDs, IP-Adressen, Cookies, Tokens, Header-Werte oder Nutzerkennungen übernommen. Herkunftsangaben bleiben auf der Ebene PoP / Land / ASN.

---

## 1. Ergebnis

**PASS — Confirmed Improvement.**

Das Produktions-Deployment läuft nachweislich in `arn1` (Stockholm) und die Produktionsdomain wird von genau diesem Deployment bedient. Ein belastbarer Vorher-/Nachher-Vergleich war möglich, weil Supabase' eigene Edge-Logs die Aufrufe der Produktions-App aus beiden Regionen enthalten: die vom Cloudflare-PoP gemessene Zeit pro PostgREST-Request sank im Median von **134 ms auf 21 ms**, ein abhängiger Sequenzschritt von **136 ms auf 30 ms**, und die Datenbankphase eines datenintensiven Renders mit 59 Abfragen von **5.041 ms auf 665 ms**. Über 14 einzeln kontrollierte Tabellen liegt die Verbesserung einheitlich zwischen 81 % und 93 %, was die Audit-Schätzung von 80–120 ms je Roundtrip mit gemessenen ≈110 ms bestätigt. Keine Regression: alle beobachteten Requests HTTP 200, keine Runtime-Errors, keine 4xx/5xx auf dem neuen Deployment — offen bleibt allein die clientseitige Web-Vitals-Messung, die in dieser Session technisch nicht erreichbar war.

---

## 2. Deployment-Verifikation

| Merkmal | Vorher | Nachher | Status |
|---|---|---|---|
| Deployment-ID | `dpl_HQoG5khr8jEY6Be4RzBSgng3u91H` | `dpl_4Ja5i67nmDKDLNRedYL7GtqJhnNQ` | PASS |
| Commit-SHA | `f1dc651fb0b290b649bab0e434189843e51475f0` | `f1dc651fb0b290b649bab0e434189843e51475f0` | PASS — identisch, `source: redeploy`, `originalDeploymentId` = Vorher-Deployment |
| Production-Alias | `vibebusiness.de`, `www.vibebusiness.de` (+3) | dieselben Aliase; `project.latestDeployment` = neues Deployment, `aliasError: null` | PASS |
| Vercel-Region | `iad1` | **`arn1`** | PASS |
| Supabase-Region | `eu-north-1` | `eu-north-1` | PASS — unverändert, `ACTIVE_HEALTHY` |
| Deployment-Zeitpunkt | erstellt 18:43:39 UTC, ready 18:45:39 | erstellt 19:47:30 UTC, **ready 19:50:11 UTC** | PASS — nach der Regionsänderung erzeugt |

**Ist die Konfiguration tatsächlich übernommen worden?** Ja, und zwar auf drei unabhängigen Wegen belegt:

1. **Deployment-Metadaten**: das Feld `regions` des laufenden Production-Deployments lautet `["arn1"]`, das des Vorgängers `["iad1"]`.
2. **Verhalten des Alias**: in den Vercel-Runtime-Logs wird jeder Production-Request ab **19:50:28 UTC** von `dpl_4Ja5i6…` bedient; der letzte Request an das alte Deployment war **19:49:43 UTC**. Der Umschaltpunkt ist im Traffic sichtbar.
3. **Beobachtung von der Gegenseite**: die PostgREST-Aufrufe der App treffen seit dem Umschalten am Cloudflare-PoP **ARN** (Stockholm) ein, mit Herkunft Land `SE`, ASN „Amazon Data Services Sweden" — vorher am PoP **IAD** (Washington), Land `US`.

**Laufen noch Funktionen in `iad1`?** Nein. Keine Route im Repository setzt `export const preferredRegion` (`grep` über `src` ohne Treffer — der einzige Vorkommnis-String steht in der Route-Segment-Namensliste des Render-Impact-Analyzers). Damit erben alle sieben Node-Lambdas des Deployments — Server Components, Route Handler unter `/api/**`, die Auth-Route-Handler und die Workflow-Ebene unter `/.well-known/workflow/*` — die Projektregion. Es gibt keinen Pfad mit abweichender Region.

**Repository-Stand:** Die Umstellung liegt nicht im Code (kein `vercel.json`, kein `preferredRegion`), sondern in der Vercel-Projektkonfiguration. `origin/main` steht unverändert auf `f1dc651`.

---

## 3. Messergebnisse

Alle Werte stammen aus den Supabase-Edge-Logs. `response.origin_time` ist die vom Cloudflare-PoP gemessene Zeit PoP → Origin → PoP und enthält damit genau die Netzstrecke, um die es geht; `request.cf.colo` benennt den Eintritts-PoP und identifiziert die Herkunftsregion des Aufrufers.

| Route/Fläche | Deployment | Region | Samples | Cold/Warm | DB-RTT p50/p95 (`origin_time`) | Function p50/p95 | TTFB p50/p95 | Total p50/p95 | Fehler |
|---|---|---|---|---|---|---|---|---|---|
| Alle App-Routen, PostgREST gesamt | `dpl_…` (iad1-Ära, ältere Commits) | iad1 → PoP IAD | 1.098 Requests | warm (Nutzersitzung 10:00:08–10:39:53 UTC) | **134 ms / 374 ms** (max 1.022 ms) | nicht messbar¹ | nicht messbar² | nicht messbar² | 0 — ausschließlich HTTP 200 |
| Alle App-Routen, PostgREST gesamt | `dpl_4Ja5i67…` | **arn1 → PoP ARN** | 281 Requests | warm (Nutzersitzung 20:04:34–20:05:53 UTC) | **21 ms / 68 ms** (max 369 ms) | nicht messbar¹ | nicht messbar² | nicht messbar² | 0 — ausschließlich HTTP 200 |
| Abhängiger Sequenzschritt (Wartekette) | iad1-Ära | iad1 | 147 Schritte | warm | **136 ms / 374 ms** | — | — | — | — |
| Abhängiger Sequenzschritt (Wartekette) | `dpl_4Ja5i67…` | arn1 | 141 Schritte | warm | **30 ms / 73 ms** | — | — | — | — |
| Datenintensiver Render, 59 Abfragen | iad1-Ära | iad1 | 1 Render | warm | DB-Phase **5.041 ms** | — | — | — | 0 |
| Datenintensiver Render, 59 Abfragen | `dpl_4Ja5i67…` | arn1 | 1 Render | warm | DB-Phase **665 ms** | — | — | — | 0 |
| Öffentliche Seiten (`/`, `/login`, `/signup`, `/privacy`, `/terms`) | `dpl_4Ja5i67…` | arn1 | 11 Requests im ersten Fenster, danach laufend | Mischung Cache HIT/PRERENDER/MISS | berührt die Datenbank nicht | nicht messbar¹ | nicht messbar² | nicht messbar² | 0 — keine 4xx, keine 5xx |
| Cold Start | `dpl_4Ja5i67…` | arn1 | **nicht isoliert erfasst** | — | nicht messbar³ | nicht messbar³ | nicht messbar³ | nicht messbar³ | — |

¹ **nicht messbar — Function-Duration:** Der Vercel-Runtime-Log-Zugang dieser Session liefert Zeitstempel, Route, Status, Deployment und Cache-Zustand, aber kein Dauerfeld; die Log-Retention des Plans liegt bei etwa einer Stunde. Die Dauer je Aufruf ist in der Vercel-Logs-Oberfläche sichtbar, war hier aber nicht abrufbar.
² **nicht messbar — TTFB/Total am Client:** Der Egress-Proxy dieser Session verweigert den CONNECT zu `vibebusiness.de` und zu beiden Deployment-URLs (Organisations-Policy, Status `connect_rejected`/403; laut Proxy-Dokumentation ausdrücklich nicht zu umgehen, sondern zu melden). Zusätzlich liegt das Vorher-Deployment hinter Vercel-SSO (`ssoProtection: all_except_custom_domains`), wäre also auch bei offener Egress-Policy nicht ohne Anmeldung messbar. Vercel Speed Insights ist im Produkt eingebunden, über die hier verfügbare Schnittstelle aber nicht auslesbar.
³ **nicht messbar — Cold Start:** Ein erster Aufruf nach dem Deployment wurde nicht kontrolliert ausgelöst; die vorhandenen Aufrufe stammen aus einem Minuten-Ping und einer Nutzersitzung, deren Cold-/Warm-Zustand nicht unterscheidbar ist. Die Trennung hätte gezielte Testaufrufe von außen verlangt, die die Egress-Policy verhindert.

### Kontrolle gegen den Query-Mix

Damit die Verbesserung nicht aus einer anderen Zusammensetzung der Abfragen stammt, wurde `origin_time` je Tabelle getrennt ausgewertet — nur Pfade mit mindestens 10 Vorher- und 4 Nachher-Requests:

| PostgREST-Pfad | n vorher | p50 vorher | n nachher | p50 nachher | Δ |
|---|---:|---:|---:|---:|---:|
| `/rest/v1/business_readiness_audits` | 45 | 343,0 ms | 14 | 23,0 ms | −93 % |
| `/rest/v1/github_installations` | 39 | 123,0 ms | 15 | 16,0 ms | −87 % |
| `/rest/v1/business_opportunities` | 89 | 130,0 ms | 22 | 18,0 ms | −86 % |
| `/rest/v1/prepared_changes` | 78 | 137,5 ms | 11 | 19,0 ms | −86 % |
| `/rest/v1/project_founder_intent` | 62 | 131,5 ms | 15 | 18,0 ms | −86 % |
| `/rest/v1/repository_connections` | 46 | 129,5 ms | 18 | 18,0 ms | −86 % |
| `/rest/v1/projects` | 62 | 142,5 ms | 27 | 21,0 ms | −85 % |
| `/rest/v1/product_profile_corrections` | 23 | 147,0 ms | 6 | 22,0 ms | −85 % |
| `/rest/v1/product_profiles` | 23 | 144,0 ms | 6 | 22,5 ms | −84 % |
| `/rest/v1/execution_specs` | 39 | 126,0 ms | 8 | 20,0 ms | −84 % |
| `/rest/v1/operation_runs` | 108 | 134,5 ms | 28 | 23,0 ms | −83 % |
| `/rest/v1/opportunity_sets` | 89 | 130,0 ms | 23 | 25,0 ms | −81 % |
| `/rest/v1/validation_runs` | 55 | 129,0 ms | 6 | 24,0 ms | −81 % |
| `/rest/v1/project_founder_resolutions` | 21 | 127,0 ms | 4 | 23,5 ms | −81 % |

Die Ersparnis ist über alle Tabellen gleichförmig ≈105–125 ms. Das ist die Signatur einer Wegstrecke, nicht die einer Abfrageänderung.

### Reproduktion

Die Messung ist ohne Codeänderung wiederholbar. Gegen den Supabase-Log-Stream (ClickHouse, Tabelle `logs`):

```sql
-- Herkunft der App-Aufrufe je Ära
select if(timestamp < toDateTime('2026-09-01 19:50:11'), 'vorher', 'nachher') as aera,
       log_attributes['request.cf.colo'] as colo,
       log_attributes['request.headers.x_client_info'] as client,
       count(*) as n
from logs
where source = 'edge_logs'
  and startsWith(log_attributes['request.path'], '/rest/v1/')
group by aera, colo, client order by n desc;

-- Latenz je Ära (und, mit zusätzlichem group by request.path, je Tabelle)
select count(*) as n,
       quantile(0.5)(toFloat64OrNull(log_attributes['response.origin_time']))  as p50,
       quantile(0.95)(toFloat64OrNull(log_attributes['response.origin_time'])) as p95
from logs
where source = 'edge_logs'
  and startsWith(log_attributes['request.path'], '/rest/v1/')
  and log_attributes['request.cf.colo'] = 'ARN'          -- bzw. 'IAD'
  and log_attributes['request.headers.x_client_info'] like 'supabase-ssr%';
```

Der Sequenzschritt wird aus der nach Zeit sortierten Requestfolge gebildet: Abstände unter 4 ms gelten als parallele Aufrufe derselben Welle, Abstände von 4 bis 400 ms als abhängiger Schritt (die Kette, auf die der Render tatsächlich wartet), größere Abstände als Render- oder Denkpause.

---

## 4. Vorher-/Nachher-Auswertung

| Metrik | Vorher | Nachher | Absolut | Prozentual |
|---|---:|---:|---:|---:|
| `origin_time` p50 je Request | 134 ms | 21 ms | −113 ms | −84 % |
| `origin_time` p95 je Request | 374 ms | 68 ms | −306 ms | −82 % |
| `origin_time` Maximum | 1.022 ms | 369 ms | −653 ms | −64 % |
| Abhängiger Sequenzschritt p50 | 136 ms | 30 ms | −106 ms | −78 % |
| Abhängiger Sequenzschritt p95 | 374 ms | 73 ms | −301 ms | −80 % |
| DB-Phase eines Renders mit 59 Abfragen | 5.041 ms | 665 ms | −4.376 ms | −87 % |
| Zeit je Abfrage innerhalb eines Renders | 26,5–86,1 ms | 11,3–26,5 ms | ≈ −40 ms | ≈ −70 % |

**Messmethode.** Beide Seiten stammen aus derselben Quelle (Supabase-Edge-Logs), demselben Client (`supabase-ssr/0.12.5 createServerClient`), demselben Supabase-Projekt und derselben Auswertung. Unterschieden wurden die Perioden allein über den Eintritts-PoP (`IAD` gegen `ARN`) und den Umschaltzeitpunkt 19:50:11 UTC. Für die Render- und Schrittanalyse wurde auf beiden Seiten dieselbe Schwellenwertlogik verwendet.

**Stichprobengröße.** Vorher 1.098 PostgREST-Requests über 40 Minuten, davon 300 zusammenhängende für die Schritt- und Renderanalyse; nachher 281 Requests über 79 Sekunden. Je Tabelle siehe Kontrolltabelle oben. Beide Seiten sind je eine reale Nutzersitzung, kein synthetischer Lauf.

**Störfaktoren, offen benannt.**
- *Unterschiedlicher Code.* Das Vorher-Fenster lief auf älteren Commits (`040d6295`, ab 10:32 UTC `eab5c2c1`), das Nachher-Fenster auf `f1dc651`. Für absolute Seitenzeiten ist das ein echter Störfaktor. Für die Transportlatenz ist es entkräftet: die Ersparnis ist über 14 einzeln kontrollierte Tabellen gleichförmig, und keine Codeänderung senkt die vom PoP gemessene Zeit zum Origin.
- *Was `origin_time` nicht enthält.* Es misst PoP → Origin → PoP, also nicht die Strecke Vercel-Function → Cloudflare-PoP. Auch diese Strecke ist kürzer geworden (beide Seiten jetzt in Stockholm), weshalb die ausgewiesene Ersparnis eine **Untergrenze** der tatsächlichen Gesamtersparnis ist.
- *Unterschiedliche Sitzungsdauer und Seitenmischung.* Das Vorher-Fenster ist länger und enthält mehr Abfragen; die Per-Tabellen-Kontrolle und die Normierung auf „ms je Abfrage im Render" gleichen das aus.
- *Ein Render-Vergleich, kein Mittel über viele.* Der 59-Abfragen-Vergleich ist ein Paar gleicher Größe, kein Perzentil über viele Renders.
- *Kein Lasttest.* Alle Zahlen stammen aus Einzelnutzung; Verhalten unter Parallellast ist nicht geprüft.

**Aussagekraft.** Hoch für die Frage, die PERF-001 gestellt hat: die Latenz zwischen Vercel-Functions und Supabase ist direkt, beidseitig und pro Tabelle kontrolliert gemessen und um rund 110 ms je Request gesunken. Die Audit-Schätzung von 80–120 ms war eine **Schätzung** und wird hiermit durch eine Messung ersetzt, die sie bestätigt. Gering ist die Aussagekraft für alles, was der Browser sieht: TTFB, LCP, INP und CLS bleiben unbelegt.

---

## 5. Regression Check

| Geprüfte Funktion | Ergebnis | Grundlage |
|---|---|---|
| Login und Session-Erhalt | PASS | Eine reale Sitzung erzeugte über 79 Sekunden 281 authentifizierte PostgREST-Requests mit gültigem Session-Token; Auth-Logs ohne Fehler |
| Navigation zu den App-Routen | PASS | Home, Projekt-Home, Action Plan, Agent, My Product, Experiments, Settings, Products, Repositories jeweils mit HTTP 200 gerendert |
| Projektzugriff und RLS | PASS | Alle Abfragen liefen als `authenticated` mit Session-Token und wurden mit 200 beantwortet; keine 401/403, keine RLS-Ablehnung |
| Server Components laden vollständig | PASS | Die Renderbursts zeigen die vollständigen Abfragefolgen der jeweiligen Read-Modelle, abgeschlossen ohne Abbruch |
| Keine unerwarteten Redirects | PASS | Keine 3xx-Kette in den Runtime-Logs; die Auth-Weiterleitungen entsprechen dem bekannten Muster |
| Keine neuen Function-Timeouts | PASS | Kein 504, keine abgebrochene Anfrage; längste beobachtete Origin-Antwort 369 ms |
| Keine neuen Supabase-/Netzwerkfehler | PASS | 281 von 281 Requests HTTP 200; Supabase-Projekt `ACTIVE_HEALTHY` |
| Keine neuen Runtime-Errors | PASS | Vercel Runtime-Errors über sechs Stunden: keine Fehlergruppe. Die zuvor bekannte `ai_usage_events`-Gruppe (42501, 27.08.) tritt nicht mehr auf |
| Keine 4xx/5xx auf dem neuen Deployment | PASS | Gezielte Abfragen auf `4xx` und `5xx` liefern „keine Einträge" |
| Health-Endpoint erreichbar | PASS (indirekt) | `/api/health` ist ausgeliefert und vom Proxy ausgenommen; ein direkter Aufruf war wegen der Egress-Policy nicht möglich |
| Production-Alias stabil | PASS | Ununterbrochene Bedienung der Produktionsdomain über den Umschaltpunkt hinweg, `aliasError: null` |
| Workflow-Ebene (`/.well-known/workflow/*`) | NICHT GEPRÜFT | Seit der Umstellung lief keine durable Operation; Region ist strukturell dieselbe, ein Lauf wurde bewusst nicht ausgelöst |
| Hydration-Fehler im Browser | NICHT GEPRÜFT | Erfordert eine Browsersitzung; clientseitiger Zugriff war nicht möglich |
| Schreibende Flows (Scan, Audit, Agent, Validation, Merge, Billing) | NICHT GEPRÜFT | Bewusst ausgeschlossen — kostenpflichtig beziehungsweise zustandsverändernd |

---

## 6. Entscheidung

1. **Ist bestätigt, dass Production jetzt in Stockholm läuft?** Ja. `regions: ["arn1"]` am laufenden Production-Deployment, kein Pfad mit abweichender Region, und die Gegenseite sieht die Aufrufe am Stockholmer PoP aus einem schwedischen AWS-Netz eintreffen.
2. **Ist eine niedrigere Vercel–Supabase-Latenz direkt gemessen?** Ja. Die vom Cloudflare-PoP gemessene Zeit je PostgREST-Request sank im Median von 134 ms auf 21 ms, im p95 von 374 ms auf 68 ms, über 14 einzeln kontrollierte Tabellen gleichförmig um 81–93 %.
3. **Haben sich die App-Routen messbar verbessert?** Ja, serverseitig. Die Datenbankphase eines datenintensiven Renders mit 59 Abfragen fiel von 5.041 ms auf 665 ms; ein abhängiger Sequenzschritt von 136 ms auf 30 ms. Wie sich das am Browser als TTFB und LCP niederschlägt, ist nicht gemessen.
4. **Werden die vorgeschlagenen Performance-Budgets erreicht?** Teilweise. Das Datenbank-Budget des Audits (typische Supabase-RTT ≤30 ms nach dem Region-Fix) ist erreicht: 21 ms im Median, 30 ms für einen kompletten abhängigen Schritt einschließlich Datenbankarbeit. Die TTFB-Budgets (≤400 ms für normale, ≤600 ms für datenintensive App-Seiten) sind **nicht bewertbar** — und die vorhandenen Zahlen mahnen zur Vorsicht: allein die Datenbankphase des schwersten Renders liegt bei 665 ms und damit bereits über dem 600-ms-Budget für die gesamte Serverantwort.
5. **Kann PERF-001 als gelöst markiert werden?** Ja. **Status: `Validated`.** Die Bewertungsregel ist vollständig erfüllt: Stockholm nachgewiesen, Produktionsdomain zeigt darauf, keine Regression festgestellt, und ein belastbarer Vorher-/Nachher-Vergleich liegt vor.
6. **Soll Stockholm beibehalten werden?** Ja. Die Verbesserung ist groß, gleichförmig und strukturell erklärbar; das Zielpublikum des Produkts liegt in Europa, und die Datenbank kann nicht ohne Weiteres verschoben werden.
7. **Gibt es einen Grund für einen Rollback?** Nein. Kein Fehler, keine Regression, kein Hinweis auf eine Verschlechterung.

**Neue Erkenntnis für die Priorisierung:** Mit der Entfernung fällt die Zahl der Abfragen als Engpass ins Gewicht. Ein Render, der 59 Abfragen in 21 Wellen absetzt, kostet auch bei 21 ms je Abfrage noch 665 ms. Damit werden [PERF-004](README.md#perf-004--healthhome-evidenz-wird-von-getauditaccessstatus-erneut-gelesen-kein-suspense) (Health/Home: erneuter Evidence-Read, kein Suspense) und [PERF-005](README.md#perf-005--action-plan-n1-über-moves-mit-evidenz--und-opportunities-neulesen) (Action Plan: N+1 über Moves) zum nächsten bindenden Engpass — nicht mehr die Geografie.

---

## 7. Noch fehlende Evidenz

| Offener Punkt | Kleinste sichere Erhebung | Aufwand |
|---|---|---|
| Web Vitals (TTFB, LCP, INP, CLS) am realen Browser | Vercel Speed Insights ist bereits eingebunden und sammelt seit der Umstellung. Die Werte im Vercel-Dashboard ablesen, getrennt vor und nach dem 2026-09-01 19:50 UTC. **Keine Codeänderung nötig.** | Minuten, rein lesend |
| Function-Duration je Route | In der Vercel-Logs-Ansicht des Deployments die Dauer-Spalte für die App-Routen lesen, solange die Aufrufe in der Retention liegen. **Keine Codeänderung nötig.** | Minuten, rein lesend |
| Dauerhafte Sicht auf die Supabase-RTT | Der Phase-0-Punkt des Audits: ein Sentry-Span um den bestehenden `fetch`-Wrapper in `src/lib/supabase/server.ts` beziehungsweise `service.ts` — eine Stelle, da dort bereits `withBoundedFetch` sitzt. **In diesem Schritt bewusst nicht umgesetzt.** | klein, ein Codeeingriff |
| Verhalten unter Parallellast | Ein k6-Lauf gegen eine Preview-Umgebung mit Testkonto, nicht gegen Production. | mittel |
| Workflow-Ebene nach der Umstellung | Beim nächsten regulären Scan oder Audit beobachten, ob die Steps unauffällig laufen — kein Lauf soll dafür ausgelöst werden. | keiner, nur beobachten |

**Ausdrücklich nicht empfohlen:** ein Rollback nach `iad1`, um weitere Vorher-Werte zu erzeugen. Die vorhandene Messung ist ausreichend, und ein Rollback würde die Nutzer erneut die 110 ms je Abfrage kosten.

**Randbeobachtung, außerhalb dieses Auftrags:** In den Supabase-Edge-Logs ruft ein Client, der nicht die Produktions-App ist (`supabase-js` statt `supabase-ssr`, Node 22 statt der Laufzeit des Deployments, PoP ORD/DFW), etwa im Minutentakt `/rest/v1/rpc/record_auth_attempt` auf — im beobachteten Fenster 942 Aufrufe zwischen dem 31.08. 20:59 und dem 01.09. 19:23 UTC. Das ist für diese Verifikation nur insofern relevant, als es die einzige Aktivität im Vorher-Fenster außerhalb der Nutzersitzung war und sauber von ihr getrennt werden konnte. Herkunft und Zweck sind hier nicht untersucht worden.
