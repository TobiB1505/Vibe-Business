# Vibe Business — Project History, Product Structure & Learnings

**Status:** August 2026
**Projektstart:** Tag 1 – August 2026

**Working thesis:**

> You vibe-coded the product. Now vibe the business.

---

## 1. Ausgangspunkt

Vibe Business entstand ursprünglich aus der Idee, bestehenden Websites und Apps automatisch eine modernere Version bzw. ein Redesign vorzuschlagen und daraus Dienstleistungen oder SaaS-Pakete zu verkaufen.

Während der ersten Produktdiskussionen wurde jedoch deutlich, dass das größere Problem nicht mehr unbedingt das Bauen von Software ist.

Tools wie:

- Claude Code
- Codex
- Lovable
- Cursor
- Replit
- v0
- Bolt

machen es immer einfacher, funktionierende Websites, Apps und SaaS-Produkte zu erstellen.

Die größere Lücke entsteht danach.

Viele Builder haben anschließend Fragen wie:

- Für wen ist das Produkt wirklich?
- Wie verdiene ich damit Geld?
- Wie bekomme ich die ersten Nutzer?
- Was sollte ich als Nächstes verbessern?
- Warum konvertieren Besucher nicht?
- Brauche ich Pricing?
- Brauche ich SEO?
- Brauche ich Ads?
- Wie messe ich Erfolg?
- Welche Änderungen haben tatsächlich etwas gebracht?

Daraus entstand die zentrale These:

> Building is becoming easy. Turning what you built into a business is still hard.

Vibe Business wurde deshalb vom Website-/Redesign-Konzept zum:

**Business Layer for AI-built products.**

---

## 2. Die zentrale Positionierung

**Primary tagline**

> You vibe-coded the product. Now vibe the business.

Alternative Beschreibung:

> Turn what you built into a business.

Die Zielgruppe sind vor allem:

- Vibe Coder
- Solo Founder
- AI Builder
- kleine Teams

die bereits ein Produkt gebaut haben, aber beim Schritt von Produkt → Business Unterstützung brauchen.

Vibe Business soll ausdrücklich **kein weiterer AI-Website-Builder** sein.

Der Nutzer hat bereits gebaut. Vibe beginnt danach.

---

## 3. GitHub als zentrale Integrationsschicht

Eine der frühesten und wichtigsten Architekturentscheidungen war:

**GitHub wird die gemeinsame Schnittstelle zwischen Vibe Business und den unterschiedlichen Build-Tools.**

Der Nutzer kann sein Produkt beispielsweise mit:

```
Lovable
Claude Code
Codex
Cursor
Replit
v0
Bolt
```

gebaut haben.

Solange das Projekt mit GitHub verbunden ist:

```
Builder
   ↓
GitHub
   ↓
Vibe Business
```

muss Vibe nicht für jeden AI-Builder eine eigene Integration bauen.

GitHub wird damit zur **Source of Truth** für das Produkt.

---

## 4. Das langfristige Produktmodell

Im Verlauf der Entwicklung hat sich eine klare Produktstruktur herausgebildet:

```
UNDERSTAND
    ↓
DIAGNOSE
    ↓
PRIORITIZE
    ↓
EXECUTE
    ↓
MEASURE
    ↓
REPEAT
```

**Understand**
Vibe muss zunächst verstehen, was tatsächlich gebaut wurde.

**Diagnose**
Vibe bewertet den aktuellen Business-Zustand.

**Prioritize**
Vibe entscheidet, welche Maßnahmen aktuell den größten Hebel haben.

**Execute**
Vibe bereitet konkrete Änderungen vor bzw. führt sie nach Freigabe aus.

**Measure**
Vibe überprüft anschließend, ob die Änderung tatsächlich einen positiven Effekt hatte.

Das langfristige Produkt ist damit kein Chatbot.

Es ist ein **Business Execution System**.

---

## 5. Das wichtigste Produktprinzip

Während der Entwicklung wurde eines der zentralen Prinzipien definiert:

> **Execution > Advice**

Viele AI-Produkte können bereits sagen:

> „Du solltest deine Pricing Page verbessern."

Das reicht Vibe nicht.

Langfristig soll daraus werden:

> I created an improved pricing page. Review & deploy?

Der vollständige Ziel-Loop lautet:

```
Analyze
↓
Identify Opportunity
↓
Prepare Change
↓
Create Branch
↓
Build / Test
↓
Preview
↓
User Approval
↓
Merge
↓
Measure
```

---

## 6. Sicherheitsprinzip für Automation

Parallel wurde eine klare Grenze definiert:

> **Prepare autonomously. Execute consequential actions with approval.**

Vibe darf beispielsweise selbstständig:

- analysieren
- priorisieren
- Branches vorbereiten
- Code ändern
- Tests durchführen
- Previews erzeugen

Aber **nicht ohne Zustimmung**:

