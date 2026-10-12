# Plan: Opero hr-onsite im Browser betreiben

Stand 12.10.2026 · geprüft gegen `ProjectOS-src@13299d9` (Opero 3.0.x)

**Ziel:** Opero hr-onsite läuft online, **je eine eigene Instanz für Chris und Horst**, und wird nur über den Webbrowser auf dem
Firmenrechner des Kunden genutzt, ohne Installation und ohne zweiten Rechner.
Die Anbindung an Claude ist Pflicht.

---

## 1. Was der Code heute vorgibt

Die Ausgangslage ist besser als erwartet: **Opero ist schon eine Web-App.**
Electron ist nur eine Hülle um zwei Teile:

| Teil | Technik | Online-tauglich? |
|---|---|---|
| Frontend | React + Vite (Port 5173), läuft schon heute im Browser | ✅ ohne Umbau |
| Backend | Express (Port 3001) | ✅ läuft auf jedem Node-22-Server |
| Datenbank | SQLite über `better-sqlite3`, eine Datei in `OPERO_DATA_DIR` | ⚠️ siehe unten |
| MCP-Server | `apps/mcp-server`, **schon mit HTTP-Modus** (`http.ts`, Streamable HTTP, Bearer-Key) | ✅ Basis für Claude ist da |
| KI im Backend | Anthropic, Perplexity, Ollama über API-Key | ✅ läuft serverseitig |
| Anmeldung | **keine.** Das Backend vertraut jedem, der es erreicht | ❌ muss vor dem Go-live dazu |

**Die wichtigste Zahl für die Supabase-Frage:** Im Backend stehen **937 direkte
SQLite-Aufrufe (`sqlite.prepare/exec/transaction`) in 77 Dateien**, alle
synchron. Postgres (also Supabase) arbeitet asynchron. Ein Umstieg ist deshalb
keine Konfigurationsfrage. Jede Abfrage muss umgeschrieben und auf `await`
umgestellt werden, durch alle Services und Routen hindurch.

Hinweis: Den Supabase-Stand des hr-onsite Cockpits finde ich weder in den
Repos noch in den Claude-Code-Sessions dieses Kontos. Die einzige Cockpit-Session
(„HR-Onsite Cockpit Internetanbindung Plan“, 03.08.2026) plant Opero hr-onsite
selbst, und zwar über Cloudflare Tunnel und einen Hetzner-Server, nicht über
Supabase. Ihre Befunde sind in Abschnitt 6 übernommen.

---

## 2. Die Varianten

### A · Bestehende App unverändert in einen Container, SQLite bleibt *(Empfehlung)*

Backend und gebautes Frontend kommen in einen Docker-Container, die SQLite-Datei
auf ein dauerhaftes Volume. Davor kommt eine Anmeldung (Supabase Auth oder
Cloudflare Access). Hosting in der EU, z. B. Hetzner (Falkenstein), Fly.io
(Frankfurt) oder Railway (EU).

| Pro | Contra |
|---|---|
| Kaum Code-Änderung, die Fachlogik bleibt unberührt | Ein Server, eine Datei: Backups musst du selbst einrichten (der Backup-Service ist schon da und braucht nur ein Ziel) |
| In **3–5 Tagen** live | Nicht für viele gleichzeitige Nutzer gedacht (für 1–3 Personen kein Problem) |
| Gleicher Code wie die Windows-Version, ein Codestand | Server-Pflege (Updates, TLS) liegt bei dir, außer du nimmst Fly/Railway |
| MCP-Server und App lesen dieselbe Datei | |
| Kosten ca. 5–15 €/Monat | |

### B · Wie A, dazu Supabase für Anmeldung und Dateien (Hybrid)

SQLite bleibt die Fachdatenbank. Supabase übernimmt **Auth** (Login,
Magic-Link/MFA, Benutzer Chris/Horst) und **Storage** (Uploads, Backups).
Eine Express-Middleware prüft das Supabase-JWT.

