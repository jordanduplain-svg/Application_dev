import { useEffect, useRef, useState } from 'react';
import { Mail, Copy, Sparkles } from 'lucide-react';
import type { Cv } from '@candio/shared';
import { api } from '../lib/api';

/**
 * LETTRE-ANNONCE : génère une lettre de motivation pour UNE annonce collée.
 *
 * On choisit un CV (déjà analysé), on saisit poste + entreprise, on colle le texte
 * de l'annonce, et l'IA (le même moteur que les emails de campagne) rédige la lettre.
 * Rien n'est stocké : le résultat s'affiche, éditable, à copier.
 *
 * ponytail: réutilise generatePitch côté main (zéro nouveau prompt). Pas de lien web
 * d'annonce (fetch d'URL arbitraire trop fragile) — copier-coller seulement.
 */
export default function CoverLetterPage() {
  const [cvs, setCvs] = useState<Cv[]>([]);
  const [cvId, setCvId] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [availability, setAvailability] = useState('');
  const [annonce, setAnnonce] = useState('');

  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ subject: string; body: string } | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    void api.invoke('cv:list').then((list) => {
      if (!isMounted.current) return;
      setCvs(list);
      // Présélectionne le 1er CV analysé (seuls ceux-là personnalisent la lettre).
      const firstAnalyzed = list.find((c) => c.parsed) ?? list[0];
      if (firstAnalyzed) setCvId(firstAnalyzed.id);
    }).catch(() => {});
  }, []);

  // Chrono pendant la génération (rassure que ça n'a pas freezé).
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [loading]);

  const generate = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const r = await api.invoke('ai:generateCoverLetter', {
        cvId, jobTitle, company,
        contact: contact.trim() || null,
        annonce,
        availability: availability.trim() || null,
      });
      if (isMounted.current) setResult(r);
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur de génération');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).catch(() => {});
  };

  const selectedCv = cvs.find((c) => c.id === cvId);
  const canGenerate = !!cvId && jobTitle.trim() && company.trim() && annonce.trim().length >= 30 && !loading;

  return (
    <section>
      <div className="page-head">
        <h2>Lettre de motivation</h2>
        <div className="page-sub">
          Pour une annonce précise : choisis un CV, colle le texte de l'annonce, l'IA rédige la lettre.
        </div>
      </div>

      <div style={{ maxWidth: '760px' }}>
        {error && <p className="error">{error}</p>}

        <div className="form-section" style={{ '--m': '#0a84ff', marginBottom: '16px' } as React.CSSProperties}>
          <div className="form-section-title"><span className="fst-ico"><Mail size={16} /></span>L'annonce</div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <label style={{ flex: 1, minWidth: '220px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' }}>CV à utiliser</div>
              <select value={cvId} onChange={(e) => setCvId(e.target.value)} style={{ width: '100%' }}>
                {cvs.length === 0 && <option value="">Aucun CV — ajoute-en un dans l'onglet CV</option>}
                {cvs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.parsed ? '' : ' (non analysé)'}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: 1, minWidth: '220px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' }}>Poste visé</div>
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="ex : Data Analyst" style={{ width: '100%' }} />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <label style={{ flex: 1, minWidth: '220px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' }}>Entreprise</div>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ex : Joko" style={{ width: '100%' }} />
            </label>
            <label style={{ flex: 1, minWidth: '220px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' }}>Destinataire (optionnel)</div>
              <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="ex : Mme Dupont" style={{ width: '100%' }} />
            </label>
          </div>

          <label style={{ display: 'block', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' }}>Disponibilité (optionnel)</div>
            <input value={availability} onChange={(e) => setAvailability(e.target.value)} placeholder="ex : disponible à partir de septembre 2026" style={{ width: '100%' }} />
          </label>

          <label style={{ display: 'block' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' }}>Texte de l'annonce (copier-coller)</div>
            <textarea
              value={annonce}
              onChange={(e) => setAnnonce(e.target.value)}
              placeholder="Colle ici le descriptif complet du poste…"
              rows={12}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '13px' }}
            />
          </label>
          {selectedCv && !selectedCv.parsed && (
            <small style={{ color: '#b8860b', display: 'block', marginTop: '6px' }}>
              ⚠️ Ce CV n'est pas encore analysé — importe son PDF dans l'onglet CV pour personnaliser la lettre.
            </small>
          )}

          <div style={{ marginTop: '14px' }}>
            <button onClick={generate} disabled={!canGenerate}>
              <Sparkles size={15} />{loading ? `Génération… (${elapsed}s)` : 'Générer la lettre'}
            </button>
          </div>
        </div>

        {result && (
          <div className="form-section" style={{ '--m': '#34c759' } as React.CSSProperties}>
            <div className="form-section-title"><span className="fst-ico"><Mail size={16} /></span>Lettre générée</div>

            <label style={{ display: 'block', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-sub)' }}>Objet</span>
                <button className="btn-secondary" style={{ fontSize: '12px' }} onClick={() => copy(result.subject)}>
                  <Copy size={13} /> Copier
                </button>
              </div>
              <input
                value={result.subject}
                onChange={(e) => setResult({ ...result, subject: e.target.value })}
                style={{ width: '100%' }}
              />
            </label>

            <label style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-sub)' }}>Corps (éditable)</span>
                <button className="btn-secondary" style={{ fontSize: '12px' }} onClick={() => copy(result.body)}>
                  <Copy size={13} /> Copier
                </button>
              </div>
              <textarea
                value={result.body}
                onChange={(e) => setResult({ ...result, body: e.target.value })}
                rows={18}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '13px', lineHeight: 1.5 }}
              />
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
