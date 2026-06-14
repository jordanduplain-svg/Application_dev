import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@candio/shared';
import { api } from '../lib/api';
import AiConfigBlocks from '../components/AiConfigBlocks';

// Page Profil (fusion Accueil + Profil) : identité + coordonnées + configuration IA
// (lettres/fiches + crawl) + raccourcis SMTP/IMAP. La gestion du CV reste dans l'onglet CV.
export default function ProfilePage({ onGoToCv, onGoToSettings, onGoToScraping }: {
  onGoToCv?: () => void;
  onGoToSettings?: () => void;
  onGoToScraping?: () => void;
}) {
  const [, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', emailSender: '', phone: '', linkedin: '', portfolio: '', github: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  const load = async () => {
    try {
      const p = await api.invoke('profile:get');
      setProfile(p);
      if (p) setForm({
        firstName: p.firstName,
        lastName: p.lastName,
        emailSender: p.emailSender ?? '',
        phone: p.phone ?? '',
        linkedin: p.linkedin ?? '',
        portfolio: p.portfolio ?? '',
        github: p.github ?? '',
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Erreur de chargement du profil');
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      await api.invoke('profile:update', {
        firstName: form.firstName,
        lastName: form.lastName,
        emailSender: form.emailSender || null,
        phone: form.phone || null,
        linkedin: form.linkedin || null,
        portfolio: form.portfolio || null,
        github: form.github || null,
      });
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      if (isMounted.current) setIsSaving(false);
    }
  };

  return (
    <section>
      <h2>Profil</h2>
      {loadError && <p className="error">{loadError}</p>}

      {/* Mise en page 2 colonnes : identité + CV à gauche, configuration IA à droite. */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── Colonne gauche : identité + CV ── */}
        <div style={{ flex: '0 1 440px', minWidth: '320px' }}>
      <div className="form">
        <label>Prénom
          <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        </label>
        <label>Nom
          <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </label>
        <label>Adresse d'envoi des candidatures
          <input
            type="email"
            value={form.emailSender}
            onChange={(e) => setForm({ ...form, emailSender: e.target.value })}
          />
        </label>
        {/* FM-05 : champs de contact complémentaires. */}
        <label>Téléphone (optionnel)
          <input
            type="tel"
            placeholder="+33 6 00 00 00 00"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <label>URL LinkedIn (optionnel)
          <input
            type="url"
            placeholder="https://linkedin.com/in/votre-profil"
            value={form.linkedin}
            onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
          />
        </label>
        <label>URL GitHub (optionnel — preuve de travail)
          <input
            type="url"
            placeholder="https://github.com/votre-compte"
            value={form.github}
            onChange={(e) => setForm({ ...form, github: e.target.value })}
          />
        </label>
        <label>Portfolio (optionnel)
          <input
            type="url"
            placeholder="https://votre-portfolio.com"
            value={form.portfolio}
            onChange={(e) => setForm({ ...form, portfolio: e.target.value })}
          />
        </label>
        <button onClick={save} disabled={isSaving}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {saveError && <p className="error">{saveError}</p>}
      </div>

      {/* CV-MULTI : le CV se gère désormais dans l'onglet dédié. */}
      <div className="card">
        <h3>CV</h3>
        <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, marginBottom: '10px' }}>
          Tu peux créer plusieurs CV (un par type de poste) et choisir lequel utiliser
          pour chaque campagne.
        </p>
        <button
          onClick={() => onGoToCv?.()}
          style={{ background: '#0a84ff', color: '#fff', border: 'none', borderRadius: '6px',
            padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
        >
          📄 Gérer mes CV →
        </button>
      </div>
        </div>{/* ── fin colonne gauche ── */}

        {/* ── Colonne droite : configuration IA + emails ── */}
        <div style={{ flex: '1 1 560px', minWidth: '340px' }}>
          <h3 style={{ marginTop: 0 }}>Configuration IA &amp; emails</h3>
          <AiConfigBlocks
            onGoToSettings={() => onGoToSettings?.()}
            onGoToScraping={() => onGoToScraping?.()}
          />
        </div>
      </div>{/* ── fin 2 colonnes ── */}
    </section>
  );
}
