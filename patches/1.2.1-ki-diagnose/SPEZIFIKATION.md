# hr-onsite 1.2.1 — „Die KI sagt, warum sie schweigt"

Umsetzungsvorlage. Verifiziert gegen den ausgelieferten 1.2.0-Build
(`Opero-hr-onsite-1.2.0-win.zip` → `resources/app.asar`), nicht gegen den
Quellstand — Datei- und Funktionsnamen entsprechen dem kompilierten Stand,
Zeilennummern können abweichen.

Ausgangslage: Ein Diff 1.1.1 → 1.2.0 zeigt, dass `services/ai/*`,
`routes/settings.js` und der gesamte `electron/`-Ordner byte-identisch sind.
1.2.0 hat am KI-Pfad nichts geändert. Was fehlt, ist nicht ein Fix, sondern
eine Aussage: Die App weiss, warum der Aufruf scheitert, und behält es für sich.

---

## Baustein 1 — Fehlerklassen, die den Fall benennen

**Datei:** `apps/backend/src/services/ai/index.ts`

Heute landet alles zwischen 401 und 529 in `http_error`. Ein abgelehnter
Schlüssel, ein leeres Guthaben und ein Rate-Limit sehen für den Nutzer
identisch aus — obwohl sie drei völlig verschiedene Handgriffe verlangen.

### 1a. Typ erweitern

```ts
export type AiErrorClass =
  | 'ok' | 'disabled' | 'no_provider'
  | 'network' | 'timeout'
  | 'auth'           // 401/403 — Schlüssel abgelehnt
  | 'kein_guthaben'  // 400 + credit balance
  | 'rate_limit'     // 429
  | 'ueberlastet'    // 529 / 5xx
  | 'model_not_found'
  | 'http_error'     // bleibt der Rest-Topf
  | 'empty_body' | 'invalid_json';
```

### 1b. Ein Klassifizierer für alle Anbieter

Derzeit entscheidet jeder Anbieter-Zweig selbst, und alle drei kennen nur
„404 heisst Modell". Dieselbe Regel dreimal unabhängig — genau das Muster,
gegen das `isCloudProviderBlocked()` im selben File schon einmal
zusammengezogen wurde.

```ts
/**
 * HTTP-Antwort → Fehlerklasse. EINE Stelle für alle Anbieter.
 *
 * Vorher entschied jeder Anbieter-Zweig für sich, und alle drei kannten nur
 * "404 heisst Modell, alles andere heisst http_error". Damit sahen ein
 * abgelehnter Schlüssel, ein leeres Guthaben und ein Rate-Limit gleich aus:
 * "KI nicht erreichbar". Drei Fälle, drei verschiedene Handgriffe, eine
 * Meldung — das war die eigentliche Lücke.
 */
export function klassifiziereHttp(status: number, body: string): AiErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 529 || status >= 500) return 'ueberlastet';
  if (status === 400 && /credit balance|insufficient|billing/i.test(body)) return 'kein_guthaben';
  if (status === 404 || /not found|invalid model|no such model|unknown model/i.test(body)) return 'model_not_found';
  return 'http_error';
}
```

In `callAnthropic`, `callPerplexity` und `callOllamaCompat` den jeweiligen
`looksLikeModel`-Block durch `klassifiziereHttp(res.status, detailText)`
ersetzen.

### 1c. `describeAiError()` — Ursache und nächster Schritt in einem Satz

```ts
case 'auth':
  return 'Der API-Schlüssel wurde abgelehnt (HTTP 401). Er ist ungültig, widerrufen '
       + 'oder gehört zu einem anderen Konto. Einstellungen → KI → Schlüssel neu eintragen.';
case 'kein_guthaben':
  return 'Das Konto beim Anbieter hat kein Guthaben mehr oder das Ausgabelimit ist '
       + 'erreicht. Die Verbindung steht — abgelehnt wird die Abrechnung, nicht der Zugriff.';
case 'rate_limit':
  return 'Zu viele Anfragen in kurzer Zeit (HTTP 429). Das gibt sich von selbst; '
       + 'Opero versucht es automatisch erneut.';
case 'ueberlastet':
  return 'Der Anbieter ist überlastet (HTTP 529/5xx). Kein Fehler auf deiner Seite; '
       + 'Opero versucht es automatisch erneut.';
case 'network':
  return 'Keine Verbindung zu api.anthropic.com. Häufigste Ursachen: ein '
       + 'Unternehmensproxy oder eine Firewall, die HTTPS mitliest, oder der Rechner '
       + `ist offline. ${detail ?? ''}`.trim();
```