- Production verändern
- Geld ausgeben
- Preise live ändern
- Kunden kontaktieren
- Verträge abschließen
- irreversible Aktionen ausführen

Damit bleibt der Nutzer bei geschäftlich relevanten Entscheidungen in Kontrolle.

---

## 7. Intelligence Architecture

Eine der wichtigsten Learnings war, dass Vibe nicht nur eine AI über den Code laufen lassen sollte.

Wir haben deshalb mehrere **Evidence Sources** aufgebaut.

### 7.1 Repository Intelligence

GitHub ist die wichtigste technische Informationsquelle.

Repository Intelligence erkennt deterministisch unter anderem:

- Framework
- Runtime
- Package Manager
- Routes
- Auth
- Integrationen
- App-Struktur
- Business Surfaces
- Infrastructure Signals

Dabei gilt:

**Repository-Code ist untrusted data.** Er wird nicht ausgeführt.

Vibe führt beim normalen Intelligence-Prozess insbesondere keine fremden:

```
npm install
shell scripts
builds
tests
```

aus.

---

## 8. Die Rolle der Live Product Intelligence

Ursprünglich wurde Live Product Intelligence als zweite große Produktanalyse gedacht.

Im Verlauf wurde klarer:

> **GitHub versteht. Live verifiziert.**

Repository Intelligence sagt beispielsweise:

```
/pricing exists
/app exists
/signup exists
Stripe dependency exists
```

Live Product Intelligence kann überprüfen:

```
/pricing → 404
/app → redirect /login
/signup → 200
robots.txt → missing
canonical → missing
```

Damit ist die sinnvollere Rollenverteilung:

```
GitHub
→ What should exist?

Live
→ What actually exists in production?
```

Die Live-Analyse ist deshalb stärker eine **Verification Layer** als ein zweiter unabhängiger Produkt-Analyzer.

---

## 9. Authenticated Deep Scan

Beim Dogfooding mit Vibe Business trat ein entscheidendes Problem auf.

Die öffentliche Analyse konnte sehen:

```
/app
→ redirect
→ /login
```

aber nicht, was ein Nutzer hinter dem Login tatsächlich erlebt.

Dadurch fehlten beispielsweise Informationen über:

- Dashboard
- Onboarding
- Workspace
- Settings
- Integrationen
- In-App Actions

Daraus entstand: **Deep Scan**

Der Deep Scan verwendet einen temporären Browser und lässt den Nutzer selbst seine App öffnen und sich anmelden.

Danach analysiert Vibe die authentifizierte Produktoberfläche.

---

## 10. Deep-Scan-Sicherheitsmodell

Ein sehr wichtiger Architekturgrundsatz wurde festgelegt.

Vibe speichert **nicht dauerhaft**:

- Passwörter
- Cookies
- Storage State
- Session Tokens
- Authorization Headers
- komplette DOMs
- HTML
- Screenshots
- wiederverwendbare Login-Sessions

Der Nutzer meldet sich in einem temporären Browser selbst an.

```
Temporary browser
↓
User login
↓
Authenticated scan
↓
Derived product structure
↓
Browser destroyed
```

Der Grund dafür ist **nicht technische Unmöglichkeit**.

Persistent Login wäre technisch möglich.

Wir verzichten zunächst bewusst darauf, weil ein wiederverwendbarer Session Cookie praktisch sehr mächtige Account-Rechte enthalten kann.

---

## 11. Erster realer Deep Scan

Beim ersten erfolgreichen Dogfood-Deep-Scan von Vibe Business wurden erstmals reale authentifizierte Produktinformationen erkannt.

Ergebnis:

- 6 Seiten
- ca. 11 Sekunden Analysezeit
- Complete
- Dashboard erkannt
- Project Workspace erkannt
- Integrations erkannt

Zusätzlich wurden reale Actions hinter Auth erkannt, beispielsweise:

- Run business audit
- Disconnect project
- Refresh repository intelligence

Diese Informationen waren über den Public Crawler nicht verfügbar.

Damit wurde der Nutzen des Deep Scans real belegt.

---

## 12. Deep Scan als Freemium-Feature

Eine wichtige Produktentscheidung entstand aus der Frage:

**Haben viele Vibe-Coded Apps überhaupt Login?**

Für ernsthafte SaaS-/App-Produkte ist davon auszugehen, dass Auth sehr häufig vorkommt.

Deshalb wäre es problematisch, den Deep Scan vollständig zu paywallen.

Der Nutzer könnte sonst denken:

> „Vibe versteht meine App gar nicht."

bevor er den vollständigen Produktwert gesehen hat.

Daraus entstand die Regel:

**Der erste erfolgreiche Deep Scan pro Projekt ist inklusive.**

Danach sollen weitere Deep Scans über Vibe Credits laufen.

Wichtig:

Ein Scan wird nur dann verbraucht, wenn ein gültiger Snapshot erfolgreich gespeichert wurde.

Nicht verbraucht wird er bei:

- Login-Abbruch
- Browserfehler
- Timeout
- Cancel
- Analysefehler
- Infrastrukturfehler

Die Logik lautet:

```
Start Scan
↓
Login
↓
Analyze
↓
Valid snapshot persisted
↓
SUCCESS
↓
Included Deep Scan consumed
```

---

## 13. Business Context

Ein weiteres wichtiges Learning:

Code und Website können nicht beantworten:

- Für wen wurde das Produkt gebaut?
- Was glaubt der Founder, was sein Produkt macht?
- Was ist aktuell das wichtigste Business-Ziel?
- Wie soll Geld verdient werden?
- In welchem Stadium befindet sich das Unternehmen?

Deshalb wurde eine dritte Evidence Source ergänzt: **Business Context**

Beispiele:

- product summary
- target customer
- stage
- monetization model
- primary goal

Damit besteht die Business-Analyse aus:

```
Repository Intelligence
+
Public Product Intelligence
+
optional Deep Scan
+
Business Context
```

---

## 14. Business Readiness Audit

Aus diesen Evidence Sources erzeugt Vibe den:

**Business Readiness Audit**

Bewertet werden genau fünf Dimensionen:

1. Product
2. Monetization
3. Distribution
4. Conversion
5. Retention

---

## 15. Einer der wichtigsten AI-Grundsätze

Während der Audit-Entwicklung entstand ein sehr wichtiges Prinzip:

> **Unknown ≠ Bad**

Fehlende Evidenz darf nicht als schlechte Performance interpretiert werden.

Beispiel: Wenn Vibe nichts über Retention weiß:

**Falsch:**

```
Retention = 10/100
```

**Richtig:**

```
Retention
insufficient_evidence
score = null
```

Das Audit unterscheidet deshalb:

- assessable
- partial
- insufficient evidence

Fehlende Dimensionen werden nicht als Null in den Gesamtscore gerechnet.

---

## 16. Evidence-first AI

Ein weiteres dauerhaftes Prinzip:

**AI darf keine Business-Bewertungen ohne belegbare Evidence liefern.**

Alle wichtigen Fakten bekommen stabile Evidence IDs.

Beispielsweise:

```
repo.framework.nextjs
live.surface.signup
auth.surface.dashboard
business.primary_goal
```

Die AI muss ihre Aussagen auf diese IDs zurückführen.

Nach dem Modell-Call validiert Vibe:

**Existiert jede zitierte Evidence ID tatsächlich?**

Halluzinierte IDs werden nicht akzeptiert.

Damit entsteht ein erklärbarer:

> Why does Vibe think this?

Flow.

---

## 17. Erster realer Business Audit

Der erste reale Business Audit von Vibe Business ergab:

**34 / 100**

Coverage: **5/5**

Dimensionen:

| Dimension | Score |
|---|---|
| Product | 50 |
| Monetization | 8 |
| Distribution | 28 |
| Conversion | 50 |
| Retention | 35 |

Ein besonders gutes Ergebnis war Monetization:

**8 / high confidence**

Nicht weil Daten fehlten, sondern weil mehrere Evidence Sources übereinstimmend zeigten:

- Monetization = planned
- keine Pricing Surface
- kein Checkout
- keine Payment Integration

Damit zeigte sich in der Realität:

> **Evidence of absence ≠ absence of evidence**

---

## 18. Erste reale AI Unit Economics

Der erste Audit lieferte außerdem erstmals echte Kostenwerte.

**Audit 1:**

| Messwert | Wert |
|---|---|
| Input tokens | 5,233 |
| Output tokens | 5,218 |
| Thinking tokens | 2,637 |
| Latency | 53.8 s |
| Provider cost | $0.062646 |

Daraus entstand ein weiterer dauerhafter Grundsatz:

> **Variable AI costs müssen vom ersten Tag an gemessen werden.**

---

## 19. AI Usage Ledger

Für jeden AI-Call werden intern unter anderem erfasst:

- Provider
- Model
- Operation
- Input Tokens
- Output Tokens
- Pricing Version
- Provider Cost
- Latency
- Status

Dieses Ledger ist ausdrücklich **nicht** dasselbe wie spätere Customer Credits.

Es beantwortet:

> Was kostet Vibe eine bestimmte Operation tatsächlich?

---

## 20. Structured Outputs Learning

Der erste echte Anthropic-Call scheiterte an einer zu großen kompilierten Structured-Output-Grammatik.

Das ursprüngliche Schema wiederholte dieselbe Dimension-Struktur fünfmal.

Nach der Änderung auf:

```
dimensions: [
   Dimension,
   Dimension,
   Dimension
]
```

statt:

```
dimensions: {
   product: Dimension,
   monetization: Dimension,
   distribution: Dimension,
   conversion: Dimension,
   retention: Dimension
}
```

sank die Schema-Größe stark.

Neben dem technischen Fix entstand dadurch überraschend auch ein Kosten-Vorteil.

Input Tokens:

```
7,603
→
5,233
```

