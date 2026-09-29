# 1.2.1 — KI-Diagnose

Umgesetzt und verifiziert. Der Code liegt hier, weil dieses Repo die
Release-Seite ist; der Quellstand gehört nach `ProjectOS-src`.

## Was drin ist

| Datei | Inhalt |
|---|---|
| `ki-diagnose.patch` | Der vollständige Diff, `git apply`-fähig |
| `neu/…` | Die vier neuen Dateien einzeln, zum Kopieren |
| `SPEZIFIKATION.md` | Begründung und Entwurf, gegen den 1.2.0-Build geschrieben |

## Der Befund dahinter

Ein Diff der ausgelieferten Builds 1.1.1 → 1.2.0 zeigt: `services/ai/*`,
`routes/settings.js` und der gesamte `electron/`-Ordner sind byte-identisch.
1.2.0 hat am KI-Pfad nichts verändert. Was fehlte, war keine Verbindung,
sondern eine Aussage — die App kannte den Grund und behielt ihn für sich.

## Die vier Bausteine

**1 · Fehlerklassen** (`services/ai/aiFehler.ts`, neu)
`401`, `400`-ohne-Guthaben, `429` und `529` fielen gemeinsam in `http_error`
und erreichten den Nutzer als „KI nicht erreichbar". Neu: `auth`,
`kein_guthaben`, `rate_limit`, `ueberlastet` — entschieden von einem
Klassifizierer für alle drei Anbieter statt von drei halben Regeln.
`describeAiError()` nennt pro Klasse Ursache **und** nächsten Schritt.

**2 · Ausgang im Prüfpfad** (`services/ai/index.ts`)
`logExternalCall` schrieb bisher nur vor dem Aufruf. Jetzt steht auch der
Fehlschlag in `audit_log` — Klasse, Status, Antwort des Anbieters. Nie der
Schlüssel, nie der Prompt. Einstellungen → Datenschutz zeigt die Tabelle
bereits an, ein neuer Bildschirm war dafür nicht nötig.

**3 · Selbsttest** (`services/ai/selbsttest.ts` + `GET /api/settings/ai/selbsttest`
+ `components/settings/KiSelbsttest.tsx`, alles neu)
Sechs Stufen vom Billigen zum Teuren, Darstellung wie die Einzelprüfungen aus
`restoreIntegritaet`. Angelpunkt ist Stufe 4: Sie fragt die Modell-Liste des
Anbieters ab — das kostet keinen Token, antwortet bei falschem Schlüssel mit
401 und wirft bei fehlender Verbindung. Ein Klick trennt damit die beiden
Fälle, die am Telefon nie auseinanderzuhalten waren: Netz oder Konto.
Dazu ein Knopf „Diagnose kopieren" für einen Textblock zum Verschicken.

**4 · Banner und Ampel** (`App.tsx`, `TopBar.tsx`, `i18n/messages.ts`)
Überschrift je Fehlerklasse statt einer Sammelmeldung, Rohtext hinter
„Details", Ursache im Tooltip der Ampel. Neue Schlüssel in DE/EN/ES;
FR fällt wie bisher auf DE zurück.

Nicht enthalten, weil nicht freigegeben: Wiederholung bei 429/529 und
Proxy-Unterstützung (Baustein 5 der Spezifikation). Beides behebt etwas,
statt es zu beschreiben — und der Proxy-Teil braucht einen Test hinter einem
echten Proxy.

## Verifikation

Gegen `ProjectOS-src@13299d9` gebaut und geprüft:

- `tsc --noEmit` sauber für shared, backend und frontend
- **293/293 Backend-Tests grün** (284 bestehende + 9 neue in `aiFehler.test.ts`)
- Backend live gestartet, alle vier Zweige des Selbsttests gegen die echte
  Anthropic-API durchgespielt:

| Fall | Stufe | Ergebnis |
|---|---|---|
| Werkszustand, kein Provider | 1 | „Kein Provider ausgewählt", Stufen 2–6 nicht geprüft |
| Schlüssel abgelehnt | 4 | `HTTP 401 … "API key is invalid."` → „Das Netz ist in Ordnung — der Schlüssel nicht." |
| Endpunkt nicht auflösbar | 4 | `fetch failed` → Proxy/Firewall als wahrscheinlichste Ursache |
| „Nur lokale KI" aktiv | 3 | „…wird deshalb gar nicht erst angefragt" |

`/api/settings/ai/health` meldet danach `"error": "auth"`, und im Prüfpfad
steht `ai.call.fehler · auth · HTTP 401 · …`. Der Schlüssel erscheint nirgends
— im Bericht steht `sk-ant-… (44 Zeichen)`.

## Anwenden

Der Diff ist gegen `ProjectOS-src@13299d9` (31.07., Opero 3.0.2) gebaut, weil
der 1.2.x-Quellstand nicht vorlag. Der weitaus grösste Teil ist neuer Code und
läuft unverändert durch:

- **Unverändert übernehmbar:** die vier Dateien unter `neu/`
- **Additiv, konfliktarm:** die Blöcke in `i18n/messages.ts`, die Route in
  `routes/settings.ts`, die drei Anbieter-Zweige in `services/ai/index.ts`

Zwei Stellen brauchen beim Portieren einen Blick, weil 1.1/1.2 sie umgebaut
haben:

1. **`pages/Settings.tsx`** — hier hängt `<KiSelbsttest />` an `tab === 'ki'`.
   In 1.2.x heisst das Geltungsbereich „Anwendung"; die Komponente gehört
   direkt unter den Verbindungstest (der Test sagt *ob*, der Selbsttest
   sagt *woran*).
2. **`services/ai/index.ts`** — 1.2.x hat dort `mitIdentitaet()`,
   `schaeleJson()` und geänderte `maxTokens`/`temperature`. Die Hunks dieses
   Patches liegen daneben, nicht darin; bei einem Konflikt gilt der 1.2.x-Stand,
   übernommen werden nur die `klassifiziereHttp`- und
   `protokolliereFehler`-Zeilen.

Vor dem Release noch offen: Versionsnummer an allen vier Stellen (drei
`package.json`, `APP_VERSION` — `versionKonsistenz.test.ts` hält sie zusammen)
und ein What's-New-Eintrag in der Guidance-Registry.