Die `network`-Zeile folgt bewusst dem Muster aus Milestone 68 (OneDrive-
Platzhalter im Ordner-Watcher): wahrscheinliche Ursache samt Abhilfe benennen,
nicht nur das Symptom.

---

## Baustein 2 — Das Ergebnis steht im Protokoll, nicht nur der Versuch

**Datei:** `apps/backend/src/services/auditLog.ts`, Aufrufer in `services/ai/index.ts`

`logExternalCall('C', 'api.anthropic.com', 'ai.call', bytes)` schreibt VOR dem
Aufruf. Der Ausgang wird nie festgehalten. Die Tabelle `audit_log` hat bereits
eine `detail`-Spalte, und Einstellungen → Datenschutz zeigt sie schon an — die
Historie kostet also keinen neuen Bildschirm.

Nach jedem fehlgeschlagenen Aufruf zusätzlich:

```ts
logExternalCall('C', 'api.anthropic.com', 'ai.call.fehler', 0,
  `${error} · HTTP ${res?.status ?? '-'} · ${detailText.slice(0, 200)}`);
```

Niemals der Schlüssel, niemals der Prompt — nur Klasse, Status und die
Fehlermeldung des Anbieters.

---

## Baustein 3 — Der Selbsttest (das eigentliche „genauer beschreiben")

**Neu:** `apps/backend/src/services/ai/selbsttest.ts`
**Route:** `GET /api/settings/ai/selbsttest`
**UI:** Einstellungen → KI, Darstellung wie die Einzelprüfungen aus
`db/restoreIntegritaet.ts` (Liste mit Name · Ergebnis · Detail · nächster Schritt)

Rückgabe pro Stufe: `{ name, ok, detail, naechsterSchritt }`.

| # | Stufe | Prüfung | Trennt |
|---|---|---|---|
| 1 | Provider gewählt | `provider !== 'none'`, `enabled` | „ausgeschaltet" von „kaputt" |
| 2 | Schlüssel hinterlegt | `!!(anthropic?.apiKey \|\| apiKey)`, Präfix `sk-ant-`, Länge — nie der Wert | „Schlüssel weg" von „Schlüssel abgelehnt" |
| 3 | Nur lokale KI | `isCloudProviderBlocked(s)` | der stille Killer: meldet sich heute als `disabled` |
| 4 | **Namensauflösung, TLS, Konto** | `GET https://api.anthropic.com/v1/models` mit `x-api-key` | **Netz von Konto — ohne einen einzigen Token zu verbrauchen** |
| 5 | Modell verfügbar | konfiguriertes Modell in der Liste aus Stufe 4? sonst die vorhandenen nennen | „Modell weg" von „alles weg" |
| 6 | Echter Aufruf | der bestehende Mini-Probe-Call, mit Laufzeit | Erreichbarkeit von Antwortfähigkeit |

Stufe 4 ist der Kern. `/v1/models` antwortet mit 401 bei schlechtem Schlüssel
und 200 bei gutem, kostet nichts und wirft bei fehlender Verbindung. Damit
beantwortet ein Klick genau Horsts Frage: liegt es am Netz oder am Konto.
Stufe 5 spiegelt, was der Ollama-Zweig in `testAiConnection()` längst tut
(`models.slice(0, 6).join(', ')`) — für Anthropic gab es das nie.

### „Diagnose kopieren"

Knopf unter dem Ergebnis, erzeugt einen Textblock zum Einfügen in eine Mail:

```
Opero hr-onsite 1.2.1 · Windows 11 26H1
Provider: anthropic · Modell: claude-haiku-4-5-20251001 · Schlüssel hinterlegt: ja
1 Provider gewählt        ok
2 Schlüssel hinterlegt    ok    sk-ant-… (108 Zeichen)
3 Nur lokale KI           ok    aus
4 Netz/TLS/Konto          FEHLER  fetch failed (ENOTFOUND api.anthropic.com)
5 Modell verfügbar        –     nicht geprüft
6 Echter Aufruf           –     nicht geprüft
HTTPS_PROXY: nicht gesetzt · Systemproxy laut Windows: 10.12.0.4:8080
Letzte 3 Aufrufe (audit_log): …
```

Kein Schlüssel, kein Prompt, kein Projektinhalt.

---

## Baustein 4 — Banner und Ampel nennen die Klasse

**Dateien:** `apps/frontend/src/App.tsx`, `components/layout/TopBar.tsx`,
`hooks/useAiHealth.ts` (trägt `error` und `detail` bereits), `i18n/messages.ts`

Heute: „KI-Provider nicht erreichbar (Anthropic Claude · claude-…)". Punkt.
Künftig: Überschrift je Klasse, darunter „Details" mit dem rohen `detail`,
daneben ein Verweis auf Einstellungen → KI → Selbsttest.

Neue Schlüssel in DE/EN/ES/FR: `ai.banner.auth`, `ai.banner.kein_guthaben`,
`ai.banner.rate_limit`, `ai.banner.ueberlastet`, `ai.banner.network`.
`topbar.aiUnavailableTitle` bekommt die Klasse in den Tooltip.

---

## Baustein 5 — angrenzend, eigene Entscheidung

Kein Diagnose-Thema, sondern zwei Fixes. Getrennt beschliessen.

**5a. Wiederholung bei 429 und 529.** `callAnthropic` hat keinen Retry. Ein
Rate-Limit von 20 Sekunden färbt die App über den 60-Sekunden-Health-Cache
minutenlang rot. Zwei Versuche, Backoff, `retry-after` beachten, danach erst
die Fehlerklasse melden.

**5b. Proxy respektieren.** Weder Backend noch Electron werten eine
Proxy-Einstellung aus; Node's `fetch` ignoriert die Windows-Systemeinstellung,
solange `HTTPS_PROXY` nicht in der Prozessumgebung steht. In einem
Unternehmensnetz ist die KI damit unerreichbar, ohne dass jemand etwas
verändert hat.

In `electron/main.cjs`, an derselben Stelle wie `OPERO_DATA_DIR` (Zeile ~72),
also bevor das Backend geladen wird:

```js
const proxy = await session.defaultSession.resolveProxy('https://api.anthropic.com');
// "PROXY 10.12.0.4:8080" | "DIRECT"
const treffer = /PROXY\s+([^;]+)/.exec(proxy);
if (treffer && !process.env.HTTPS_PROXY) {
  process.env.HTTPS_PROXY = `http://${treffer[1].trim()}`;
  console.log(`[proxy] Systemproxy übernommen: ${process.env.HTTPS_PROXY}`);
}
```

Im Backend einmalig beim Start:

```ts
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';
setGlobalDispatcher(new EnvHttpProxyAgent());   // liest HTTPS_PROXY/HTTP_PROXY/NO_PROXY
```

`undici` als Abhängigkeit aufnehmen — Node bringt es mit, exportiert es aber
nicht. **Diese Änderung braucht einen Test auf einem Rechner hinter einem
echten Proxy; auf einem freien Netz beweist ein grüner Lauf nichts.**

---

## Was das für Horst geändert hätte

Statt eines roten Punktes und eines Telefonats: ein Klick auf „Selbsttest",
eine Zeile im Klartext, und ein Textblock zum Weiterschicken.

## Verifikation vor dem Release

- `tsc --noEmit` über shared, backend, frontend
- Backend-Tests; neuer Test für `klassifiziereHttp()` mit 401/403/429/529/400-credit/404
- Selbsttest gegen drei Zustände live: gültiger Schlüssel, absichtlich falscher
  Schlüssel, gekapptes Netz (Hosts-Eintrag auf api.anthropic.com)
- Versionsnummer an allen vier Stellen (drei package.json, `APP_VERSION`) —
  `versionKonsistenz.test.ts` hält sie zusammen
- What's-New-Eintrag in der Guidance-Registry