ca. −31 %

**Learning:**

Provider-Wire-Schemas sollten kompakt sein und nicht zwangsläufig dem internen Domainmodell entsprechen.

Deshalb:

```
Provider Wire Format
↓
Normalize
↓
Validate
↓
Canonical Domain Model
```

---

## 21. Deep Scan → Business Audit

Später wurde Authenticated Product Intelligence in einen neuen `business-evidence.v2` integriert.

Dabei wurde eine zweite **Data-Minimization-Grenze** notwendig.

Der reale Deep Scan hatte beispielsweise erkannt:

- Projektnamen
- UUID-basierte Pfade
- Headings

Solche Informationen wurden bewusst generalisiert oder entfernt.

Beispiel:

```
/app/projects/123e4567...
```

wird zu:

```
/app/projects/:id
```

Das Ziel:

> **Product Structure analysieren, nicht User Content.**

---

## 22. Audit mit Deep Scan

Der zweite reale Audit verwendete zusätzlich Deep-Scan-Evidence.

Ergebnis:

```
Overall
34 → 40
```

Dimensionen:

| Dimension | Vorher | Nachher |
|---|---|---|
| Product | 50 | 55 |
| Monetization | 8 | 10 |
| Distribution | 28 | 32 |
| Conversion | 50 | 58 |
| Retention | 35 | 45 |

Wichtiger als der Score war jedoch die Interpretation.

### Wirklich verbessert

**Product**
Der authentifizierte Produktbereich war jetzt direkt beobachtet.

**Retention**
Vorher war unbekannt, ob der eingeloggte Produktbereich überhaupt erreichbar war. Nach dem Deep Scan lagen direkte Evidence dafür vor.

### Wahrscheinlich Modellvarianz

Distribution und Conversion verwendeten keine neue `auth.*` Evidence, änderten ihren Score aber trotzdem.

**Learning:**

Eine Score-Veränderung ist nicht automatisch durch neue Evidence verursacht.

Wir dürfen AI-Ergebnisse nicht wie deterministische Messinstrumente behandeln.

---

## 23. Deep-Scan-Kosten

Der zweite Audit mit zusätzlichem Deep-Scan-Kontext kostete:

| Messwert | Wert |
|---|---|
| Input tokens | 6,902 |
| Output tokens | 5,684 |
| Thinking | 3,166 |
| Latency | 49.4 s |
| Cost | ~$0.0706 |

Damit kostete der zusätzliche Product Context ungefähr:

```
+$0.008
```

pro Audit.

Das wurde als akzeptabler Preis für deutlich bessere Product Evidence bewertet.

---

## 24. Durable Operations

Die realen Audit-Laufzeiten von ungefähr 50 Sekunden führten zu einer weiteren Architekturentscheidung:

**Langlaufende Operationen dürfen nicht vom ursprünglichen HTTP-Request abhängen.**

Daraus entstand **Durable Operation Execution**.

Statt:

```
Click
↓
HTTP request
↓
wait 50 seconds
↓
response
```

gilt:

```
Click
↓
Operation created
↓
HTTP returns
↓
durable execution
↓
user may leave
↓
result persisted
```

Supabase bleibt dabei der kanonische Product-State.

Die Execution Layer orchestriert nur die Arbeit.

---

## 25. Paid-Call Safety

Durable Execution brachte ein weiteres wichtiges Prinzip:

> **Paid external calls dürfen nicht blind retried werden.**

Beispiel:

Ein Anthropic Request läuft in einen Timeout.

Vibe weiß möglicherweise nicht sicher:

- wurde er verarbeitet?
- wurde er berechnet?
- kam nur die Response nicht zurück?

Deshalb darf Vibe nicht automatisch denselben kostenpflichtigen Call nochmals starten.

**Cost Safety ist Bestandteil der Architektur.**

---

## 26. Credits-Modell

Das bisherige Geschäftsmodell basiert auf:

**Subscription + Vibe Credits**

Credits repräsentieren keine Anthropic Tokens.

Sie sind ein abstrahiertes Produkt-Usage-System.

Beispielsweise könnten später Credits verwendet werden für:

- Business Audit
- Deep Scan
- Opportunity Generation
- Code Execution
- Preview Builds
- größere Analyseoperationen

Wichtig:

**Customer Credits und Provider Costs bleiben getrennte Systeme.**

Intern messen wir tatsächliche Kosten. Extern verkauft Vibe Ergebnisse.

---

## 27. Warum kein Unlimited AI

Ein weiteres Prinzip:

**Kein Unlimited AI.**

Stattdessen:

- feste Usage Budgets
- Reuse identischer Ergebnisse
- Input Identity
- Token Counting
- Output Budgets
- Provider Cost Tracking
- später Credits

Damit lässt sich Worst-Case-Kostenentwicklung kontrollieren.

---

## 28. Prompt Caching

Prompt Caching wurde als möglicher späterer Optimierungshebel identifiziert.

