import { useEffect, useRef, useState } from 'react';
import type { Campaign, CampaignInput, Cv } from '@candio/shared';
import { api } from '../lib/api';
import { statusLabel } from '../lib/status';
import { FR_REGIONS, FR_DEPTS_BY_REGION, FR_CITIES, CONTRACT_TYPES } from '../lib/geo';
import { SectorMultiSelect } from '../lib/sectors';
import PromptHelper from '../components/PromptHelper';

// État initial du formulaire de création de campagne.
const EMPTY: CampaignInput = {
  name: '', prompt: '', jobTitle: '', location: '',
  contractTypes: [], salaryMin: null, salaryMax: null,
  availability: '',     // AVAIL : disponibilité saisie (recopiée dans la lettre).
  notes: null,          // B10 : réinitialise les notes à la création suivante.
  promptVariantB: null, // B10 : réinitialise la variante B.
  cvId: null,           // CV-MULTI : CV choisi pour la campagne.
  preferredSectors: [], // SECTOR-PREF : secteurs préférés (vide = tous).
};

// Brouillon persistant : le formulaire de création survit aux changements de
// page (le composant est démonté au routage). Sauvegardé dans localStorage,
// effacé après création réussie.
const DRAFT_KEY = 'carreer-ops:campaign-draft';

function loadDraft(): CampaignInput {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<CampaignInput>) };
  } catch { return EMPTY; }
}

// True si le formulaire contient au moins une saisie (vaut la peine d'être sauvegardé).
function isDirty(f: CampaignInput): boolean {
  return !!(f.name || f.jobTitle || f.prompt || f.promptVariantB
    || f.location || f.notes || f.contractTypes.length || f.availability
    || f.salaryMin !== null || f.salaryMax !== null);
}

// PERF-1 : pagination côté client.
const PAGE_SIZE = 20;

