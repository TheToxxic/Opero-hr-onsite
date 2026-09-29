/**
 * KI-Selbsttest — sechs Stufen, die den Ausfall benennen statt ihn zu melden.
 *
 * Auslöser: Ein Nutzer meldete „die KI ist nicht erreichbar, obwohl ich nichts
 * verändert habe". Die App wusste zu diesem Zeitpunkt genau, woran es lag —
 * `/ai/health` hält `error` und `detail` vor —, zeigte aber nur „KI nicht
 * erreichbar". Ein abgelehnter Schlüssel, ein leeres Guthaben, ein Rate-Limit
 * und ein Unternehmensproxy sahen identisch aus, und die Klärung dauerte
 * länger als die Ursache.
 *
 * Aufbau bewusst wie `db/restoreIntegritaet.ts`: eine Liste von Einzelprüfungen
 * mit Name, Ergebnis, Detail und nächstem Schritt. Das Muster kennen die Nutzer
 * aus der Wiederherstellung, und es hat dieselbe Eigenschaft — es sagt nicht
 * „fehlgeschlagen", es sagt, WO.
 *
 * Reihenfolge ist der eigentliche Wert: Die Stufen laufen vom Billigen zum
 * Teuren und brechen ab, sobald eine trägt. Stufe 4 ist der Angelpunkt — sie
 * fragt die Modell-Liste des Anbieters ab. Die kostet keinen Token, antwortet
 * bei falschem Schlüssel mit 401 und wirft bei fehlender Verbindung. Damit
 * trennt ein Klick die beiden Fälle, die am Telefon nie auseinanderzuhalten
 * waren: liegt es am Netz oder am Konto.
 */

import { sqlite } from '../../db/index.js';
import { APP_VERSION, type AiSettings } from '@project-os/shared';
import { getAiSettings, aiCallChat, isCloudProviderBlocked } from './index.js';
import { describeAiError } from './aiFehler.js';

export interface SelbsttestStufe {
  nr: number;
  name: string;
  /** true = bestanden, false = hier liegt es, null = nicht geprüft (Abbruch davor). */
  ok: boolean | null;
  detail: string;
  naechsterSchritt?: string;
}

export interface SelbsttestBefund {
  ok: boolean;
  stufen: SelbsttestStufe[];
  /** Klartextblock zum Kopieren und Verschicken. Enthält kein Geheimnis. */
  bericht: string;
  geprueftAm: string;
}

const stripSlash = (u: string) => u.replace(/\/$/, '');

/** Zeitlimit der Vorprüfungen. Kurz: hier soll nichts hängen, hier soll etwas aussagen. */
const VORPRUEFUNG_TIMEOUT_MS = 10_000;

/**
 * Der hinterlegte Schlüssel, so wie ihn `callAnthropic()` auflöst — erst die
 * anbieterspezifische Ablage, dann das alte gemeinsame Feld. Wer nur eins von
 * beiden prüft, meldet „kein Schlüssel", während der Aufruf gleich darauf
 * funktioniert.
 */
function schluesselVon(s: AiSettings): string | undefined {
  if (s.provider === 'anthropic') return s.anthropic?.apiKey || s.apiKey;
  if (s.provider === 'perplexity') return s.perplexity?.apiKey || s.apiKey;
  return s.apiKey;
}

function modellVon(s: AiSettings): string {
  if (s.provider === 'anthropic') return s.anthropic?.model || s.model;
  if (s.provider === 'perplexity') return s.perplexity?.model || s.model;
  return s.model;
}

/**
 * Ein Schlüssel darf im Bericht vorkommen, ein Geheimnis nicht. Präfix und
 * Länge reichen, um „falsch eingefügt" von „gar nicht da" zu unterscheiden;
 * mehr steht hier bewusst nie.
 */
function schluesselUmriss(key: string): string {
  const praefix = key.slice(0, 7);
  return `${praefix}… (${key.length} Zeichen)`;
}