Aktuell hat es jedoch keine Priorität.

Reihenfolge:

```
Product Value
↓
Execution
↓
Users
↓
Real usage
↓
Cost Optimization
```

Später können bewertet werden:

- Prompt Caching
- High vs Medium Effort
- Output Token Reduction
- Cost per Operation
- Cache Hit Rate

Optimierung ohne reale Nutzung wird bewusst vermieden.

---

## 29. Opportunity Engine

Der nächste zentrale Produktblock ist:

**Opportunity Engine**

Business Readiness beantwortet:

> Wo steht mein Business?

Opportunity Engine beantwortet:

> Was sollte ich jetzt als Nächstes tun?

Ziel ist ausdrücklich **keine riesige Recommendation-Liste**.

Stattdessen: **Top 3–5 höchste Hebel.**

Eine Opportunity soll enthalten:

- Problem
- Why now
- Impact
- Effort
- Confidence
- Evidence
- Business Dimension
- Dependencies
- Execution Type
- Execution Readiness

### Status: implementiert (Sprint 8)

Der obige Abschnitt beschreibt die Planung. Die Opportunity Engine wurde
anschließend gebaut und gemerged.

Das Ergebnis des ersten realen Dogfood-Laufs:

| Messwert | Wert |
|---|---|
| Opportunities | 3 |
| Input tokens | 10,309 |
| Output tokens | 3,092 |
| Thinking tokens | 2,010 |
| Latency | 33.9 s |
| Provider cost | $0.0515 |

Die wichtigste Beobachtung war nicht der Score, sondern die Reihenfolge.

Monetization war mit 10/100 die schwächste Dimension — wurde aber **nicht**
Rang 1. Die Engine setzte "Clarify what the product is and who it's for" davor,
mit expliziter Dependency, und begründete das selbst damit, dass eine
Pricing-Entscheidung gegen unklare Positionierung doppelte Arbeit wäre.

Damit wurde in der Realität bestätigt:

> **Sequencing beats severity.**

Der niedrigste Score ist nicht automatisch die höchste Priorität.

#### Das wichtigste Learning aus diesem Sprint

Eine der drei Opportunities war sachlich falsch. Sie behauptete, robots.txt und
sitemap seien im Repository vorhanden und würden nur nicht ausgeliefert.

Die Ursache lag **nicht** in der Opportunity Engine.

Der Repository-Analyzer meldete `robots: detected: true` — und zitierte dabei
`src/modules/live-product-intelligence/robots.ts`, also den robots.txt-**Parser**
des eigenen Crawlers. Für ein Produkt, das robots.txt analysiert, war der
Detector zu unspezifisch.

Die Engine hatte korrekt gearbeitet: sie zitierte echte Evidence IDs und ihre
Schlussfolgerung folgte gültig daraus. Die Evidence war falsch.

Nach dem Fix des Analyzers (`repo-intelligence-v2`) und einem erneuten
Durchlauf korrigierte sich die Aussage **ohne jede Änderung an Prompt, Rubric
oder Engine**:

```
vorher:  "the repository itself contains robots.txt and sitemap files —
          they simply aren't being served"        ← falsch

nachher: "The repository confirms none of these are implemented in code
          either."                                ← korrekt
```

Daraus folgt ein dauerhaftes Learning:

> **Opportunity quality is bounded by evidence quality.**

Das gilt in beide Richtungen. Ein falsches Signal erzeugt selbstbewusste
Falschaussagen — und nichts weiter unten in der Kette kann das erkennen, weil
die zitierte Evidence ID real existiert. Wird das Signal korrigiert, repariert
sich die Aussage von selbst.

Das erweitert **Evidence before AI** (§16) um eine Ebene: auch deterministische
Analyzer können falsch liegen, nicht nur das Modell.

#### Prioritization ist stabiler als Scoring

Über zwei unabhängige Läufe auf unterschiedlicher Evidence blieben Rang 1 und 2
nahezu identisch — gleiche Reihenfolge, gleiche Dependency, gleiche Execution
Readiness. Im selben Zeitraum bewegte sich der Audit-Score:

```
38 → 40 → 41 → 38
```

Die Prioritisierungsebene war also reproduzierbarer als die Diagnose darunter.

Learning: Rubric-Tuning aus einem einzelnen Lauf ist besonders dann gefährlich,
wenn die Ebene darunter mehr rauscht als die Ebene darüber.

---

## 30. Der spätere Kernmoment

Nach Opportunity Generation folgt:

**Let Vibe do it**

Beispiel:

```
Improve homepage conversion

Impact: High
Confidence: High

Why:
...

[ Let Vibe do it ]
```

Danach:

```
Create Branch
↓
Modify Code
↓
Tests
↓
Preview
↓
User Review
↓
Approve
↓
Merge
```

Das ist der Kern der ursprünglichen **Execution > Advice** These.

---

## 31. Vibe Business als erster Kunde

Ein weiteres fundamentales Projektprinzip:

> **Vibe Business ist sein eigener erster Kunde.**

Wir entwickeln nicht nur Software.

Wir bauen gleichzeitig das Business selbst:

- Positionierung
- ICP
- Pricing
- SEO
- Landingpage
- Content
- Launch
- Analytics
- Ads
- Conversion
- Retention
- Growth

Dabei wird jede manuelle Business-Aufgabe dokumentiert.

Die zentrale Frage lautet jedes Mal:

> Could Vibe Business do this for a customer later?

---

## 32. Dogfooding als Product Discovery

Beispiele für bereits entstandene Features durch Dogfooding:

```
Problem:
Public crawler kann /app nicht sehen.

↓ Dogfood

Feature:
Authenticated Deep Scan
```

```
Problem:
Audit dauert ~50 Sekunden.

↓ Dogfood

Feature:
Durable Operation Execution
```

```
Problem:
AI verwechselt fehlende Daten mit schlechten Daten.

↓ Dogfood

Feature:
Unknown ≠ Bad
```

```
Problem:
Structured Output Schema zu groß.

↓ Dogfood

Feature:
Provider Wire Schema ≠ Domain Schema
```

Damit wird Vibe Business durch reale Probleme des eigenen Geschäfts entwickelt und nicht nur durch theoretische Feature-Ideen.

---

## 33. Ads und Go-to-Market

Paid Acquisition wird voraussichtlich ebenfalls Teil unseres eigenen Go-to-Market-Prozesses.

Vibe Business soll lernen:

```
Audience
↓
Message
↓
Creative
↓
Channel
↓
Budget
↓
Landing Page
↓
CTR
↓
CPC
↓
Signup
↓
Activation
↓
Paid Conversion
↓
CAC
```

Ads sollen langfristig nicht nur ein „AI Ad Generator"-Feature werden.

Vibe könnte später:

```
Understand product
+
Understand ICP
+
Understand conversion funnel
+
Understand previous experiments
↓
Prepare acquisition experiment
↓
Founder approves budget
↓
Run
↓
Measure
↓
Optimize
```

Auch hier gilt:

> Geld ausgeben = consequential action → Approval erforderlich.

---

## 34. Experiment-Led Product Development

Für den Business-Aufbau soll zukünftig stärker mit Experimenten gearbeitet werden.

Beispiel:

```
EXP-001

Hypothesis:
"You vibe-coded the product. Now vibe the business."
converts better than a generic AI-business headline.

Change:
Landing page hero

Primary metric:
Signup conversion

Result:
...

Decision:
Keep / Reject / Iterate
```

Später beispielsweise:

```
EXP-012

Channel:
Reddit Ads

Spend:
€100

Visitors:
...

Signups:
...

Deep Scans:
...

Paid Customers:
...

CAC:
...

Decision:
...
```

Diese Struktur kann später wiederum selbst ein Vibe-Feature werden.

---

## 35. Die bisher gelernte Gesamtarchitektur

Die Produktarchitektur lässt sich inzwischen sehr klar darstellen:

```
                   VIBE BUSINESS

                        │
                        ▼
                   CONNECT
                        │
                      GitHub
                        │
                        ▼
                 UNDERSTAND
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
     Repository      Public       Deep Scan
     Intelligence    Verify     Authenticated
          └─────────────┼─────────────┘
                        ▼
                 PRODUCT MODEL
                        │
              + Business Context
                        │
                        ▼
                    DIAGNOSE
                        │
            Business Readiness Audit
                        │
                        ▼
                   PRIORITIZE
                        │
                Opportunity Engine
                        │
                        ▼
                    EXECUTE
                        │
                Prepare Change
                        │
                     Branch
                        │
                     Tests
                        │
                    Preview
                        │
                   Approval
                        │
                     Merge
                        │
                        ▼
                    MEASURE
                        │
          Conversion / Usage / Revenue
                        │
                        ▼
                     REPEAT
```

---

## 36. Dauerhafte Produktprinzipien

Aus den bisherigen Sprints haben sich folgende Regeln entwickelt:

**1. Execution > Advice**
Vibe soll handeln, nicht nur beraten.

**2. Evidence before AI**
AI bekommt strukturierte Evidence statt beliebigen Rohdaten.

**3. Unknown ≠ Bad**
Keine Fake-Sicherheit.

**4. GitHub = Integration Backbone**
Build Tool ist zweitrangig.

**5. Repository = Understand**
Code zeigt, was gebaut wurde.

**6. Live = Verify**
Production zeigt, was wirklich live ist.

**7. Deep Scan = Understand authenticated experience**
Nur wenn nötig.

**8. First Deep Scan included**
Vibe muss das Produkt erst verstehen dürfen, bevor es Geld für tieferes Arbeiten verlangt.

**9. Provider format ≠ Domain format**
Externe API-Limits dürfen nicht das interne Produktmodell verschlechtern.

**10. Measure variable cost from day one**
Jeder AI-/Provider-Call muss wirtschaftlich beobachtbar sein.

