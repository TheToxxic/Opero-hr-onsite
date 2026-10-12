# Plan: Opero hr-onsite im Browser betreiben

Stand 12.10.2026 · geprüft gegen `ProjectOS-src@13299d9` (Opero 3.0.x)

**Ziel:** Opero hr-onsite läuft online und wird nur über den Webbrowser auf dem
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

Hinweis: Ein Repo „hr-onsite Cockpit“ gibt es in dieser Session nicht. Ich gehe
davon aus, dass das Cockpit als Web-App mit Supabase läuft. Falls es anders
aufgebaut ist, gilt Variante B entsprechend.

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

## 6. Umsetzungsplan (Variante B, mit A als Kern)

| Phase | Inhalt | Aufwand | Ergebnis |
|---|---|---|---|
| **0 · Klären** | Punkte aus Abschnitt 5; Erreichbarkeitstest vom Firmenrechner | ½ Tag + Wartezeit | Go/No-Go |
| *0b · Übergang (optional)* | Variante D: Tunnel auf den bestehenden Rechner | 1 Tag | sofort arbeitsfähig |
| **1 · Web-Build** | `platform/web/` neben `platform/win/` anlegen (Regel aus `DEVELOPMENT.md`: keine Fachlogik dort): Dockerfile (Node 22, `better-sqlite3`), Express liefert das gebaute Frontend aus (der Windows-Patch „Static-Serving“ hat das schon gelöst), `OPERO_DATA_DIR=/data`. Lokale Provider (macOS-Kalender, Outlook-COM, ActivityWatch, Ordner-Watcher) per Umgebungsvariable `OPERO_RUNTIME=web` ausblenden | 1–2 Tage | Container läuft lokal |
| **2 · Anmeldung** | Supabase-Projekt (EU), Auth mit MFA; Express-Middleware prüft JWT vor `/api/*`; Login-Seite im Frontend; CORS auf die eigene Domain | 1–2 Tage | Nur Angemeldete kommen rein |
| **3 · Hosting** | Fly.io (fra) oder Hetzner + Caddy; Volume für `/data`; eigene Domain + TLS; nächtliches Backup der SQLite-Datei nach Supabase Storage; Secrets (`ANTHROPIC_API_KEY`, M365) als Umgebungsvariablen | 1 Tag | Online erreichbar |
| **4 · Claude-Connector** | MCP-HTTP-Server im selben Container unter `/mcp`; OAuth über Supabase Auth; in claude.ai als Custom Connector eintragen; Persona aus `OPERO_PROJEKTAGENT.md` in ein claude.ai-Projekt übernehmen | 2–3 Tage | Projektagent im Browser |
| **5 · Daten umziehen** | Bestehende `project-os.db` über die vorhandene Restore-Funktion (`pending-restore.db`) einspielen | ½ Tag | Altbestand online |
| *6 · später* | Schreibende MCP-Werkzeuge über die Backend-API; Upload-Ersatz für den Ordner-Watcher (OneDrive/Graph) | je 2–3 Tage | |
| *7 · nur bei Bedarf* | Variante C (Postgres), **nur** wenn Chris und Horst wirklich eine gemeinsame Datenbasis brauchen | 4–8 Wochen | |

**Gesamt bis Phase 5: ca. 7–10 Arbeitstage.**

---

## 7. Empfehlung

1. **Zuerst Phase 0.** Ohne Freigabe für Kundendaten in einer eigenen Cloud
   bringt keine Variante etwas, und genau daran scheitert so etwas meistens.
2. **Dann Variante B:** bestehende App im Container mit SQLite, Supabase nur für
   Login und Backups. Das geht schnell, die Fachlogik bleibt unberührt, und die
   Windows-Version läuft mit demselben Code weiter.
3. **Claude zweigleisig:** API-Key im Backend (sofort) plus Remote-MCP-Connector
   in claude.ai (Phase 4). Das ist der Schritt, der wirklich etwas bringt, weil
   der Projektagent danach ohne Claude Desktop auskommt.
4. **Nicht nach Supabase-Postgres migrieren, nur weil das Cockpit dort liegt.**
   937 Raw-SQL-Stellen umzubauen lohnt sich erst, wenn mehrere Personen
   gemeinsam auf einer Datenbasis arbeiten müssen.

### Offene Fragen an dich

- Läuft das hr-onsite Cockpit auf Supabase, und soll dieselbe Anmeldung gelten?
- Nur du, oder auch Horst? Getrennte Daten oder eine gemeinsame Datenbasis?
- Privates claude.ai-Konto (Pro/Max) oder Team/Enterprise?
- Eigene Domain vorhanden (z. B. `opero.hr-onsite.de`)?
