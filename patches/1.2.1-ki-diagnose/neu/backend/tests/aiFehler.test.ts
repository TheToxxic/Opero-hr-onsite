/**
 * Fehlerklassen der KI-Aufrufe.
 *
 * Hintergrund: Vorher fielen 401, 400-ohne-Guthaben, 429 und 529 gemeinsam in
 * `http_error` und erreichten den Nutzer als „KI nicht erreichbar". Diese
 * Tests halten die Trennung fest — sie ist der ganze Zweck der Datei.
 */
import { describe, it, expect } from 'vitest';
import { klassifiziereHttp, describeAiError } from '../services/ai/aiFehler.js';

describe('klassifiziereHttp', () => {
  it('trennt den abgelehnten Schlüssel vom Rest', () => {
    expect(klassifiziereHttp(401, '{"error":{"message":"API key is invalid."}}')).toBe('auth');
    expect(klassifiziereHttp(403, 'forbidden')).toBe('auth');
  });

  it('erkennt ein aufgebrauchtes Guthaben am Text, nicht am Status', () => {
    // Anthropic liefert das als gewöhnlichen 400 — am Status allein ist es
    // von einem Schemafehler nicht zu unterscheiden.
    expect(klassifiziereHttp(400, 'Your credit balance is too low to access the API'))
      .toBe('kein_guthaben');
    expect(klassifiziereHttp(400, 'messages.0.content: field required')).toBe('http_error');
  });

  it('erkennt Rate-Limit und Überlastung als eigene, vorübergehende Fälle', () => {
    expect(klassifiziereHttp(429, 'rate limit exceeded')).toBe('rate_limit');
    expect(klassifiziereHttp(529, 'overloaded_error')).toBe('ueberlastet');
    expect(klassifiziereHttp(500, 'internal')).toBe('ueberlastet');
    expect(klassifiziereHttp(503, '')).toBe('ueberlastet');
  });

  it('behält die bisherige Modell-Erkennung — über Status und über Text', () => {
    expect(klassifiziereHttp(404, '')).toBe('model_not_found');
    expect(klassifiziereHttp(400, 'model: invalid model name')).toBe('model_not_found');
    expect(klassifiziereHttp(400, 'no such model: llama9')).toBe('model_not_found');
  });

  it('lässt Unbekanntes im Rest-Topf', () => {
    expect(klassifiziereHttp(418, 'teapot')).toBe('http_error');
  });

  it('ordnet Guthaben vor Modell ein, wenn beide Muster greifen könnten', () => {
    // "quota" und "not found" im selben Text: Der Abrechnungsfall ist der
    // handlungsrelevante, er muss zuerst greifen.
    expect(klassifiziereHttp(400, 'quota exceeded, endpoint not found')).toBe('kein_guthaben');
  });
});

describe('describeAiError', () => {
  it('nennt bei jedem behandelten Fall einen nächsten Schritt', () => {
    expect(describeAiError('auth')).toMatch(/Schlüssel/);
    expect(describeAiError('auth')).toMatch(/Einstellungen/);
    expect(describeAiError('kein_guthaben')).toMatch(/Guthaben|Ausgabelimit/);
    expect(describeAiError('rate_limit')).toMatch(/erneut/);
    expect(describeAiError('ueberlastet')).toMatch(/später erneut/);
  });

  it('nennt beim Netzfehler den Proxy als wahrscheinlichste Ursache', () => {
    // Das war der eigentliche Befund: "nicht erreichbar" ohne Ursache hat
    // niemandem geholfen. Der häufigste Grund ist kein Ausfall.
    expect(describeAiError('network', 'fetch failed')).toMatch(/Proxy|Firewall/);
    expect(describeAiError('network', 'fetch failed')).toContain('fetch failed');
  });

  it('gibt niemals den Aufruf selbst preis, nur die Antwort des Anbieters', () => {
    const text = describeAiError('auth', 'HTTP 401: {"error":{"message":"API key is invalid."}}');
    expect(text).not.toMatch(/sk-ant-/);
  });
});