/** Modell-Liste beim Anbieter abfragen — ohne Token zu verbrauchen. */
async function holeModellListe(
  s: AiSettings,
  key: string | undefined,
): Promise<{ ok: boolean; detail: string; modelle?: string[]; naechsterSchritt?: string }> {
  try {
    if (s.provider === 'anthropic') {
      const base = stripSlash(s.anthropic?.baseUrl || 'https://api.anthropic.com');
      const res = await fetch(`${base}/v1/models`, {
        headers: { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(VORPRUEFUNG_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 200);
        return {
          ok: false,
          detail: `HTTP ${res.status}: ${text}`.trim(),
          naechsterSchritt: res.status === 401 || res.status === 403
            ? 'Das Netz ist in Ordnung — der Schlüssel nicht. Einstellungen → KI → Schlüssel neu eintragen.'
            : 'Verbindung steht, der Anbieter lehnt ab. Meldung oben weitergeben.',
        };
      }
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const modelle = (data.data ?? []).map(m => m.id).filter((x): x is string => !!x);
      return { ok: true, detail: `Erreichbar, Schlüssel akzeptiert · ${modelle.length} Modelle verfügbar`, modelle };
    }

    if (s.provider === 'ollama') {
      const base = stripSlash(s.baseUrl);
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(VORPRUEFUNG_TIMEOUT_MS) });
      if (!res.ok) {
        return {
          ok: false,
          detail: `Endpunkt erreichbar, aber /api/tags → HTTP ${res.status}`,
          naechsterSchritt: 'Läuft Ollama? In der Eingabeaufforderung: ollama list',
        };
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const modelle = (data.models ?? []).map(m => m.name).filter((x): x is string => !!x);
      return { ok: true, detail: `Ollama erreichbar · ${modelle.length} Modelle installiert`, modelle };
    }

    return { ok: true, detail: 'Für diesen Anbieter gibt es keine kostenlose Modell-Liste — Stufe 6 prüft direkt.' };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const meldung = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      detail: timeout ? `Zeitüberschreitung nach ${VORPRUEFUNG_TIMEOUT_MS / 1000}s` : meldung,
      naechsterSchritt: describeAiError(timeout ? 'timeout' : 'network'),
    };
  }
}

/**
 * Passt das konfigurierte Modell auf einen Eintrag der Liste?
 *
 * Beidseitiges `startsWith`, weil beide Schreibweisen im Umlauf sind: die
 * Einstellungen tragen mal die datierte Fassung („…-20251001"), mal die kurze.
 * Ein strikter Vergleich meldete sonst ein fehlendes Modell, das es gibt.
 */
function modellPasst(konfiguriert: string, verfuegbar: string[]): boolean {
  return verfuegbar.some(m => m === konfiguriert || m.startsWith(konfiguriert) || konfiguriert.startsWith(m));
}

export async function fuehreSelbsttestAus(): Promise<SelbsttestBefund> {
  const s = getAiSettings();
  const stufen: SelbsttestStufe[] = [];
  const nichtGeprueft = (nr: number, name: string): SelbsttestStufe =>
    ({ nr, name, ok: null, detail: 'nicht geprüft — eine frühere Stufe hat abgebrochen' });

  // ── 1. Provider gewählt und eingeschaltet ──────────────────────────────────
  const providerOk = s.provider !== 'none' && s.enabled;
  stufen.push({
    nr: 1,
    name: 'Provider gewählt',
    ok: providerOk,
    detail: s.provider === 'none'
      ? 'Kein Provider ausgewählt'
      : `${s.provider}${s.enabled ? '' : ' — aber KI ist ausgeschaltet'}`,
    naechsterSchritt: providerOk ? undefined : 'Einstellungen → KI: Provider wählen und den Schalter aktivieren.',
  });
  if (!providerOk) {
    for (const [nr, name] of [[2, 'Schlüssel hinterlegt'], [3, 'Nur lokale KI'], [4, 'Netz, TLS und Konto'], [5, 'Modell verfügbar'], [6, 'Echter Aufruf']] as const) {
      stufen.push(nichtGeprueft(nr, name));
    }
    return baueBefund(stufen, s);
  }

  // ── 2. Schlüssel hinterlegt ────────────────────────────────────────────────
  const key = schluesselVon(s);
  const brauchtSchluessel = s.provider !== 'ollama';
  const keyOk = !brauchtSchluessel || !!key;
  stufen.push({
    nr: 2,
    name: 'Schlüssel hinterlegt',
    ok: keyOk,
    detail: !brauchtSchluessel
      ? 'Ollama braucht keinen Schlüssel'
      : key ? schluesselUmriss(key) : 'kein Schlüssel gespeichert',
    naechsterSchritt: keyOk
      ? undefined
      : 'Einstellungen → KI → API-Schlüssel eintragen. Hat der Schlüssel dort früher gestanden, ist er verlorengegangen — dann bitte melden.',
  });

  // ── 3. Nur lokale KI ───────────────────────────────────────────────────────
  //
  // Der stille Killer: Steht der Schalter, weist aiCallChat() jeden
  // Cloud-Anbieter OHNE Netzwerkaufruf ab. Die Meldung lautet dann `disabled`
  // und liest sich wie „ausgeschaltet" — obwohl der Nutzer die KI eingeschaltet
  // hat und nur diese eine Governance-Regel dazwischensteht.
  const gesperrt = isCloudProviderBlocked(s);
  stufen.push({
    nr: 3,
    name: 'Nur lokale KI',
    ok: !gesperrt,
    detail: gesperrt
      ? `„Nur lokale KI" ist aktiv — ${s.provider} wird deshalb gar nicht erst angefragt`
      : 'aus — Cloud-Anbieter sind zugelassen',
    naechsterSchritt: gesperrt ? 'Einstellungen → KI: „Nur lokale KI" ausschalten, oder Ollama als Provider wählen.' : undefined,
  });
  if (gesperrt || !keyOk) {
    stufen.push(nichtGeprueft(4, 'Netz, TLS und Konto'), nichtGeprueft(5, 'Modell verfügbar'), nichtGeprueft(6, 'Echter Aufruf'));
    return baueBefund(stufen, s);
  }

  // ── 4. Netz, TLS und Konto ─────────────────────────────────────────────────
  const liste = await holeModellListe(s, key);
  stufen.push({ nr: 4, name: 'Netz, TLS und Konto', ok: liste.ok, detail: liste.detail, naechsterSchritt: liste.naechsterSchritt });
  if (!liste.ok) {
    stufen.push(nichtGeprueft(5, 'Modell verfügbar'), nichtGeprueft(6, 'Echter Aufruf'));
    return baueBefund(stufen, s);
  }

  // ── 5. Modell verfügbar ────────────────────────────────────────────────────
  const modell = modellVon(s);
  if (!liste.modelle) {
    stufen.push({ nr: 5, name: 'Modell verfügbar', ok: null, detail: 'für diesen Anbieter nicht prüfbar' });
  } else {
    const passt = modellPasst(modell, liste.modelle);
    stufen.push({
      nr: 5,
      name: 'Modell verfügbar',
      ok: passt,
      detail: passt ? `„${modell}" ist freigeschaltet` : `„${modell}" steht nicht in der Liste des Kontos`,
      naechsterSchritt: passt ? undefined : `Verfügbar wären: ${liste.modelle.slice(0, 6).join(', ')}`,
    });
  }

  // ── 6. Echter Aufruf ───────────────────────────────────────────────────────
  const begonnen = Date.now();
  const probe = await aiCallChat('Antworte nur mit: OK', undefined, {
    settings: { ...s, enabled: true },
    timeoutMs: 20_000,
  });
  const dauer = Date.now() - begonnen;
  stufen.push({
    nr: 6,
    name: 'Echter Aufruf',
    ok: probe.ok,
    detail: probe.ok ? `Antwort nach ${dauer} ms` : describeAiError(probe.error, probe.detail),
    naechsterSchritt: probe.ok ? undefined : 'Die Stufen darüber sind grün — das Modell antwortet trotzdem nicht. Bericht kopieren und weitergeben.',
  });

  return baueBefund(stufen, s);
}