**11. No blind retries for paid actions**
Cost Safety ist Teil der Architektur.

**12. Prepare autonomously, execute consequential actions with approval**
User bleibt bei kritischen Entscheidungen verantwortlich.

**13. Dogfood everything**
Vibe Business ist Kunde #1.

**14. Every manual business task is potential product discovery**
SEO, Ads, Pricing, Launch und Growth gehören genauso zur Produktentwicklung wie Code.

**15. Advice may rest on stored evidence — execution must revalidate the premise**
Ein Ratschlag aus falscher Evidenz ist ein falscher Satz. Ein Repository-Write
aus falscher Evidenz ist ein falscher Commit im Repository eines Kunden.

Deshalb erbt Execution nicht das Vertrauen der Evidence-Kette:

```
executionReadiness = ready   → autorisiert nichts
gespeicherte Evidence IDs    → autorisieren nichts
```

Nur aktueller, unmittelbar vor dem Schreibvorgang unabhängig geprüfter Zustand
autorisiert einen konsequenten externen Write.

**16. Erfolgreiche Ausführung hat mehrere Vertrauensebenen**
Zu verifizieren, dass Vibe exakt die beabsichtigten Bytes geschrieben hat,
beweist die Integrität des Repository-Writes. Es beweist **nicht**, dass die
vorgeschlagene Änderung produktreif oder inhaltlich gut ist.

```
Bytes stimmen mit Absicht überein  → repository_write_verified
Absicht war richtig                → menschliches Review
Code funktioniert im Betrieb       → Runtime-Validierung (existiert nicht)
```

Der erste echte Write war auf jeder Sicherheitsebene korrekt und listete
trotzdem `/login` in einer Sitemap. Kein Invariant ist gebrochen — die Absicht
war falsch. Human Review und spätere Runtime-Validierung bleiben eigene Gates,
und keines davon lässt sich durch ein grüneres Hash-Ergebnis ersetzen.

Nebenbefund derselben Klasse wie der `project_repositories`-Bug: Ein
TypeScript-Union und ein SQL-CHECK-Constraint beschreiben dieselbe Regel an zwei
Stellen, die nichts zur Übereinstimmung zwingt. 1376 grüne Tests, und jede echte
Preparation wäre am INSERT gescheitert. Wo eine Regel doppelt existiert, muss ein
Test die beiden Kopien vergleichen.

**17. Ein validiertes Artefakt und ein laufender Preview beweisen Verschiedenes**
Validierung stellt Ausführbarkeit unter einer definierten Policy fest. Preview
stellt fest, dass dasselbe Artefakt für ein menschliches Review darstellbar ist.
Keines von beiden ist eine Freigabe.

```
sandbox_validation_passed  → die Befehle liefen fehlerfrei in einer isolierten VM
preview_available          → genau dieses Artefakt läuft und ist erreichbar
human_approved             → jemand hat es angesehen und entschieden
```

Der Abstand zwischen der zweiten und der dritten Zeile ist der ganze Punkt: ein
Preview, der eine schöne kaputte Seite rendert, ist ein erfolgreicher Preview.
Deshalb steht neben jedem laufenden Preview weiterhin "Not merged · Not deployed
· Not reviewed by a human" — genau dort, wo ein Nutzer am ehesten mehr annimmt,
als passiert ist.

Zweitens: ein Artefakt aufzubewahren ist eine Aufbewahrungsentscheidung, keine
Bequemlichkeit. Das Dateisystem eines Kunden liegt dabei beim Provider. Es
existiert für genau einen Zweck, hat eine explizite Frist, und wird gelöscht,
sobald der Preview endet — mit der ehrlichen Folge, dass ein zweiter Preview
meist eine neue Validierung kostet. Diese Kosten gehören sichtbar in die UI und
niemals in einen automatischen "Refresh".

**18. Review ist ein eigenes Gate — und ein Vergleich ist nur dann ehrlich, wenn
seine Vergleichbarkeit erzwungen wird**
Ein Diff verlangt, Code zu lesen. Ein Preview-Link verlangt, zwei Tabs aus dem
Gedächtnis nebeneinanderzuhalten, bevor der Preview abläuft. Beides ist
Hausaufgabe, kein Review. Das Artefakt, das dazwischen fehlte, ist ein
kontrollierter Vorher/Nachher-Vergleich:

```
preview_available          → genau dieses Artefakt läuft und ist erreichbar
review_artifact_available  → ein kontrollierter Vergleich existiert
human_approved             → jemand hat hingesehen und entschieden
```

Drei Dinge, die dieser Sprint gelehrt hat:

*Vergleichbarkeit ist eine Datenbank-Invariante, keine Absicht.* Zwei Bilder in
unterschiedlichen Größen sind kein Vorher/Nachher — jedes umgebrochene Element
darin liest sich als Änderung, die nie stattgefunden hat. Deshalb erzwingt ein
CHECK, dass ein `ready`-Artefakt **beide** Seiten und **identische** Maße hat.
Und ein einseitiger Vergleich ist ein Fehler, kein Teilerfolg: ein Bild neben
einem leeren Kasten liest sich als "die Änderung hat die Seite gelöscht".

