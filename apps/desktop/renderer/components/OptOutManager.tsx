import { useEffect, useState } from 'react';
import { ShieldOff, Trash2, UserX } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { OptOutEntry } from '@candio/shared';
import { api } from '../lib/api';

// RGPD : gestion de la liste « ne pas contacter » (opt-out / droit à l'effacement).
// Un contact présent ici ne peut plus être importé ni recevoir d'email (initial
// ou relance). « Effacer un contact » applique le droit à l'effacement : opt-out
// + suppression de toutes ses entreprises/candidatures.

const cardAccent = (c: string): CSSProperties => ({ borderLeft: `4px solid ${c}` });
const shStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px' };
const ACCENT = '#ff9f0a';

export default function OptOutManager() {
  const [entries, setEntries] = useState<OptOutEntry[]>([]);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [eraseEmail, setEraseEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setEntries(await api.invoke('optout:list'));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erreur de chargement');
    }
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    if (!value.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await api.invoke('optout:add', { value, reason: reason.trim() || undefined });
      setValue(''); setReason('');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erreur lors de l\'ajout');
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      await api.invoke('optout:remove', { id });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erreur lors du retrait');
    } finally { setBusy(false); }
  };

  const erase = async () => {
    if (!eraseEmail.trim()) return;
    const ok = await api.invoke('dialog:confirm', {
      title: 'Droit à l\'effacement (RGPD)',
      message: `Effacer DÉFINITIVEMENT toutes les données de ${eraseEmail.trim()} (entreprises + candidatures, toutes campagnes) et l'ajouter à la liste « ne pas contacter » ? Action irréversible.`,
    });
    if (!ok) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.invoke('optout:erase', { email: eraseEmail.trim() });
      setMsg(`Contact effacé — ${r.erased} entreprise(s)/candidature(s) supprimée(s).`);
      setEraseEmail('');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erreur lors de l\'effacement');
    } finally { setBusy(false); }
  };

  return (
    <div className="card span-all" style={cardAccent(ACCENT)}>
      <h3 style={shStyle}><ShieldOff size={17} color={ACCENT} />Ne pas contacter (RGPD)</h3>
      <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>
        Les contacts listés ici sont exclus de tout import et ne reçoivent plus aucun email
        (candidature ou relance). Saisis une <strong>adresse</strong> (ex. <code>jean@acme.com</code>)
        ou un <strong>domaine entier</strong> (ex. <code>acme.com</code>).
      </p>

      {/* Ajout d'une entrée opt-out. */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#333', marginBottom: '3px' }}>
            Email ou domaine
          </label>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="jean@acme.com ou acme.com" />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#333', marginBottom: '3px' }}>
            Raison (facultatif)
          </label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="désinscription demandée" />
        </div>
        <button onClick={add} disabled={busy || !value.trim()}>Ajouter</button>
      </div>

      {/* Liste des entrées. */}
      {entries.length > 0 ? (
        <ul style={{ marginTop: '14px' }}>
          {entries.map((en) => (
            <li key={en.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: 700,
                background: en.kind === 'domain' ? '#5856d6' : ACCENT, color: '#fff',
              }}>
                {en.kind === 'domain' ? 'domaine' : 'email'}
              </span>
              <strong style={{ fontSize: '13px' }}>{en.value}</strong>
              {en.reason && <span style={{ fontSize: '12px', color: '#888' }}>— {en.reason}</span>}
              <button
                onClick={() => remove(en.id)}
                disabled={busy}
                className="btn-secondary"
                style={{ fontSize: '12px', marginLeft: 'auto' }}
                title="Retirer de la liste (réautoriser le contact)"
              >
                <Trash2 size={13} /> Retirer
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: '13px', color: '#888', marginTop: '12px' }}>Aucun contact bloqué.</p>
      )}

      {/* Droit à l'effacement. */}
      <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid #eee' }}>
        <h4 style={{ ...shStyle, fontSize: '14px', margin: '0 0 6px' }}>
          <UserX size={15} color="#ff453a" />Droit à l'effacement
        </h4>
        <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>
          Sur demande d'un contact, supprime toutes ses données (entreprises + candidatures, toutes
          campagnes) et l'ajoute à la liste ci-dessus pour qu'il ne soit plus jamais recontacté.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '6px' }}>
          <div style={{ flex: '1 1 220px' }}>
            <input
              value={eraseEmail}
              onChange={(e) => setEraseEmail(e.target.value)}
              placeholder="adresse du contact à effacer"
            />
          </div>
          <button onClick={erase} disabled={busy || !eraseEmail.trim()} className="btn-danger">
            Effacer ce contact
          </button>
        </div>
      </div>

      {msg && <p style={{ fontSize: '13px', color: 'var(--text-sub)', marginTop: '10px' }}>{msg}</p>}
    </div>
  );
}