/** Letzte KI-Aufrufe aus dem Prüfpfad — die Historie zum Befund. */
function letzteAufrufe(n: number): string[] {
  try {
    const rows = sqlite.prepare(
      `SELECT ts, action, detail FROM audit_log WHERE action LIKE 'ai.call%' ORDER BY ts DESC LIMIT ?`,
    ).all(n) as Array<{ ts: string; action: string; detail: string | null }>;
    return rows.map(r => `${r.ts} ${r.action}${r.detail ? ` · ${r.detail}` : ''}`);
  } catch {
    return [];
  }
}

function zeichen(ok: boolean | null): string {
  return ok === null ? '–     ' : ok ? 'ok    ' : 'FEHLER';
}

function baueBefund(stufen: SelbsttestStufe[], s: AiSettings): SelbsttestBefund {
  const geprueftAm = new Date().toISOString();
  const key = schluesselVon(s);

  const zeilen = [
    `Opero hr-onsite ${APP_VERSION} · ${process.platform} ${process.arch} · Node ${process.versions.node}`,
    `Provider: ${s.provider} · Modell: ${modellVon(s)} · Schlüssel hinterlegt: ${key ? 'ja' : 'nein'}`,
    '',
    ...stufen.map(st => `${st.nr} ${st.name.padEnd(22)} ${zeichen(st.ok)}  ${st.detail}`
      + (st.naechsterSchritt ? `\n${''.padEnd(32)}→ ${st.naechsterSchritt}` : '')),
    '',
    `HTTPS_PROXY: ${process.env.HTTPS_PROXY ?? 'nicht gesetzt'} · HTTP_PROXY: ${process.env.HTTP_PROXY ?? 'nicht gesetzt'}`,
    `Geprüft am: ${geprueftAm}`,
  ];

  const historie = letzteAufrufe(3);
  if (historie.length > 0) zeilen.push('', 'Letzte KI-Aufrufe:', ...historie.map(h => `  ${h}`));

  // Eine Stufe mit `ok: null` ist kein Fehler — sie wurde nicht geprüft. Der
  // Gesamtbefund hängt allein daran, ob eine Stufe tatsächlich gerissen ist.
  return { ok: stufen.every(st => st.ok !== false), stufen, bericht: zeilen.join('\n'), geprueftAm };
}