*"Vorher" ist das, was beobachtet wurde — nicht der Base-Commit.* Production
konnte in dem Moment alles sein. Also wird `before_origin` mit Zeitstempel
gespeichert und die ehrliche Semantik mitgeführt, statt eine Aussage über einen
Commit zu erfinden, die niemand geprüft hat.

*Das Review-Artefakt überlebt den Preview, den es fotografiert hat.* Sonst
entsteht genau der falsche Anreiz: eine bezahlte Sandbox am Leben halten, damit
ein Screenshot sichtbar bleibt. `ON DELETE SET NULL` statt `CASCADE` — der
Aufräum-Pfad darf die Evidenz nicht mitnehmen.

Und die Grenze bleibt: kein Score, kein "verbessert", 0 AI-Calls im gesamten
Review-Pfad. Der erste Vergleich wird eine Startseite zeigen, die vorher und
nachher gleich aussieht, weil die SEO-Änderung `robots.ts` und `sitemap.ts`
betrifft. Das ist das ehrliche Ergebnis — ein visueller Vergleich beweist, dass
die Review-Pipeline funktioniert, nicht dass jede Codeänderung in Pixeln sichtbar
ist.

---

## 37. Aktueller Stand

**Understand**

```
Repository Intelligence       ✅
Public Product Intelligence   ✅
Authenticated Deep Scan       ✅
Business Context              ✅
```

**Diagnose**

```
Business Readiness Audit      ✅
Evidence v2                   ✅
Cost Accounting               ✅
```

**Infrastructure**

```
Durable Operations            ✅
Supabase migration workflow   ✅
GitHub connection             ✅
Vercel deployment             ✅
```

**Prioritize**

```
Opportunity Engine            ✅
```

**Execute**

```
Branch creation               ✅
Code changes                  ✅ (eine Capability)
Isolated validation           ✅ (Sandbox, install/typecheck/test/build)
Preview                       ✅ (15 Min, temporär, öffentlich-unlisted)
Before/After Review           ✅ gebaut · Dogfood offen
Approval                      planned
Merge                         planned
```

Am 12.08.2026 hat Vibe zum ersten Mal Code in ein echtes Repository
geschrieben: ein Branch, ein Commit, zwei Dateien, per Read-back verifiziert.
Der Default-Branch wurde nie angefasst. 0 AI-Calls, $0 — die Ausführung selbst
ist deterministisch, das Modell hat nur priorisiert, nicht geschrieben.

Drei Versuche sind vorher fehlgeschlagen, an einem Tabellennamen, den kein Test
finden konnte, weil jeder Workflow-Test genau diese Stelle durch ein Fake
ersetzt. Das ist inzwischen das wiederkehrende Muster dieses Projekts: die
Tests beweisen die Logik, der Dogfood beweist die Verdrahtung.

Was der Dogfood **nicht** zeigt: dass der erzeugte Code gut ist. Nichts hat ihn
gebaut, ausgeführt oder getestet. `repository_write_verified` ist die ehrliche
Obergrenze — und der erzeugte Sitemap listet `/login`, was ein Reviewer
vermutlich streichen würde.

**Measure**

```
Product analytics             planned
Experiments                   planned
Conversion measurement        planned
Revenue/CAC                   planned
```

---

## 38. Der nächste große Übergang

Bis jetzt haben wir gebaut:

> Vibe understands your product and business.

und inzwischen auch:

> Vibe decides what should happen next.

Der nächste Abschnitt ist:

> Vibe does it.

Und zuletzt:

> Vibe measures whether it worked.

Damit entwickelt sich Vibe Business Schritt für Schritt von einem Analyseprodukt zu einem **AI-native Business Operating System für AI-built Products**.

---

## Empfohlene zusätzliche Dokumentstruktur

Ich würde neben diesem History-Dokument künftig zusätzlich pflegen:

```
/docs/business/

POSITIONING.md
ICP.md
PRICING.md
GTM.md
SEO.md
PAID-ACQUISITION.md
EXPERIMENTS.md
UNIT-ECONOMICS.md
```

und technisch weiterhin:

```
/docs/sprints/
/docs/decisions/
ARCHITECTURE.md
PRODUCT.md
```

Dann trennen wir sauber:

| Frage | Dokument |
|---|---|
| Was ist das Produkt? | [`PRODUCT.md`](../PRODUCT.md) |
| Wie ist es gebaut? | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Warum haben wir Architekturentscheidungen getroffen? | [ADRs](decisions/README.md) |
| Wie sind wir hierher gekommen? | dieses Dokument |
| Wie machen wir Vibe selbst zum Business? | [`/docs/business/`](business/README.md) |