| Pro | Contra |
|---|---|
| Gleiche Anmeldung wie im Cockpit, falls das auf Supabase läuft | Zwei Dienste statt einem |
| Login und MFA fertig, ohne eigenen Code | Supabase-Auth ersetzt **keine** Mandantentrennung in der App: alle Angemeldeten sehen alle Daten |
| Supabase kann später OAuth für den MCP-Connector liefern (siehe 4.) | ca. 1–2 Tage mehr als A |

### C · Komplett auf Supabase (Postgres)

Das Drizzle-Schema (22 Tabellen) und alle 937 Raw-SQL-Stellen werden auf
Postgres umgestellt, dazu Row-Level-Security pro Nutzer.

| Pro | Contra |
|---|---|
| Echte Mehrbenutzerfähigkeit, Chris und Horst auf einer Datenbasis | **4–8 Wochen** Umbau, hohes Regressionsrisiko (293 Backend-Tests laufen gegen SQLite) |
| Backups, Point-in-Time-Recovery und Skalierung macht Supabase | Windows-Version und Web-Version laufen auseinander, oder die Windows-Version braucht künftig auch Postgres |
| Supabase-MCP-Server direkt nutzbar | SQLite-Eigenheiten (FTS, `json_extract`, Pragmas) müssen ersetzt werden |
| | Der Supabase-MCP-Server geht direkt an die Datenbank, an der Fachlogik vorbei |

### D · Bestehende Installation per Tunnel freigeben

Opero läuft auf dem eigenen Rechner (Mac/PC) weiter und wird über einen
Cloudflare Tunnel mit Cloudflare Access unter einer HTTPS-Adresse erreichbar.

| Pro | Contra |
|---|---|
| **1 Tag**, null Code | Der Heimrechner muss **dauerhaft laufen**, sonst ist alles weg |
| Lokale Funktionen (Kalender, Ordner-Watcher) bleiben | Strom, Updates und Neustarts zu Hause werden zum Ausfallrisiko |
| Gut als **Übergang diese Woche** | Eigentlich genau das Zwei-Rechner-Setup, das du vermeiden willst |

---

## 3. Was online funktioniert und was nicht

| Funktion | Online | Anmerkung |
|---|---|---|
| Aufgaben, Board, Gantt, Dashboard, Reporting, Journal | ✅ | reine Web-Logik |
| Import per Upload (xlsx, pdf, docx, eml, Transkripte) | ✅ | `multer`-Upload läuft im Browser |
| OCR (`tesseract.js`) | ✅ | läuft auf dem Server, braucht etwas RAM |
| Microsoft 365 (Mail, Kalender, To Do via Graph) | ✅ | Redirect-URI in der Azure-App auf die neue Domain umstellen. **Achtung:** Das ist das eigene M365, nicht das des Kunden |
| IMAP-Mail-Sync | ✅ | sofern der Server das Postfach erreicht |
| KI im Backend (Anthropic-Key) | ✅ **besser als heute** | Der Server ruft die API auf. Der Firmen-Proxy, an dem 1.2.x scheiterte, ist nicht mehr dazwischen |
| Ordner-Watcher / Auto-Import | ❌ | Kein lokaler Ordner. Ersatz: Upload, später OneDrive über Graph |
| macOS-Kalender, Fantastical, Outlook-COM-Erinnerungen | ❌ | hängen an lokalen Programmen. Ersatz: M365-Kalender oder ICS-Abo |
| ActivityWatch-Zeiterfassung | ❌ | liest `localhost:5600` auf dem eigenen Rechner |
| Plaud-Transkripte | ⚠️ | als Upload ja, automatische Übernahme nein |
| Mehrere Nutzer mit getrennten Daten | ❌ in A/B, ✅ in C | Variante A/B: eine Instanz pro Person |

---

## 4. Anbindung an Claude (Pflicht)

Es gibt drei Wege, und sie schließen sich nicht gegenseitig aus:

| Weg | Was | Status |
|---|---|---|
| **1. KI in der App** | Die App ruft Claude serverseitig mit API-Key auf: Banner, Briefing, Buddy, Extraktion | ✅ funktioniert sofort, Schlüssel als Umgebungsvariable statt in der Oberfläche |
| **2. claude.ai im Browser + Connector** | Opero-MCP-Server unter `https://…/mcp` als *Custom Connector* in claude.ai. Claude erreicht ihn von Anthropic-Servern aus, **der Firmenrechner braucht nur claude.ai** | ⚠️ braucht Umbau, siehe unten |
| 3. Claude Desktop | wie heute in `OPERO_PROJEKTAGENT.md` | ❌ auf Firmen-IT meist nicht installierbar |

