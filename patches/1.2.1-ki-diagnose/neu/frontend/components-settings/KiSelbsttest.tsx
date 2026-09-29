/**
 * Selbsttest-Tafel unter Einstellungen → KI.
 *
 * Gegenstück zu `services/ai/selbsttest.ts`. Bewusst dieselbe Darstellung wie
 * die Einzelprüfungen nach einer Wiederherstellung: eine Zeile je Prüfung, mit
 * Ergebnis, Detail und — wo es eins gibt — dem nächsten Schritt. Der Nutzer
 * soll nicht lesen, DASS es klemmt, sondern WO.
 *
 * Läuft nur auf Knopfdruck. Die letzte Stufe ist ein echter Modellaufruf; das
 * gehört nicht in einen Hintergrund-Puls.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, X, Minus, Copy, Stethoscope } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../i18n';

interface SelbsttestStufe {
  nr: number;
  name: string;
  ok: boolean | null;
  detail: string;
  naechsterSchritt?: string;
}

interface SelbsttestBefund {
  ok: boolean;
  stufen: SelbsttestStufe[];
  bericht: string;
  geprueftAm: string;
}

function Symbol({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Minus size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />;
  if (ok) return <Check size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--signal-ok)' }} />;
  return <X size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--signal-urgent)' }} />;
}

export function KiSelbsttest() {
  const { t } = useT();
  const [kopiert, setKopiert] = useState(false);

  const lauf = useMutation({
    mutationFn: () => api.get<SelbsttestBefund>('/settings/ai/selbsttest'),
  });
  const befund = lauf.data;

  async function kopiereBericht(bericht: string) {
    try {
      await navigator.clipboard.writeText(bericht);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      // Zwischenablage gesperrt (Fokus, Richtlinie) — der Text steht ohnehin
      // unten im Kasten und lässt sich markieren.
    }
  }

  return (
    <section className="rounded-xl border p-6 mb-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Stethoscope size={16} className="text-accent" />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t('settings.ki.selbsttest.title')}</h2>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{t('settings.ki.selbsttest.intro')}</p>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => lauf.mutate()}
          disabled={lauf.isPending}
          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border)' }}
        >
          {lauf.isPending ? t('settings.ki.selbsttest.running') : t('settings.ki.selbsttest.run')}
        </button>
        {befund && (
          <button
            onClick={() => kopiereBericht(befund.bericht)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs"
            style={{ backgroundColor: 'var(--inset)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            <Copy size={11} /> {kopiert ? t('settings.ki.selbsttest.copied') : t('settings.ki.selbsttest.copy')}
          </button>
        )}
      </div>

      {lauf.isError && (
        <div className="text-xs mb-3" style={{ color: 'var(--signal-urgent)' }}>
          {(lauf.error as Error).message}
        </div>
      )}

      {befund && (
        <>
          <div className="space-y-2">
            {befund.stufen.map(st => (
              <div key={st.nr} className="flex items-start gap-2 text-xs">
                <Symbol ok={st.ok} />
                <div className="flex-1 min-w-0">
                  <div style={{ color: 'var(--text)' }}>
                    <span className="font-medium">{st.nr}. {st.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}> — {st.detail}</span>
                  </div>
                  {st.naechsterSchritt && (
                    <div className="mt-0.5" style={{ color: st.ok === false ? 'var(--signal-urgent)' : 'var(--text-muted)' }}>
                      → {st.naechsterSchritt}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 text-xs" style={{ color: befund.ok ? 'var(--signal-ok)' : 'var(--signal-urgent)' }}>
            {befund.ok ? t('settings.ki.selbsttest.allOk') : t('settings.ki.selbsttest.failed')}
          </div>

          {/* Der Bericht steht sichtbar da, nicht nur in der Zwischenablage —
              wo die gesperrt ist, muss er sich markieren lassen. */}
          <pre
            className="mt-3 p-3 rounded-lg overflow-x-auto text-2xs whitespace-pre-wrap break-words"
            style={{ backgroundColor: 'var(--inset)', color: 'var(--text-muted)' }}
          >{befund.bericht}</pre>
        </>
      )}
    </section>
  );
}
