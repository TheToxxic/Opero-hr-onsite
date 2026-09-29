/**
 * Fehlerklassen der KI-Aufrufe — und der eine Ort, an dem eine HTTP-Antwort
 * zu einer Klasse wird.
 *
 * Vorher entschied das jeder Anbieter-Zweig in index.ts für sich, und alle drei
 * kannten dieselbe halbe Regel: „404 heisst Modell, alles andere heisst
 * http_error". Damit fielen ein abgelehnter Schlüssel (401), ein aufgebrauchtes
 * Guthaben (400) und ein Rate-Limit (429) in denselben Topf und erreichten den
 * Nutzer als ein und derselbe Satz: „KI nicht erreichbar". Drei Fälle, drei
 * völlig verschiedene Handgriffe, eine Meldung — das war die Lücke, nicht die
 * Verbindung.
 *
 * Eigene Datei, weil der Typ sonst in index.ts wohnt und selbsttest.ts ihn
 * braucht: index.ts importiert von hier, nie umgekehrt.
 */

export type AiErrorClass =
  | 'ok'
  | 'disabled'
  | 'no_provider'
  | 'network'
  | 'timeout'
  /** 401/403 — der Schlüssel wurde abgelehnt. */
  | 'auth'
  /** 400 mit Abrechnungsbezug — Verbindung steht, Konto nicht. */
  | 'kein_guthaben'
  /** 429 — zu viele Anfragen, vorübergehend. */
  | 'rate_limit'
  /** 529/5xx — der Anbieter selbst, vorübergehend. */
  | 'ueberlastet'
  | 'model_not_found'
  /** Rest-Topf: HTTP-Fehler, der zu keiner der obigen Klassen passt. */
  | 'http_error'
  | 'empty_body'
  | 'invalid_json';

/**
 * HTTP-Antwort → Fehlerklasse. Gilt für alle Anbieter.
 *
 * Reihenfolge ist Absicht: Die spezifischen Fälle stehen vor dem Rest-Topf,
 * und die Guthaben-Prüfung vor dem generischen 400, weil Anthropic ein
 * leeres Konto als gewöhnlichen `invalid_request_error` zurückgibt — am
 * Status allein ist er von einem Schemafehler nicht zu unterscheiden.
 *
 * `body` sind die ersten Zeichen der Fehlerantwort des Anbieters, nicht unsere
 * eigene Formulierung. Der Aufrufer liest sie ohnehin für `detail` aus.
 */
export function klassifiziereHttp(status: number, body: string): AiErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  // 529 ist Anthropics „overloaded"; alles ab 500 ist ebenfalls Anbieterseite.
  if (status >= 500) return 'ueberlastet';
  if (status === 400 && /credit balance|insufficient|billing|quota/i.test(body)) return 'kein_guthaben';
  if (status === 404 || /not found|invalid model|no such model|unknown model/i.test(body)) return 'model_not_found';
  return 'http_error';
}

/**
 * Klartext je Fehlerklasse: Ursache UND nächster Schritt in einem Satz.
 * Enthält nie ein Geheimnis — `detail` ist die Antwort des Anbieters, nicht
 * unsere Anfrage.
 *
 * Die `network`-Zeile nennt bewusst die wahrscheinliche Ursache samt Abhilfe,
 * nach demselben Muster wie die OneDrive-Platzhalter-Meldung im Ordner-Watcher.
 * „Nicht erreichbar" allein hat dort niemandem geholfen und hilft hier auch
 * nicht: Der häufigste Grund ist kein Ausfall, sondern ein Proxy dazwischen.
 */
export function describeAiError(error: AiErrorClass | undefined, detail?: string): string {
  switch (error) {
    case 'disabled':
      return detail || 'KI ist in den Einstellungen deaktiviert.';
    case 'no_provider':
      return 'Kein KI-Provider konfiguriert. Bitte unter Einstellungen → KI einen Provider einrichten.';
    case 'network':
      return ('Keine Verbindung zum KI-Endpunkt. Häufigste Ursachen: ein Unternehmensproxy oder '
        + 'eine Firewall, die HTTPS mitliest — oder der Rechner ist offline. '
        + `${detail ?? ''}`).trim();
    case 'timeout':
      return 'Zeitüberschreitung — die KI hat zu lange gebraucht. Bitte erneut versuchen.';
    case 'auth':
      return ('Der API-Schlüssel wurde abgelehnt. Er ist ungültig, widerrufen oder gehört zu einem '
        + `anderen Konto. Einstellungen → KI → Schlüssel neu eintragen. ${detail ?? ''}`).trim();
    case 'kein_guthaben':
      return ('Das Konto beim Anbieter hat kein Guthaben mehr oder das Ausgabelimit ist erreicht. '
        + `Die Verbindung steht — abgelehnt wird die Abrechnung, nicht der Zugriff. ${detail ?? ''}`).trim();
    case 'rate_limit':
      return 'Zu viele Anfragen in kurzer Zeit. Das gibt sich von selbst — in einer Minute erneut versuchen.';
    case 'ueberlastet':
      return ('Der Anbieter ist überlastet oder gestört. Kein Fehler auf deiner Seite — '
        + `später erneut versuchen. ${detail ?? ''}`).trim();
    case 'model_not_found':
      return `Modell nicht gefunden oder für dieses Konto nicht freigeschaltet. ${detail ?? ''}`.trim();
    case 'http_error':
      return `KI-Endpoint antwortete mit Fehler. ${detail ?? ''}`.trim();
    case 'empty_body':
      return 'Verbindung ok, aber das Modell lieferte eine leere Antwort.';
    case 'invalid_json':
      return 'Verbindung ok, aber die Modellantwort war kein gültiges JSON.';
    default:
      return detail ?? 'Unbekannter KI-Fehler.';
  }
}