**Weg 2 ist der Kern.** Damit fällt die Grenze aus `OPERO_PROJEKTAGENT.md`,
Abschnitt 6, weg: „claude.ai im Browser erreicht lokale MCP-Server nicht“. Der
Projektagent funktioniert dann im Browser mit Werkzeugen. Dafür fehlt noch:

1. **OAuth statt statischem Bearer-Key.** `http.ts` prüft heute einen festen
   Schlüssel (`PROJECTOS_MCP_API_KEY`). Custom Connectors in claude.ai erwarten
   OAuth oder gar keine Authentifizierung, ein fester Header lässt sich dort
   nicht eintragen. *Vor dem Bau gegen die aktuelle claude.ai-Doku prüfen.*
   Lösung: OAuth 2.1 mit Dynamic Client Registration vor den MCP-Endpunkt
   setzen, z. B. Supabase Auth als OAuth-Server (passt zu Variante B) oder
   Cloudflare Access für MCP. Ohne Auth freigeben scheidet bei HR-Daten aus.
2. **Gleiche Datenbank.** Der MCP-Server öffnet die SQLite-Datei `readonly`. Im
   Container zeigt `PROJECTOS_DB_PATH` auf dasselbe Volume. Das passt, weil SQLite im
   WAL-Modus läuft.
3. **Nur Lesen.** Die 8 Werkzeuge (`get_project_context`, `list_open_tasks`,
   `search_tasks` …) lesen nur. Schreibende Werkzeuge, etwa „Aufgabe anlegen“
   oder „Entscheidung erfassen“, kommen als eigene Phase und gehen über die
   Backend-API, nicht direkt in die Datenbank, damit Prüfpfad und Review-Inbox
   greifen.
4. **Kontoart klären.** Bei einem Team- oder Enterprise-Konto muss ein Admin den
   Connector freigeben. Beim privaten Pro/Max-Konto trägst du ihn selbst ein.

---

## 5. Was vor der Technik geklärt sein muss

Das sind die eigentlichen Ausschlusskriterien. Technisch lösbar ist jede
Variante, aber nicht jede ist erlaubt.

1. **Darf Kundeninhalt in eine eigene Cloud?** Mit Opero landen Projekt- und
   möglicherweise Personaldaten des Kunden auf deinem Server. Das braucht in der
   Regel eine Freigabe des Kunden oder einen AV-Vertrag, und es muss mit dessen
   IT-Richtlinie vereinbar sein. Hosting in der EU (Frankfurt/Falkenstein) und
   der AVV mit dem Hoster (Hetzner, Supabase, Fly) sind Pflicht, reichen aber
   allein nicht.
2. **Darf claude.ai auf dem Firmenrechner genutzt werden?** Manche Firmen
   sperren KI-Dienste per Proxy oder untersagen sie. Wenn claude.ai blockiert
   ist, bleibt nur Weg 1 (KI in der App), und das ist dann eine Policy-Frage,
   keine Technikfrage.
3. **Kommt der Firmenrechner an die Adresse?** Vom Firmenrechner aus prüfen:
   `claude.ai`, die geplante Domain (eigene Domain ist besser als `*.fly.dev`
   oder `*.supabase.co`, die manche Filter als „unkategorisiert“ blocken) und
   ob Streaming/SSE durch den Proxy kommt.
4. **Personaldaten-Faustregel aus `OPERO_PROJEKTAGENT.md` bleibt:** Besonders
   sensible Personaldaten gehören nicht in Prompts.

---

## 6. Entscheidungen (Stand 12.10.2026)