// Liste des campagnes + formulaire de création inline.
export default function CampaignsPage({ onOpen, onGoToSettings, onGoToCv }: {
  onOpen: (id: string) => void;
  onGoToSettings?: () => void;
  onGoToCv?: () => void;
}) {
  const [cvs, setCvs] = useState<Cv[]>([]);
  const [list, setList] = useState<Campaign[]>([]);
  // UX-1v2 : liste des campagnes archivées.
  const [archivedList, setArchivedList] = useState<Campaign[]>([]);
  // UX-1v2 : afficher/masquer la section archivées.
  const [showArchived, setShowArchived] = useState(false);
  // Restaure le brouillon en cours (survit au changement de page).
  const [form, setForm] = useState<CampaignInput>(loadDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // B4 : flag pour désactiver le bouton pendant la création (évite les doublons).
  const [isSaving, setIsSaving] = useState(false);
  // UX-4v2 : id de la campagne en cours de duplication (anti-doublon).
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  // PERF-1 : pagination.
  const [page, setPage] = useState(0);
  // ADM-2v2 : suppression en masse des campagnes archivées.
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // FM-02 : compteur d'envois du jour (limite anti-suspension Gmail), affiché ici
  // pour être visible avant de générer/envoyer une campagne.
  const [sendQuota, setSendQuota] = useState<{ count: number; limit: number } | null>(null);

  // B4 : isMounted pour éviter setState sur un composant démonté.
  const isMounted = useRef(true);
  // StrictMode : remettre true au montage (sinon le cleanup laisse false et les
  // setState async sont ignorés — ex: sélecteur CV vide).
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  // Sauvegarde le brouillon à chaque saisie (ou l'efface si le formulaire est vide).
  useEffect(() => {
    try {
      if (isDirty(form)) localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* quota / mode privé — non bloquant */ }
  }, [form]);

  const load = async () => {
    try {
      setError(null);
      const result = await api.invoke('campaign:list');
      if (isMounted.current) setList(result);
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur de chargement');
    }
  };

  // UX-1v2 : charger les campagnes archivées séparément.
  const loadArchived = async () => {
    try {
      const result = await api.invoke('campaign:listArchived');
      if (isMounted.current) setArchivedList(result);
    } catch { /* non bloquant */ }
  };

  useEffect(() => { void load(); }, []);

  // FM-02 : charge le quota d'envoi du jour (rafraîchi au focus fenêtre).
  useEffect(() => {
    const loadQuota = () => api.invoke('settings:getStatus')
      .then((st) => { if (isMounted.current) setSendQuota({ count: st.dailySendCount, limit: st.dailySendLimit }); })
      .catch(() => {});
    void loadQuota();
    window.addEventListener('focus', loadQuota);
    return () => window.removeEventListener('focus', loadQuota);
  }, []);

  // CV-MULTI : charge la liste des CV pour le sélecteur (et rafraîchit au focus fenêtre).
  useEffect(() => {
    const loadCvs = () => api.invoke('cv:list')
      .then((list) => { if (isMounted.current) setCvs(list); })
      .catch(() => {});
    void loadCvs();
    window.addEventListener('focus', loadCvs);
    return () => window.removeEventListener('focus', loadCvs);
  }, []);

  // UX-1v2 : charger les archivées à la demande quand on ouvre la section.
  useEffect(() => {
    if (showArchived) void loadArchived();
  }, [showArchived]);

  const create = async () => {
    setFormError(null);
    // VALID-CAMP : champs obligatoires pour pouvoir lancer une campagne.
    // On agrège les manques en un seul message clair plutôt qu'un blocage muet.
    const missing: string[] = [];
    if (!form.name.trim()) missing.push('le nom de la campagne');
    if (!form.jobTitle.trim()) missing.push("l'intitulé du poste");
    if (form.contractTypes.length === 0) missing.push('au moins un type de contrat');
    if (form.salaryMin === null) missing.push('le salaire minimum');
    if (form.salaryMax === null) missing.push('le salaire maximum');
    if (!(form.availability ?? '').trim()) missing.push('la disponibilité');
    if (!form.prompt.trim() && !(form.promptVariantB ?? '').trim()) {
      missing.push('au moins un prompt (A ou B)');
    }
    if (missing.length > 0) {
      setFormError(`Impossible de lancer la campagne — il manque : ${missing.join(', ')}.`);
      return;
    }
    // L4 : valider la cohérence salaire min/max.
    if (form.salaryMin !== null && form.salaryMax !== null && form.salaryMin > form.salaryMax) {
      setFormError('Le salaire minimum doit être ≤ au salaire maximum.');
      return;
    }
    // VALID-CAMP : le Profil doit avoir prénom + nom (ils signent les lettres).
    try {
      const profile = await api.invoke('profile:get');
      if (!profile?.firstName?.trim() || !profile?.lastName?.trim()) {
        setFormError('Renseigne ton prénom et ton nom dans le Profil avant de lancer une campagne (ils servent à signer les lettres).');
        return;
      }
    } catch {
      setFormError('Impossible de vérifier le Profil — réessaie. Le prénom et le nom y sont requis pour lancer une campagne.');
      return;
    }
    setIsSaving(true);
    try {
      const created = await api.invoke('campaign:create', form);
      // SECTOR-AUTO : pré-remplit la campagne avec les leads du master (secteur +
      // lieu), en excluant ceux déjà utilisés ailleurs, plafonné à 150. Non bloquant :
      // si le master est absent, la campagne reste vide et l'utilisateur importe à la main.
      try {
        await api.invoke('scraping:importLeadsToCampaign', {
          campaignId: created.id,
          sectors: form.preferredSectors ?? [],
          location: form.location,
          limit: 150,
        });
      } catch { /* import auto non bloquant — la campagne est créée quand même */ }
      // Efface le brouillon et ouvre directement la campagne créée.
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* non bloquant */ }
      setForm(EMPTY);
      onOpen(created.id);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Erreur lors de la création');
    } finally {
      if (isMounted.current) setIsSaving(false);
    }
  };

  // UX-4v2 : dupliquer une campagne.
  const duplicate = async (id: string) => {
    if (isMounted.current) setDuplicatingId(id);
    if (isMounted.current) setError(null);
    try {
      await api.invoke('campaign:duplicate', { id });
      if (isMounted.current) setPage(0);
      await load();
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur lors de la duplication');
    } finally {
      if (isMounted.current) setDuplicatingId(null);
    }
  };

  // UX-1v2 : désarchiver une campagne.
  const unarchive = async (id: string) => {
    try {
      await api.invoke('campaign:unarchive', { id });
      await Promise.all([load(), loadArchived()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du désarchivage');
    }
  };

  // ADM-2v2 : supprimer toutes les campagnes archivées.
  const bulkDeleteArchived = async () => {
    const confirmed = await api.invoke('dialog:confirm', {
      title: 'Supprimer les campagnes archivées',
      message: 'Êtes-vous sûr de vouloir supprimer définitivement toutes les campagnes archivées ? Cette action est irréversible.',
    });
    if (!confirmed) return;
    if (isMounted.current) setBulkDeleting(true);
    try {
      const result = await api.invoke('campaign:bulkDeleteArchived');
      await loadArchived();
      if (result.deleted === 0 && isMounted.current) {
        setError('Aucune campagne archivée à supprimer.');
      }
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur lors de la suppression');
    } finally {
      if (isMounted.current) setBulkDeleting(false);
    }
  };

  // PERF-1 : slice côté client.
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const paginatedList = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section>
      <h2>Campagnes</h2>
      {/* Le choix du moteur IA est centralisé sur la page Accueil. */}

      {/* FM-02 : quota d'envoi du jour, visible avant de générer/envoyer. */}
      {sendQuota && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
          padding: '6px 12px', marginBottom: '12px', fontSize: '13px',
          background: '#f5f5f7', borderRadius: '8px', border: '1px solid #e0e0e0',
        }}>
          <span>📨 Envois aujourd'hui :</span>
          <strong style={{ color: sendQuota.count >= sendQuota.limit ? '#ff453a' : '#34c759' }}>
            {sendQuota.count} / {sendQuota.limit}
          </strong>
          <span style={{ color: '#888' }}>
            {sendQuota.count >= sendQuota.limit
              ? '— plafond du jour atteint (anti-suspension Gmail), réessaie demain'
              : `— ${sendQuota.limit - sendQuota.count} restant(s) avant le plafond du jour`}
          </span>
          {onGoToSettings && (
            <button
              type="button"
              onClick={() => onGoToSettings()}
              style={{ marginLeft: 'auto', fontSize: '11px', padding: '2px 8px', background: 'transparent', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}
            >
              Détails
            </button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <ul className="campaigns-list">
        {paginatedList.map((c) => (
          <li key={c.id}>
            {/* Clic sur le nom ouvre la campagne. */}
            <span
              style={{ flex: 1, cursor: 'pointer' }}
              onClick={() => onOpen(c.id)}
            >
              <strong>{c.name}</strong> — {c.jobTitle} · {c.location}
              {/* UX-9v2 : compteurs. */}
              {' '}
              <span style={{ fontSize: '11px', color: '#888' }}>
                ({c.companiesCount} ent. / {c.sentCount} env. / {c.repliedCount} rép.)
              </span>
            </span>
            {/* UX-7 : statut en français. */}
            <span className={`status status-${c.status.toLowerCase()}`}>{statusLabel(c.status)}</span>
            {/* UX-4v2 : bouton dupliquer. */}
            <button
              onClick={(e) => { e.stopPropagation(); void duplicate(c.id); }}
              disabled={duplicatingId === c.id}
              style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 8px' }}
            >
              {duplicatingId === c.id ? '…' : 'Dupliquer'}
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="empty">Aucune campagne — créez-en une ci-dessous.</li>
        )}
      </ul>

      {/* PERF-1 : pagination. */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '8px', margin: '8px 0', alignItems: 'center' }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            Précédent
          </button>
          <span>Page {page + 1} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
            Suivant
          </button>
        </div>
      )}

      {/* UX-1v2 : section campagnes archivées. */}
      <div style={{ marginTop: '24px' }}>
        <button
          onClick={() => setShowArchived((v) => !v)}
          style={{ fontSize: '12px', background: 'transparent', border: '1px solid #ccc' }}
        >
          {showArchived ? 'Masquer' : 'Afficher'} les campagnes archivées
          {archivedList.length > 0 && ` (${archivedList.length})`}
        </button>

        {showArchived && (
          <div style={{ marginTop: '12px' }}>
            {archivedList.length > 0 ? (
              <>
                {/* ADM-2v2 : bouton suppression en masse. */}
                <button
                  onClick={bulkDeleteArchived}
                  disabled={bulkDeleting}
                  style={{ background: '#ff453a', color: '#fff', marginBottom: '8px', fontSize: '11px' }}
                >
                  {bulkDeleting ? 'Suppression…' : `Supprimer toutes les archivées (${archivedList.length})`}
                </button>
                <ul className="campaigns-list">
                  {archivedList.map((c) => (
                    <li key={c.id} style={{ opacity: 0.7 }}>
                      <span style={{ flex: 1 }}>
                        <strong>{c.name}</strong> — {c.jobTitle} · {c.location}
                        <span style={{ fontSize: '11px', color: '#888', marginLeft: '6px' }}>
                          (archivée le {c.archivedAt ? new Date(c.archivedAt).toLocaleDateString('fr-FR') : '?'})
                        </span>
                      </span>
                      {/* UX-1v2 : bouton désarchiver. */}
                      <button
                        onClick={() => unarchive(c.id)}
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                      >
                        Désarchiver
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p style={{ color: '#888', fontSize: '13px' }}>Aucune campagne archivée.</p>
            )}
          </div>
        )}
      </div>

      <div className="form">
        <h3>Nouvelle campagne</h3>
        <label>Nom
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>Intitulé du poste
          <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
        </label>
        {/* CV-MULTI : choix du CV utilisé pour cette campagne. */}
        <label>CV utilisé pour cette campagne
          {cvs.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#856404', background: '#fff8e1',
              border: '1px solid #ffc107', borderRadius: '6px', padding: '8px 10px', marginTop: '4px' }}>
              Aucun CV créé.
              <button type="button" onClick={() => onGoToCv?.()}
                style={{ marginLeft: '8px', fontSize: '12px', padding: '3px 10px',
                  background: '#0a84ff', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                Créer un CV
              </button>
            </div>
          ) : (
            <select value={form.cvId ?? ''} onChange={(e) => setForm({ ...form, cvId: e.target.value || null })}>
              <option value="">— Choisir un CV —</option>
              {cvs.map((cv) => (
                <option key={cv.id} value={cv.id}>
                  {cv.name}{cv.parsed ? '' : ' (PDF non analysé)'}
                </option>
              ))}
            </select>
          )}
        </label>
        <label>Lieu
          <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
            <option value="">— Toute la France —</option>
            <optgroup label="Régions">
              {FR_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </optgroup>
            <optgroup label="Départements">
              {FR_REGIONS.flatMap((r) => FR_DEPTS_BY_REGION[r]).map((d) => (
                <option key={d.code} value={d.name}>{d.name} ({d.code})</option>
              ))}
            </optgroup>
            <optgroup label="Grandes villes">
              {FR_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </optgroup>
          </select>
        </label>
        <label>Secteurs préférés <span style={{ fontWeight: 400, color: '#888', fontSize: '12px' }}>(où tu veux travailler — max 5)</span>
          <SectorMultiSelect
            value={form.preferredSectors ?? []}
            onChange={(next) => setForm({ ...form, preferredSectors: next })}
            max={5}
          />
          <span style={{ fontSize: '11px', color: '#888', display: 'block', marginTop: '4px' }}>
            Filtre les leads importés vers ces secteurs. Vide = tous. Si trop peu d'entreprises
            (&lt; 25) dans ces secteurs, on élargit automatiquement aux autres.
          </span>
        </label>
        <label>Types de contrat
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
            {CONTRACT_TYPES.map((ct) => {
              const active = form.contractTypes.includes(ct);
              return (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setForm({
                    ...form,
                    contractTypes: active
                      ? form.contractTypes.filter((c) => c !== ct)
                      : [...form.contractTypes, ct],
                  })}
                  style={{
                    padding: '4px 12px', borderRadius: '14px', cursor: 'pointer',
                    border: active ? '1px solid #007aff' : '1px solid #ccc',
                    background: active ? '#007aff' : '#f0f0f0',
                    color: active ? '#fff' : '#333', fontSize: '13px',
                  }}
                >
                  {ct}
                </button>
              );
            })}
          </div>
        </label>
        <div style={{ display: 'flex', gap: '12px' }}>
          <label style={{ flex: 1 }}>Salaire min (€)
            <input
              type="number"
              min={0}
              step={1000}
              value={form.salaryMin ?? ''}
              onChange={(e) => {
                const n = e.target.value ? Math.max(0, Number(e.target.value)) : null;
                setForm({ ...form, salaryMin: n });
              }}
            />
          </label>
          <label style={{ flex: 1 }}>Salaire max (€)
            <input
              type="number"
              min={0}
              step={1000}
              value={form.salaryMax ?? ''}
              onChange={(e) => {
                const n = e.target.value ? Math.max(0, Number(e.target.value)) : null;
                setForm({ ...form, salaryMax: n });
              }}
            />
          </label>
        </div>
        {/* AVAIL : disponibilité recopiée telle quelle dans la lettre (évite les dates inventées). */}
        <label>Disponibilité
          <input
            value={form.availability ?? ''}
            onChange={(e) => setForm({ ...form, availability: e.target.value })}
            placeholder="Ex : début octobre 2026, dès maintenant, sous 1 mois…"
          />
          <span style={{ fontSize: '11px', color: '#888', display: 'block', marginTop: '4px' }}>
            Recopiée telle quelle dans la lettre — l'IA n'inventera plus de date.
          </span>
        </label>
        {/* PROMPT-HELPER : assistant de rédaction repliable (génère Prompt A + B). */}
        <PromptHelper
          cvId={form.cvId}
          jobTitle={form.jobTitle}
          contractInfo={[
            form.contractTypes.length ? `Type(s) de contrat : ${form.contractTypes.join(', ')}` : '',
            (form.availability ?? '').trim() ? `disponibilité : ${(form.availability ?? '').trim()}` : '',
          ].filter(Boolean).join(' · ')}
          onGenerate={(promptA, promptB) =>
            setForm({ ...form, prompt: promptA, promptVariantB: promptB })
          }
        />
        <label>Prompt A — consignes pour l'IA
          <textarea
            rows={4}
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="Ex: ton chaleureux, mettre en avant mon expérience de chef de projet…"
          />
        </label>
        {/* ANA-5v3 : prompt variante B pour test A/B. */}
        <label>Prompt B (optionnel — test A/B)
          <textarea
            rows={3}
            value={form.promptVariantB ?? ''}
            onChange={(e) => setForm({ ...form, promptVariantB: e.target.value || null })}
            placeholder="Variante B : ton différent ou axe de communication alternatif…"
          />
        </label>
        <small style={{ color: '#888', display: 'block', marginBottom: '8px' }}>
          Si renseigné, la moitié des emails sera générée avec le Prompt B pour comparer les taux de réponse.
        </small>
        {formError && <p className="error">{formError}</p>}
        <button onClick={create} disabled={isSaving}>{isSaving ? 'Création…' : 'Créer'}</button>
      </div>
    </section>
  );
}
