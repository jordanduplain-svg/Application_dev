import { useEffect, useRef, useState } from 'react';
import type { SettingsStatus, Profile } from '@candio/shared';
import { api } from '../lib/api';

/**
 * SETUP-01 : assistant de configuration au premier lancement. Overlay guidé qui liste
 * les réglages essentiels (profil, IA, SMTP) + recommandés (IMAP, CV) avec leur état et
 * un bouton « Configurer » vers la bonne page. Ne s'affiche PAS une fois l'essentiel prêt.
 *
 * Deux niveaux de fermeture : « Plus tard » (masque cette session, réapparaît au prochain
 * lancement si encore incomplet) et « Ne plus afficher » (localStorage, définitif).
 */
export default function SetupWizard({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cvCount, setCvCount] = useState(0);
  const [launchAtLogon, setLaunchAtLogon] = useState(false);
  const [hidden, setHidden] = useState(() => localStorage.getItem('setup-dismissed') === '1');
  const [loaded, setLoaded] = useState(false);
  // B11 (a11y) : réf pour focaliser l'overlay à l'ouverture (clavier).
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const [st, pr, cvs, lal] = await Promise.all([
        api.invoke('settings:getStatus'),
        api.invoke('profile:get'),
        api.invoke('cv:list'),
        api.invoke('settings:getLaunchAtLogon').catch(() => ({ enabled: false })),
      ]);
      setStatus(st); setProfile(pr); setCvCount(cvs.length); setLaunchAtLogon(lal.enabled);
    } catch { /* non bloquant */ } finally { setLoaded(true); }
  };
  useEffect(() => { void load(); }, []);
  // Recharger quand la fenêtre reprend le focus (l'utilisateur revient d'une page de config).
  useEffect(() => {
    const h = () => void load();
    window.addEventListener('focus', h);
    return () => window.removeEventListener('focus', h);
  }, []);

  // B11 (a11y) : focaliser l'overlay quand il devient visible.
  useEffect(() => {
    if (loaded && !hidden && status) dialogRef.current?.focus();
  }, [loaded, hidden, status]);

  if (!loaded || !status || hidden) return null;

  const hasAi = status.openaiKeySet || status.anthropicKeySet || status.geminiKeySet
    || status.groqKeySet || status.aiProvider === 'ollama';
  const hasEmail = !!profile?.emailSender;
  // Une fois l'essentiel prêt (profil + envoi + IA), on n'importune plus.
  if (hasEmail && status.smtpConfigured && hasAi) return null;

  const steps = [
    { key: 'profile', label: 'Profil — adresse d\'envoi', done: hasEmail, route: 'profile', essential: true,
      hint: 'Nom, prénom et l\'email depuis lequel tu candidates.' },
    { key: 'ai', label: 'Intelligence artificielle', done: hasAi, route: 'settings', essential: true,
      hint: 'Une clé (OpenAI / Claude / Gemini / Groq) ou Ollama en local pour rédiger les mails.' },
    { key: 'smtp', label: 'Envoi des mails (SMTP)', done: status.smtpConfigured, route: 'settings', essential: true,
      hint: 'Pour Gmail : active un « mot de passe d\'application ».' },
    { key: 'imap', label: 'Réception (IMAP)', done: status.imapConfigured, route: 'settings', essential: false,
      hint: 'Recommandé — détecte automatiquement les réponses et les rebonds.' },
    { key: 'cv', label: 'CV', done: cvCount > 0, route: 'cv', essential: false,
      hint: 'Au moins un CV analysé pour personnaliser les candidatures.' },
  ];
  const remaining = steps.filter((s) => s.essential && !s.done).length;

  const go = (route: string) => { setHidden(true); onNavigate(route); };
  const later = () => setHidden(true);
  const never = () => { localStorage.setItem('setup-dismissed', '1'); setHidden(true); };
  const toggleLaunch = async (v: boolean) => {
    setLaunchAtLogon(v);
    await api.invoke('settings:setLaunchAtLogon', { enabled: v }).catch(() => {});
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onKeyDown={(e) => { if (e.key === 'Escape') later(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Assistant de configuration" tabIndex={-1}
        style={{ background: '#fff', borderRadius: '14px', padding: '24px 28px', maxWidth: '560px',
        width: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,0.35)', outline: 'none' }}>
        <h2 style={{ margin: '0 0 4px' }}>Bienvenue 👋</h2>
        <p style={{ color: '#555', margin: '0 0 18px', fontSize: '14px' }}>
          Quelques réglages et l'app est prête à envoyer et suivre tes candidatures.
          {remaining > 0 ? ` Il reste ${remaining} réglage(s) essentiel(s).` : ' L\'essentiel est prêt !'}
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {steps.map((s) => (
            <li key={s.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '10px 12px', borderRadius: '10px', border: '1px solid #eee',
              background: s.done ? '#f4fbf7' : '#fff' }}>
              <span style={{ fontSize: '16px', lineHeight: '20px' }}>{s.done ? '✅' : (s.essential ? '🔴' : '○')}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>
                  {s.label}{!s.essential && <span style={{ fontSize: '11px', color: '#888', fontWeight: 400 }}> · recommandé</span>}
                </div>
                <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>{s.hint}</div>
              </div>
              {!s.done && (
                <button onClick={() => go(s.route)} style={{ fontSize: '12px', whiteSpace: 'nowrap',
                  background: '#0a84ff', color: '#fff', border: 'none', borderRadius: '7px', padding: '6px 12px', cursor: 'pointer' }}>
                  Configurer
                </button>
              )}
            </li>
          ))}
        </ul>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#444', margin: '16px 0 4px', cursor: 'pointer' }}>
          <input type="checkbox" checked={launchAtLogon} onChange={(e) => void toggleLaunch(e.target.checked)} style={{ width: 'auto' }} />
          Lancer l'app au démarrage de Windows (relances & réponses de fond, même app fermée entre-temps)
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={never} style={{ fontSize: '12px', background: 'transparent', border: 'none', color: '#999', cursor: 'pointer' }}>
            Ne plus afficher
          </button>
          <button onClick={later} style={{ fontSize: '13px', padding: '7px 16px', borderRadius: '8px', border: '1px solid #ccc', cursor: 'pointer' }}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