| Frage | Antwort | Folge |
|---|---|---|
| Wer nutzt es? | Chris und Horst | zwei Instanzen |
| Gemeinsame Datenbasis? | **Nein, ausdrücklich getrennt** | Variante C (Postgres, Mehrbenutzer) entfällt |
| Claude-Konten | je ein privates Pro-Konto, je eigener API-Key | ein Connector und ein Key **pro Instanz** |
| Cockpit | läuft auf Supabase | Opero muss nicht dorthin, siehe 6.2 |

### 6.1 Zielbild: ein Server, zwei getrennte Instanzen

```
Hetzner-Server (DE)
├── opero-chris → /srv/opero/chris  (eigene DB, Dokumente, API-Key)  → https://chris.<domain>
└── opero-horst → /srv/opero/horst  (eigene DB, Dokumente, API-Key)  → https://horst.<domain>
       ↑ Cloudflare Tunnel (keine offenen Ports) + Cloudflare Access (Login je Person)
```

Die Trennung kommt über getrennte Prozesse/Container, Datenverzeichnisse,
Adressen und Zugangsregeln, nicht über Rechte im Code. Das passt zur App:
Sie ist für genau einen Nutzer gebaut.

Laufende Kosten für beide zusammen: Server ca. 10–16 €, Backup ca. 4 €,
Cloudflare Tunnel und Access 0 €, Domain ca. 1 €, **zusammen ca. 15–21 €/Monat**.
Dazu kommen die API-Kosten bei Anthropic wie bisher.

### 6.2 Warum nicht Supabase und was mit der Domain ist

- **Supabase kann Opero nicht betreiben.** Supabase stellt Postgres, Auth,
  Storage und Edge Functions bereit (Deno, kurzlebig, ohne dauerhaftes
  Dateisystem). Opero braucht einen dauerhaft laufenden Node-Prozess mit
  SQLite-Datei, Mail-Sync, Kalender-Sync und OCR. Das läuft dort nicht.
- **Eine Domain bekommt man bei Supabase nicht.** Supabase verkauft keine
  Domains. Eine eigene Domain lässt sich dort nur mit einem kostenpflichtigen
  Add-on auf die eigene API/Auth legen, und das setzt einen bezahlten Plan
  voraus. Für Opero hilft das nicht.
- **So geht es:** Domain beim Registrar (oder vorhandene Firmendomain), die
  Subdomains `chris.` und `horst.` auf Cloudflare zeigen lassen. Läuft die
  Domain schon über Cloudflare oder ist sie dahin umziehbar, ist das in
  einer Stunde erledigt. Die Nameserver-Umstellung kann bis 24 h dauern und
  ist damit der längste Vorlauf.
- **Wenn ein Login wie im Cockpit gewünscht ist:** Supabase Auth ließe sich
  vor Opero setzen (Variante B oben). Bei zwei Einzelinstanzen ist
  Cloudflare Access aber einfacher, weil kein Code nötig ist.

### 6.3 Claude-Anbindung pro Person

| | Chris | Horst |
|---|---|---|
| KI in der App | eigener `ANTHROPIC_API_KEY` in der Instanz | eigener Key |
| claude.ai (Pro) Custom Connector | `https://chris.<domain>/mcp` | `https://horst.<domain>/mcp` |
| Projektagent-Persona | eigenes claude.ai-Projekt | eigenes claude.ai-Projekt |

Wichtig für den Connector: Die Anfragen kommen von Anthropics Servern, nicht
aus dem Browser. Die E-Mail-Code-Anmeldung von Cloudflare Access können die
nicht bestehen. `/mcp` wird deshalb aus Access ausgenommen und bekommt eine
eigene OAuth-Prüfung im MCP-Server (siehe Abschnitt 4). Ohne Schutz bleibt
der Endpunkt nie offen.

### 6.4 Befunde aus dem Code, die vor dem Go-live behoben sein müssen

Im aktuellen Quellstand gegengeprüft (`ProjectOS-src@13299d9`):

| Befund | Fundstelle | Warum kritisch |
|---|---|---|
| **Dokumentenpfad hängt an `__dirname`, nicht an `OPERO_DATA_DIR`** | `services/storageSettings.ts:15-16` | Zwei Instanzen auf einem Server würden **denselben Dokumentenordner** teilen: Chris' Dateien landen bei Horst, ohne dass die Oberfläche es zeigt. Muss vor der Migration behoben sein |
| Keine Authentifizierung im Backend | alle `routes/` | Access ist die erste Schicht, das Backend braucht eine zweite (Access-JWT prüfen) |
| MS365-Redirect fest auf `localhost:3001` | `ms365/auth.ts:32,39`, `Settings.tsx:2148` | Anmeldung bricht online mit `AADSTS50011` ab |
| ICS-Export mit `localhost:3001` als Fallback | `useFollowUps.ts:87` | liefert online eine leere Datei |
| Static-Serving nur im Windows-Patch | `platform/win/scripts/patch-for-windows.js` | muss in `app.ts`, sonst läuft das Frontend nicht ohne Vite |
| Cloudflare bricht nach 100 s ab, KI-Timeouts liegen bei 90–120 s | `services/ai/index.ts` | auf 85 s kappen oder lange Aufrufe im Hintergrund laufen lassen |
| Cloudflare-Upload-Grenze 100 MB | `bulkIntake.ts` | Bulk-Upload im Browser stückeln |
| `pdftoppm` (poppler-utils) fehlt auf einem nackten Server | `intake/pdfOcr.ts` | PDF-OCR bricht still ab, deshalb ins Image aufnehmen |
| MS-To-Do-Erinnerungen nur unter `win32` | `reminders/index.ts` | auf Linux tot, obwohl Graph überall geht (3-Zeilen-Fix) |

## 7. Umsetzungsplan

| Phase | Inhalt | Aufwand |
|---|---|---|
| **0 · Klären** | Freigabe des Kunden für Daten in eigener Cloud (AVV mit Hetzner und Cloudflare; bei BEM-/Betriebsratsfällen Art. 9 DSGVO); ist claude.ai am Firmenrechner erlaubt und erreichbar; Domain festlegen | ½ Tag + Wartezeit |
| **1 · Code-Fixes** | die Befunde aus 6.4 in `ProjectOS-src` (zuerst `storageSettings`, mit Test) | 1–2 Tage |
| **2 · Web-Build** | `platform/web/`: Dockerfile (Node 22, poppler, tesseract), `OPERO_RUNTIME=web` blendet lokale Provider aus | 1 Tag |
| **3 · Server** | Hetzner (DE), zwei Container mit je eigenem Volume und eigenen Secrets, nächtliches Backup außer Haus | 1 Tag |
| **4 · Zugang** | Cloudflare Tunnel und Access je Subdomain, **erst Access-Regel, dann Tunnel dauerhaft** (sonst steht die App kurz offen im Netz); Zugriffsprotokoll an | ½ Tag |
| **5 · Claude** | MCP-Server je Instanz unter `/mcp` mit OAuth; Connector in beiden Pro-Konten eintragen; Persona aus `OPERO_PROJEKTAGENT.md` als claude.ai-Projekt | 2–3 Tage |
| **6 · Migration** | je Person: WAL-Checkpoint, DB und Dokumente hochladen, Stichtag, Abnahme vom Firmenrechner aus | ½ Tag je Person |

**Gesamt: ca. 7–9 Arbeitstage**, danach ca. 15–21 €/Monat.

## 8. Was dabei wegfällt

| Funktion | Betrifft | Ersatz |
|---|---|---|
| macOS-Kalender (Fantastical/EventKit) | nur Chris | MS365-Kalender oder ICS-Abo |
| Erinnerungen.app | nur Chris | MS To Do über Graph (nach Fix) |
| ActivityWatch-Zeiterfassung | beide | keiner; bleibt lokal oder entfällt |
| Ordner-Watcher (Plaud) | beide | Upload im Browser oder OneDrive über rclone/Graph |

## 9. Noch offen

- Wo liegt der Supabase-Stand des Cockpits (Repo oder Projekt-URL)? Nur nötig,
  wenn Opero dieselbe Anmeldung bekommen soll.
- Welche Domain? Liegt `hr-onsite.de` (o. ä.) schon bei Cloudflare?
- Dürft ihr Kundendaten auf einem eigenen Server halten, und ist claude.ai am
  Firmenrechner freigegeben?
