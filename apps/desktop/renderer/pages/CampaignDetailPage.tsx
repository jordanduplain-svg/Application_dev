import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Pencil, Archive, Trash2, ChevronRight,
  Building2, Send, Mail, Percent, Sparkles, Download, Plus, X, Search,
  Briefcase, MapPin, FileText, Euro,
} from 'lucide-react';
import type { Application, Campaign, CampaignInput, Company, Cv } from '@candio/shared';
import { api } from '../lib/api';
import { statusLabel } from '../lib/status';
import { FR_REGIONS, FR_DEPTS_BY_REGION, FR_CITIES, CONTRACT_TYPES } from '../lib/geo';
import PromptHelper from '../components/PromptHelper';
import ConversationThread from '../components/ConversationThread';
import EmailPreviewModal from '../components/EmailPreviewModal';
import {
  isUnverifiedEmail, MANUAL_STATUS_OPTIONS, manualStatusColor, friendlyError,
  EMAIL_RE, PAGE_SIZE_OPTIONS, EMPTY_COMPANY, type CompanyForm,
} from '../lib/campaignDetail';

/**
 * CampaignDetailPage — l'ÉTABLI d'une campagne (la page la plus dense). ROUAGE : c'est d'ici
 * qu'on pilote tout le cycle de vie d'une candidature via les canaux `application:*` et
 * `campaign:*` : ajouter/éditer des entreprises, GÉNÉRER les lettres (IA), prévisualiser,
 * ENVOYER, relancer, régénérer. Comme les envois/générations sont des tâches de fond, la
 * page s'abonne à `task:progress` et se recharge à chaque fin de tâche → l'état suit en direct.
 */
export default function CampaignDetailPage({
  id, onBack, onGoToSettings,
}: {
  id: string;
  onBack: () => void;
  onGoToSettings?: () => void;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  // FM4 : adresse d'envoi du profil — affichée dans le modal de prévisualisation.
  const [senderEmail, setSenderEmail] = useState<string | null>(null);

  // UX-1 : édition inline de la campagne.
  const [isEditingCampaign, setIsEditingCampaign] = useState(false);
  const [campaignForm, setCampaignForm] = useState<CampaignInput | null>(null);
  const [campaignFormError, setCampaignFormError] = useState<string | null>(null);
  const [savingCampaign, setSavingCampaign] = useState(false);
  // CV-MULTI : liste des CV pour le sélecteur d'édition.
  const [cvs, setCvs] = useState<Cv[]>([]);

  // UX-2 : édition inline d'une entreprise.
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyForm, setEditingCompanyForm] = useState<CompanyForm>(EMPTY_COMPANY);
  const [companyEditError, setCompanyEditError] = useState<string | null>(null);

  // UX-8v2 : sélection multiple pour la suppression en masse.
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [companyForm, setCompanyForm] = useState<CompanyForm>(EMPTY_COMPANY);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Application | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const draftBodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // PERF-2 : filtre + recherche des candidatures.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // PERF-1 : pagination des candidatures.
  const [appsPage, setAppsPage] = useState(0);
  const [appsPageSize, setAppsPageSize] = useState(25);
  // UX-3v3 : pagination de la liste des entreprises.
  const [companiesPage, setCompaniesPage] = useState(0);
  const [companiesPageSize, setCompaniesPageSize] = useState(10);
  // Limiter la liste aux N meilleures entreprises (garde les mieux scorées).
  const [limitN, setLimitN] = useState(10);
  const [limiting, setLimiting] = useState(false);
  // Section « Entreprises cibles » repliable, repliée par défaut → priorité à la génération des mails.
  const [showCompanies, setShowCompanies] = useState(false);
  // UX-1v3 : regénération d'un email individuel.
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // UX-7v3 : envoi test d'un email.
  const [sendingTestId, setSendingTestId] = useState<string | null>(null);
  // UX-8v3 : changements non sauvegardés dans le modal.
  const [draftBodyChanged, setDraftBodyChanged] = useState(false);
  // UX : ajout d'entreprise replié par défaut.
  const [showAddCompany, setShowAddCompany] = useState(false);

  // FM7 : toast d'annulation 5s après suppression d'entreprise.
  const [deletedCompany, setDeletedCompany] = useState<{ company: Company; timer: ReturnType<typeof setTimeout> } | null>(null);

  // FM11 : aperçu des emails avant envoi en masse.
  const [sendPreview, setSendPreview] = useState<{ toSend: Application[]; visible: boolean } | null>(null);

  // FM12 : rapport post-envoi (X envoyés, Y en erreur).
  const [sendReport, setSendReport] = useState<string | null>(null);

  // TEST-CAMPAGNE : envoi de test de toute la campagne à soi-même.
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [testAllReport, setTestAllReport] = useState<string | null>(null);

  // (Sélecteur IA extrait dans le composant partagé AiModelSelector.)

  // FM-04 : doublons détectés avant ajout d'une entreprise.
  const [similarCompanies, setSimilarCompanies] = useState<Company[]>([]);
  const [showSimilarWarning, setShowSimilarWarning] = useState(false);

  // FM-06 : chargement du toggle blacklist.
  const [blacklistingId, setBlacklistingId] = useState<string | null>(null);
  // BOUNCE-01 : id de la candidature en cours de retry d'email alternatif.
  const [retryingBounceId, setRetryingBounceId] = useState<string | null>(null);

  // FM-07 : prévisualisation HTML d'un email.
  const [previewAppId, setPreviewAppId] = useState<string | null>(null);

  // UX-S8 : prévisualisation éditable d'une relance avant envoi.
  const [followUpPreview, setFollowUpPreview] = useState<{ id: string; companyName: string; subject: string; body: string } | null>(null);
  const [loadingFollowUpId, setLoadingFollowUpId] = useState<string | null>(null);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  // L'erreur d'envoi de relance s'affiche DANS le modal (sinon masquée derrière l'overlay).
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const previousSentRef = useRef<number>(0);
  const previousFailedRef = useRef<number>(0);
  const pendingSendTotalRef = useRef(0);
  const pendingSendRemainingRef = useRef(0);
  const sendReportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMounted = useRef(true);
  // StrictMode : remettre true au montage (sinon le cleanup laisse false et les
  // setState async sont ignorés).
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  // B6 : ref stable pour la closure dans le listener task:progress.
  const loadRef = useRef<() => Promise<Application[]>>(async () => []);

  useEffect(() => () => {
    if (draftBodyTimer.current) clearTimeout(draftBodyTimer.current);
    if (sendReportTimerRef.current) clearTimeout(sendReportTimerRef.current);
  }, []);


  /**
   * H5 : les 3 appels IPC sont parallélisés (Promise.all).
   * B2 (FM12) : retourne les applications fraîches pour que confirmSendAll
   * puisse calculer le rapport sans dépendre du state React asynchrone.
   */
  const load = useCallback(async (): Promise<Application[]> => {
    try {
      // FM4 : charger le profil en parallèle pour afficher l'adresse d'envoi.
      const [camp, comps, appsResult, prof] = await Promise.all([
        api.invoke('campaign:get', { id }),
        api.invoke('company:listByCampaign', { campaignId: id }),
        // PERF-1v3 : pagination serveur — on charge tout côté renderer pour
        // conserver le filtre/search et la pagination côté renderer.
        // BUG-02 fix : 10000 → 500 ; une campagne réaliste n'a pas plus de 500
        // entreprises et 10000 items en IPC pouvaient dépasser 5 Mo.
        api.invoke('application:listByCampaign', { campaignId: id, page: 0, pageSize: 500 }),
        api.invoke('profile:get'),
      ]);
      if (!isMounted.current) return [];
      setCampaign(camp);
      setSenderEmail(prof?.emailSender ?? null);
      setCompanies(comps);
      setApps(appsResult.items);
      return appsResult.items;
    } catch (e) {
      if (isMounted.current)
        setError(friendlyError(e instanceof Error ? e.message : 'Erreur de chargement'));
      return [];
    }
  }, [id]);

  useEffect(() => { loadRef.current = load; });
  useEffect(() => { void load(); }, [load]);

  const finalizeSendReport = useCallback(async () => {
    const freshApps = await loadRef.current();
    if (!isMounted.current) return;
    const newSent = freshApps.filter((a) => ['SENT', 'REPLIED', 'FOLLOWED_UP'].includes(a.status)).length;
    const newFailed = freshApps.filter((a) => a.status === 'FAILED').length;
    const sentDelta = newSent - previousSentRef.current;
    const failedDelta = Math.max(0, newFailed - previousFailedRef.current);
    setSendReport(`Envoi terminé : ${sentDelta} envoyé(s)${failedDelta > 0 ? `, ${failedDelta} en erreur` : ''}`);
    if (sendReportTimerRef.current) clearTimeout(sendReportTimerRef.current);
    sendReportTimerRef.current = setTimeout(() => {
      if (isMounted.current) setSendReport(null);
    }, 8000);
  }, []);

  useEffect(() => {
    return api.on('task:progress', (p) => {
      if (p.status !== 'running' && (p.type === 'generate-email' || p.type === 'send-email')) {
        void loadRef.current();
      }
      if (p.type === 'send-email' && p.status !== 'running' && pendingSendRemainingRef.current > 0) {
        pendingSendRemainingRef.current--;
        const done = pendingSendTotalRef.current - pendingSendRemainingRef.current;
        if (pendingSendRemainingRef.current > 0) {
          setSendReport(`Envoi en cours (${done}/${pendingSendTotalRef.current})…`);
        } else {
          void finalizeSendReport();
        }
      }
    });
  }, [finalizeSendReport]);

  // UX-8v3 : ref stable pour closeModal dans le listener clavier.
  const closeModalRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { closeModalRef.current = closeModal; });

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void closeModalRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  useEffect(() => {
    if (editing) {
      setDraftBody(editing.body);
      setDraftBodyChanged(false); // UX-8v3 : réinitialiser le flag d'unsaved changes.
    }
  }, [editing?.id]);

  // UX-1 : initialiser le formulaire d'édition de campagne depuis le state courant.
  const startEditCampaign = () => {
    if (!campaign) return;
    setCampaignForm({
      name: campaign.name,
      prompt: campaign.prompt,
      jobTitle: campaign.jobTitle,
      location: campaign.location,
      contractTypes: campaign.contractTypes,
      salaryMin: campaign.salaryMin,
      salaryMax: campaign.salaryMax,
      // B3 : conserver les champs optionnels pour ne pas les écraser à la sauvegarde.
      notes: campaign.notes ?? null,
      availability: campaign.availability ?? null,   // AVAIL : éditable aussi à l'édition
      promptVariantB: campaign.promptVariantB ?? null,
      cvId: campaign.cvId ?? null,   // CV-MULTI : conserve le CV de la campagne
    });
    setCampaignFormError(null);
    setIsEditingCampaign(true);
    // CV-MULTI : charger la liste des CV pour le sélecteur.
    void api.invoke('cv:list').then((list) => { if (isMounted.current) setCvs(list); }).catch(() => {});
  };

  const saveCampaign = async () => {
    if (!campaignForm) return;
    if (!campaignForm.name.trim()) { setCampaignFormError('Le nom est requis'); return; }
    setSavingCampaign(true);
    setCampaignFormError(null);
    try {
      await api.invoke('campaign:update', { id, ...campaignForm });
      if (isMounted.current) setIsEditingCampaign(false);
      await load();
    } catch (e) {
      if (isMounted.current)
        setCampaignFormError(friendlyError(e instanceof Error ? e.message : 'Erreur'));
    } finally {
      if (isMounted.current) setSavingCampaign(false);
    }
  };

  // FM-04 : soumet le formulaire après confirmation des doublons.
  const submitAddCompany = async () => {
    setFormError(null);
    setSimilarCompanies([]);
    setShowSimilarWarning(false);
    try {
      await api.invoke('company:add', { campaignId: id, ...companyForm });
      if (isMounted.current) setCompanyForm(EMPTY_COMPANY);
      await load();
    } catch (e) {
      if (isMounted.current)
        setFormError(friendlyError(e instanceof Error ? e.message : 'Erreur lors de l\'ajout'));
    }
  };

  const addCompany = async () => {
    if (!companyForm.name.trim()) {
      setFormError('Le nom de l\'entreprise est requis'); return;
    }
    if (!EMAIL_RE.test(companyForm.contactEmail)) {
      setFormError('Adresse email invalide'); return;
    }
    setFormError(null);
    // FM-04 : vérifier les doublons potentiels avant d'insérer.
    try {
      const similar = await api.invoke('company:findSimilar', { campaignId: id, name: companyForm.name });
      if (similar.length > 0) {
        setSimilarCompanies(similar);
        setShowSimilarWarning(true);
        return; // Attendre la confirmation de l'utilisateur.
      }
    } catch {
      // En cas d'erreur sur findSimilar, on continue quand même l'ajout.
    }
    await submitAddCompany();
  };

  // FM-06 : toggle blacklist d'une entreprise.
  const toggleBlacklist = async (companyId: string, currentBlacklisted: boolean) => {
    setBlacklistingId(companyId);
    try {
      await api.invoke('company:setBlacklisted', { id: companyId, blacklisted: !currentBlacklisted });
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Erreur'));
    } finally {
      if (isMounted.current) setBlacklistingId(null);
    }
  };

  // UX-2 : démarrer l'édition d'une entreprise.
  const startEditCompany = (c: Company) => {
    setEditingCompanyId(c.id);
    setEditingCompanyForm({
      name: c.name,
      website: c.website,
      contactEmail: c.contactEmail,
      contactName: c.contactName,
      contactRole: c.contactRole,
    });
    setCompanyEditError(null);
  };

  const saveCompany = async () => {
    if (!editingCompanyId) return;
    if (!editingCompanyForm.name.trim()) { setCompanyEditError('Le nom est requis'); return; }
    if (!EMAIL_RE.test(editingCompanyForm.contactEmail)) { setCompanyEditError('Email invalide'); return; }
    setCompanyEditError(null);
    try {
      await api.invoke('company:update', { id: editingCompanyId, ...editingCompanyForm });
      if (isMounted.current) setEditingCompanyId(null);
      await load();
    } catch (e) {
      if (isMounted.current)
        setCompanyEditError(friendlyError(e instanceof Error ? e.message : 'Erreur'));
    }
  };

  const importCsv = async () => {
    if (isImporting) return;
    setIsImporting(true);
    setImportMessage(null);
    try {
      const result = await api.invoke('company:importCsv', { campaignId: id });
      setImportMessage(`${result.added} entreprise(s) ajoutée(s), ${result.skipped} ignorée(s).`);
      await load();
    } catch (e) {
      setImportMessage(`Erreur : ${friendlyError(e instanceof Error ? e.message : 'Erreur lors de l\'import CSV')}`);
    } finally {
      if (isMounted.current) setIsImporting(false);
    }
  };

  // UX-3 : télécharger le modèle CSV.
  const downloadCsvTemplate = async () => {
    try {
      await api.invoke('company:downloadCsvTemplate');
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Erreur'));
    }
  };

  const deleteCompany = async (companyId: string) => {
    // BUG-03 fix : bloquer la suppression si un envoi est en cours pour cette entreprise.
    // Supprimer pendant SENDING interromprait la tâche et laisserait la DB dans un état incohérent.
    const relatedApp = apps.find((a) => a.companyId === companyId);
    if (relatedApp?.status === 'SENDING') {
      setError('Un envoi est en cours pour cette entreprise — attendez la fin avant de supprimer.');
      return;
    }

    const confirmed = await api.invoke('dialog:confirm', {
      title: 'Supprimer l\'entreprise',
      message: 'Êtes-vous sûr de vouloir supprimer cette entreprise ? Sa candidature sera également supprimée.',
    });
    if (!confirmed) return;
    if (editing && apps.find((a) => a.companyId === companyId && a.id === editing.id)) {
      setEditing(null);
    }

    // FM7 : mémoriser les données avant suppression pour permettre l'annulation.
    const companyToDelete = companies.find((c) => c.id === companyId);

    try {
      await api.invoke('company:delete', { id: companyId });
      await load();

      // FM7 : afficher le toast d'annulation pendant 5 secondes.
      if (companyToDelete && isMounted.current) {
        // Annuler le toast précédent s'il existe encore.
        if (deletedCompany) clearTimeout(deletedCompany.timer);
        const timer = setTimeout(() => {
          if (isMounted.current) setDeletedCompany(null);
        }, 5000);
        setDeletedCompany({ company: companyToDelete, timer });
      }
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Erreur lors de la suppression'));
    }
  };

  // FM7 : re-créer l'entreprise supprimée (annulation dans les 5s).
  const undoDeleteCompany = async () => {
    if (!deletedCompany) return;
    clearTimeout(deletedCompany.timer);
    const { company } = deletedCompany;
    setDeletedCompany(null);
    try {
      await api.invoke('company:add', {
        campaignId: id,
        name: company.name,
        website: company.website,
        contactEmail: company.contactEmail,
        contactName: company.contactName,
        contactRole: company.contactRole,
      });
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Impossible de restaurer l\'entreprise'));
    }
  };

  // UX-8v2 : toggle la sélection d'une entreprise.
  const toggleCompanySelection = (companyId: string) => {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  };

  // UX-8v2 : suppression en masse des entreprises sélectionnées.
  const bulkDeleteCompanies = async () => {
    const ids = [...selectedCompanyIds];
    if (ids.length === 0) return;

    // AUDIT-C1 fix : même garde que deleteCompany — bloquer si un envoi est en cours
    // pour l'une des entreprises sélectionnées (état DB incohérent sinon).
    const hasSending = apps.some(
      (a) => ids.includes(a.companyId) && a.status === 'SENDING'
    );
    if (hasSending) {
      setError('Un envoi est en cours pour une entreprise sélectionnée — attendez la fin avant de supprimer.');
      return;
    }

    const confirmed = await api.invoke('dialog:confirm', {
      title: 'Supprimer les entreprises sélectionnées',
      message: `Supprimer ${ids.length} entreprise(s) et leurs candidatures associées ?`,
    });
    if (!confirmed) return;
    setBulkDeleting(true);
    try {
      await api.invoke('company:bulkDelete', { ids });
      setSelectedCompanyIds(new Set());
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Erreur lors de la suppression'));
    } finally {
      setBulkDeleting(false);
    }
  };

  // Limite la liste aux N meilleures entreprises (par score pertinence + fraîcheur).
  // Supprime les entreprises en trop SAUF celles déjà contactées (protégées côté service).
  const PROTECTED_STATUSES = new Set(['SENDING', 'SENT', 'REPLIED', 'FOLLOWED_UP']);
  const limitCompanies = async () => {
    const n = Math.max(1, Math.floor(limitN));
    if (companies.length <= n) {
      setError(`Cette campagne a déjà ${companies.length} entreprise(s) — rien à supprimer.`);
      return;
    }
    const protectedIds = new Set(apps.filter((a) => PROTECTED_STATUSES.has(a.status)).map((a) => a.companyId));
    const score = (c: Company) => (c.relevanceScore ?? 0) + (c.freshnessScore ?? 0);
    const keep = new Set([...companies].sort((a, b) => score(b) - score(a)).slice(0, n).map((c) => c.id));
    const toDelete = companies.filter((c) => !keep.has(c.id) && !protectedIds.has(c.id)).map((c) => c.id);
    if (toDelete.length === 0) {
      setError('Rien à supprimer : les entreprises en trop sont déjà contactées (conservées).');
      return;
    }
    const ok = await api.invoke('dialog:confirm', {
      title: 'Limiter la liste d\'entreprises',
      message: `Garder les ${n} meilleures entreprises (par pertinence) et supprimer ${toDelete.length} autre(s) ? Les entreprises déjà contactées sont conservées. Action irréversible.`,
    });
    if (!ok) return;
    setLimiting(true);
    try {
      await api.invoke('company:bulkDelete', { ids: toDelete });
      setSelectedCompanyIds(new Set());
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Erreur lors de la limitation'));
    } finally {
      setLimiting(false);
    }
  };

  // UX-6 : archivage d'une campagne.
  const archiveCampaign = async () => {
    const confirmed = await api.invoke('dialog:confirm', {
      title: 'Archiver la campagne',
      message: 'La campagne sera archivée et n\'apparaîtra plus dans la liste. Vous pourrez la retrouver dans vos données.',
    });
    if (!confirmed) return;
    try {
      await api.invoke('campaign:archive', { id });
      onBack();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Impossible d\'archiver la campagne'));
    }
  };

  const deleteCampaign = async () => {
    const hasSending = apps.some((a) => a.status === 'SENDING');
    if (hasSending) {
      setError('Des candidatures sont en cours d\'envoi — attendez la fin avant de supprimer.');
      return;
    }
    const confirmed = await api.invoke('dialog:confirm', {
      title: 'Supprimer la campagne',
      message: 'Êtes-vous sûr de vouloir supprimer cette campagne ? Toutes les entreprises et candidatures associées seront supprimées. Cette action est irréversible.',
    });
    if (!confirmed) return;
    try {
      await api.invoke('campaign:delete', { id });
      onBack();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Impossible de supprimer la campagne'));
    }
  };

  // UX-9 : export CSV des candidatures.
  const exportCsv = async () => {
    try {
      await api.invoke('campaign:exportCsv', { id });
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Erreur lors de l\'export'));
    }
  };

  const safe = async (fn: () => Promise<unknown>) => {
    if (isMounted.current) setError(null);
    try { await fn(); }
    catch (e) {
      if (isMounted.current)
        setError(friendlyError(e instanceof Error ? e.message : 'Erreur inconnue'));
    }
  };

  const generate = async () => {
    setIsGenerating(true);
    await safe(() => api.invoke('application:generate', { campaignId: id }));
    if (isMounted.current) setIsGenerating(false);
  };

  // Régénère TOUTES les lettres (brouillons + échecs + sans lettre) — écrase pour
  // réappliquer le prompt courant. Ne touche jamais aux candidatures envoyées.
  const regenerateAll = async () => {
    const drafts = apps.filter((a) => a.status === 'DRAFT' || a.status === 'FAILED');
    const ok = await api.invoke('dialog:confirm', {
      title: 'Régénérer toutes les lettres',
      message: `Régénérer (écraser) ${drafts.length} brouillon(s)/échec(s) + générer les manquantes avec le prompt actuel ? Les candidatures déjà envoyées ne sont pas touchées.`,
    });
    if (!ok) return;
    setIsGenerating(true);
    try {
      const r = await api.invoke('application:regenerateAll', { campaignId: id });
      if (r.enqueued === 0) setError('Aucune lettre à régénérer (toutes déjà envoyées ?).');
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Erreur lors de la régénération'));
    } finally {
      if (isMounted.current) setIsGenerating(false);
    }
  };

  // UX-2v3 / FM11 : aperçu avant "Tout envoyer".
  const sendAll = async () => {
    const drafts = apps.filter((a) => a.status === 'DRAFT' || a.status === 'FAILED');
    if (drafts.length === 0) { setError('Aucun brouillon ou échec à envoyer.'); return; }
    // FM11 : afficher l'aperçu au lieu du dialog natif.
    setSendPreview({ toSend: drafts, visible: true });
  };

  // FM11 : confirmer l'envoi depuis l'aperçu.
  const confirmSendAll = async () => {
    const toSend = sendPreview?.toSend ?? [];
    const draftCount = toSend.length;
    setSendPreview(null);
    previousSentRef.current = apps.filter((a) => ['SENT', 'REPLIED', 'FOLLOWED_UP'].includes(a.status)).length;
    previousFailedRef.current = apps.filter((a) => a.status === 'FAILED').length;
    pendingSendTotalRef.current = draftCount;
    pendingSendRemainingRef.current = draftCount;
    setIsSendingAll(true);
    if (draftCount > 0) {
      setSendReport(`Envoi en cours (0/${draftCount})…`);
    }
    await safe(() => api.invoke('application:sendAll', { campaignId: id }));
    if (isMounted.current) {
      setIsSendingAll(false);
      if (draftCount === 0 || pendingSendRemainingRef.current === 0) {
        await finalizeSendReport();
      }
    }
  };

  const sendOne = async (appId: string) => {
    setSendingId(appId);
    await safe(() => api.invoke('application:send', { id: appId }));
    if (isMounted.current) setSendingId(null);
  };

  // Envoi FORCÉ d'un email « à vérifier » (pattern deviné) — décision explicite de
  // l'utilisateur, confirmée une fois (risque de bounce assumé), pas un défaut.
  const sendUnverified = async (app: Application) => {
    const ok = await api.invoke('dialog:confirm', {
      title: 'Envoyer un email non vérifié ?',
      message: `L'adresse ${app.contactEmail} a été devinée automatiquement (non confirmée) ` +
        `et risque de rebondir. Envoyer quand même à ${app.companyName} ?`,
    });
    if (!ok) return;
    setSendingId(app.id);
    await safe(() => api.invoke('application:send', { id: app.id, force: true }));
    if (isMounted.current) setSendingId(null);
  };

  // UX-1v3 : regénère un email unique.
  const regenerateOne = async (appId: string) => {
    setRegeneratingId(appId);
    await safe(() => api.invoke('application:regenerateOne', { id: appId }));
    if (isMounted.current) setRegeneratingId(null);
    await load();
  };

  // BOUNCE-01 : passe à l'email alternatif suivant pour une candidature rebondie.
  const retryBounce = async (app: Application) => {
    setRetryingBounceId(app.id);
    try {
      const result = await api.invoke('company:retryWithAlternativeEmail', { companyId: app.companyId });
      if (result) {
        await load();
      } else {
        setError('Aucun email alternatif disponible pour cette entreprise.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (isMounted.current) setRetryingBounceId(null);
  };

  // UX-7v3 : envoie un email test à soi-même.
  const sendTest = async (appId: string) => {
    setSendingTestId(appId);
    await safe(() => api.invoke('application:sendTest', { id: appId }));
    if (isMounted.current) setSendingTestId(null);
  };

  // UX-S8 : génère l'aperçu de la relance (sans envoyer) et ouvre le modal éditable.
  const openFollowUpPreview = async (a: Application) => {
    setLoadingFollowUpId(a.id);
    setFollowUpError(null);
    try {
      const { subject, body } = await api.invoke('application:previewFollowUp', { id: a.id });
      if (isMounted.current) setFollowUpPreview({ id: a.id, companyName: a.companyName, subject, body });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la génération de la relance');
    } finally {
      if (isMounted.current) setLoadingFollowUpId(null);
    }
  };

  // UX-S8 : envoie la relance avec le corps (éventuellement édité) affiché dans le modal.
  const confirmFollowUp = async () => {
    if (!followUpPreview) return;
    setSendingFollowUp(true);
    setFollowUpError(null);
    try {
      await api.invoke('application:sendFollowUpWithBody', {
        id: followUpPreview.id, subject: followUpPreview.subject, body: followUpPreview.body,
      });
      if (isMounted.current) setFollowUpPreview(null);
      await load();
    } catch (e) {
      // Affiché dans le modal (l'overlay masque le bandeau d'erreur de la page).
      if (isMounted.current) setFollowUpError(e instanceof Error ? e.message : 'Erreur lors de l\'envoi de la relance');
    } finally {
      if (isMounted.current) setSendingFollowUp(false);
    }
  };

  // TEST-CAMPAGNE : s'envoie en test tous les brouillons/échecs de la campagne.
  const sendTestAll = async () => {
    const drafts = apps.filter((a) => a.status === 'DRAFT' || a.status === 'FAILED');
    if (drafts.length === 0) { setError('Aucun brouillon ou échec à tester.'); return; }
    const ok = await api.invoke('dialog:confirm', {
      title: 'Tester toute la campagne',
      message: `Vous allez recevoir ${drafts.length} email(s) de test sur votre propre adresse (rien n'est envoyé aux entreprises). Continuer ?`,
    });
    if (!ok) return;
    setIsTestingAll(true);
    setTestAllReport(null);
    try {
      const r = await api.invoke('application:sendTestAll', { campaignId: id });
      setTestAllReport(`${r.sent}/${r.total} email(s) de test envoyé(s) sur votre adresse — vérifiez votre boîte de réception.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du test de campagne');
    } finally {
      if (isMounted.current) setIsTestingAll(false);
    }
  };

  // UX-8v3 : fermer le modal avec avertissement si modifications non sauvegardées.
  const closeModal = async () => {
    if (draftBodyChanged) {
      const confirmed = await api.invoke('dialog:confirm', {
        title: 'Modifications non sauvegardées',
        message: 'Des modifications non sauvegardées seront perdues. Continuer ?',
      });
      if (!confirmed) return;
    }
    setEditing(null);
    setDraftBodyChanged(false);
  };

  // N4 : fermeture de la modale d'édition à Échap (a11y).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draftBodyChanged]);

  // UX-4v3 : mise à jour du statut manuel post-réponse.
  const setManualStatus = async (appId: string, status: string | null) => {
    await safe(() => api.invoke('application:setManualStatus', { id: appId, manualStatus: status || null }));
    await load();
  };

  const saveDraft = async () => {
    if (!editing) return;
    try {
      await api.invoke('application:updateDraft', {
        id: editing.id, subject: editing.subject, body: draftBody,
      });
      if (isMounted.current) {
        setEditing(null);
        setDraftBodyChanged(false); // UX-8v3 : réinitialiser après sauvegarde réussie.
      }
      await load();
    } catch (e) {
      if (isMounted.current)
        setError(friendlyError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde'));
    }
  };

  const handleBodyChange = (value: string) => {
    setDraftBody(value);
    setDraftBodyChanged(true); // UX-8v3 : marquer comme modifié.
    if (draftBodyTimer.current) clearTimeout(draftBodyTimer.current);
    draftBodyTimer.current = setTimeout(() => {
      setEditing((prev) => prev ? { ...prev, body: value } : null);
    }, 300);
  };

  // PERF-2 : filtre des candidatures.
  const filteredApps = apps.filter((a) => {
    const matchSearch = !search ||
      a.companyName.toLowerCase().includes(search.toLowerCase()) ||
      a.subject.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // PERF-1 : pagination des candidatures filtrées.
  const totalAppPages = Math.max(1, Math.ceil(filteredApps.length / appsPageSize));
  const paginatedApps = filteredApps.slice(appsPage * appsPageSize, (appsPage + 1) * appsPageSize);

  // UX-3v3 : pagination de la liste des entreprises.
  const totalCompanyPages = Math.max(1, Math.ceil(companies.length / companiesPageSize));
  const paginatedCompanies = companies.slice(
    companiesPage * companiesPageSize,
    (companiesPage + 1) * companiesPageSize,
  );

  // UX-5 : statistiques calculées côté renderer.
  const totalCompanies = companies.length;
  const totalSent = apps.filter((a) => ['SENT', 'REPLIED', 'FOLLOWED_UP'].includes(a.status)).length;
  const totalReplied = apps.filter((a) => a.status === 'REPLIED').length;
  const replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  // UX-12 : candidatures éligibles à une relance (SENT > 7 jours, pas de réponse).
  const sevenDaysAgo = Date.now() - 7 * 864e5;
  const isFollowUpEligible = (a: Application) =>
    a.status === 'SENT' && a.sentAt !== null && new Date(a.sentAt).getTime() < sevenDaysAgo;

  if (!campaign) return <p>{error ?? 'Chargement…'}</p>;

  return (
    <section>
      <div className="detail-head">
        <button className="btn-back" onClick={onBack}>
          <ArrowLeft size={15} style={{ verticalAlign: '-2px', marginRight: '4px' }} />Retour
        </button>
        <div className="detail-actions">
          {/* UX-1 : bouton Modifier la campagne. */}
          <button onClick={startEditCampaign} className="btn-secondary"><Pencil size={14} />Modifier</button>
          {/* UX-6 : bouton Archiver. */}
          <button onClick={archiveCampaign} className="btn-secondary"><Archive size={14} />Archiver</button>
          <button onClick={deleteCampaign} className="btn-danger"><Trash2 size={14} />Supprimer</button>
        </div>
      </div>

      <h2 className="detail-title">
        {campaign.name}
        {/* UX-7 : statut en français. */}
        <span className={`status status-${campaign.status.toLowerCase()}`}>{statusLabel(campaign.status)}</span>
      </h2>
      <div className="meta-chips">
        <span className="meta-chip"><Briefcase size={14} />{campaign.jobTitle}</span>
        <span className="meta-chip"><MapPin size={14} />{campaign.location || 'Toute la France'}</span>
        {campaign.contractTypes.length > 0 && (
          <span className="meta-chip"><FileText size={14} />{campaign.contractTypes.join(', ')}</span>
        )}
        {(campaign.salaryMin !== null || campaign.salaryMax !== null) && (
          <span className="meta-chip"><Euro size={14} />{campaign.salaryMin ?? '?'} – {campaign.salaryMax ?? '?'} €</span>
        )}
      </div>
      {/* UX-9v3 : notes de la campagne (2 lignes max) dans l'en-tête. */}
      {campaign.notes && (
        <p style={{
          fontSize: '13px', color: '#555',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
          marginTop: '4px', marginBottom: '8px',
          borderLeft: '3px solid #007aff', paddingLeft: '8px',
        }}>
          {campaign.notes}
        </p>
      )}

      {/* UX-1 : formulaire d'édition inline de la campagne. */}
      {isEditingCampaign && campaignForm && (
        <div className="form" style={{ background: '#f8f9fa', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
          <h4>Modifier la campagne</h4>
          <label>Nom
            <input value={campaignForm.name}
              onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
          </label>
          <label>Intitulé du poste
            <input value={campaignForm.jobTitle}
              onChange={(e) => setCampaignForm({ ...campaignForm, jobTitle: e.target.value })} />
          </label>
          {/* CV-MULTI : CV utilisé pour cette campagne. */}
          <label>CV utilisé
            <select value={campaignForm.cvId ?? ''}
              onChange={(e) => setCampaignForm({ ...campaignForm, cvId: e.target.value || null })}>
              <option value="">— Choisir un CV —</option>
              {cvs.map((cv) => (
                <option key={cv.id} value={cv.id}>
                  {cv.name}{cv.parsed ? '' : ' (PDF non analysé)'}
                </option>
              ))}
            </select>
          </label>
          <label>Lieu
            <select value={campaignForm.location}
              onChange={(e) => setCampaignForm({ ...campaignForm, location: e.target.value })}>
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
          <label>Types de contrat
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
              {CONTRACT_TYPES.map((ct) => {
                const active = campaignForm.contractTypes.includes(ct);
                return (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => setCampaignForm({
                      ...campaignForm,
                      contractTypes: active
                        ? campaignForm.contractTypes.filter((c) => c !== ct)
                        : [...campaignForm.contractTypes, ct],
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
          <label>Salaire min (€)
            <input type="number" min={0} step={1000} value={campaignForm.salaryMin ?? ''}
              onChange={(e) => setCampaignForm({
                ...campaignForm, salaryMin: e.target.value ? Math.max(0, Number(e.target.value)) : null,
              })} />
          </label>
          <label>Salaire max (€)
            <input type="number" min={0} step={1000} value={campaignForm.salaryMax ?? ''}
              onChange={(e) => setCampaignForm({
                ...campaignForm, salaryMax: e.target.value ? Math.max(0, Number(e.target.value)) : null,
              })} />
          </label>
          {/* AVAIL : disponibilité recopiée telle quelle dans la lettre (évite les dates inventées). */}
          <label>Disponibilité
            <input
              value={campaignForm.availability ?? ''}
              onChange={(e) => setCampaignForm({ ...campaignForm, availability: e.target.value || null })}
              placeholder="Ex : début octobre 2026, dès maintenant, sous 1 mois…"
            />
            <span style={{ fontSize: '11px', color: '#888', display: 'block', marginTop: '4px' }}>
              Recopiée telle quelle dans la lettre — l'IA n'inventera plus de date.
            </span>
          </label>
          {/* PROMPT-HELPER : assistant repliable (génère Prompt A + B). */}
          <PromptHelper
            cvId={campaignForm.cvId}
            jobTitle={campaignForm.jobTitle}
            contractInfo={[
              campaignForm.contractTypes.length ? `Type(s) de contrat : ${campaignForm.contractTypes.join(', ')}` : '',
              (campaignForm.availability ?? '').trim() ? `disponibilité : ${(campaignForm.availability ?? '').trim()}` : '',
            ].filter(Boolean).join(' · ')}
            onGenerate={(promptA, promptB) =>
              setCampaignForm({ ...campaignForm, prompt: promptA, promptVariantB: promptB })
            }
          />
          <label>Prompt A — consignes pour l'IA
            <textarea rows={4} value={campaignForm.prompt}
              onChange={(e) => setCampaignForm({ ...campaignForm, prompt: e.target.value })} />
          </label>
          <label>Prompt B (optionnel — test A/B)
            <textarea rows={3} value={campaignForm.promptVariantB ?? ''}
              onChange={(e) => setCampaignForm({ ...campaignForm, promptVariantB: e.target.value || null })}
              placeholder="Variante B : angle différent (motivation/adéquation)…" />
          </label>
          {campaignFormError && <p className="error">{campaignFormError}</p>}
          <div>
            <button onClick={saveCampaign} disabled={savingCampaign}>
              {savingCampaign ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button onClick={() => setIsEditingCampaign(false)}>Annuler</button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {/* FM7 : toast d'annulation après suppression d'entreprise. */}
      {deletedCompany && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#333', color: '#fff', borderRadius: '6px',
          padding: '10px 16px', zIndex: 1000, display: 'flex', gap: '12px', alignItems: 'center',
          fontSize: '13px', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}>
          <span>Entreprise « {deletedCompany.company.name} » supprimée</span>
          <button
            onClick={undoDeleteCompany}
            style={{ background: '#007aff', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer' }}
          >
            Annuler (5s)
          </button>
        </div>
      )}

      {/* UX-5 : bandeau de statistiques en cartes métriques compactes. */}
      <div className="metric-grid">
        <div className="metric sm" style={{ '--m': '#378ADD' } as React.CSSProperties}>
          <div className="metric-ico"><Building2 size={16} /></div>
          <div className="metric-num">{totalCompanies}</div>
          <div className="metric-lbl">Entreprises ciblées</div>
        </div>
        <div className="metric sm" style={{ '--m': '#ff9f0a' } as React.CSSProperties}>
          <div className="metric-ico"><Send size={16} /></div>
          <div className="metric-num">{totalSent} <span style={{ fontSize: '15px', color: 'var(--text-sub)', fontWeight: 600 }}>/ {apps.length}</span></div>
          <div className="metric-lbl">Candidatures envoyées</div>
        </div>
        <div className="metric sm" style={{ '--m': '#1D9E75' } as React.CSSProperties}>
          <div className="metric-ico"><Mail size={16} /></div>
          <div className="metric-num">{totalReplied}</div>
          <div className="metric-lbl">Réponses reçues</div>
        </div>
        <div className="metric sm" style={{ '--m': '#0F6E56' } as React.CSSProperties}>
          <div className="metric-ico"><Percent size={16} /></div>
          <div className="metric-num">{replyRate}%</div>
          <div className="metric-lbl">Taux de réponse</div>
        </div>
      </div>

      <h3 className={`section-toggle${showCompanies ? ' open' : ''}`} onClick={() => setShowCompanies((v) => !v)}>
        <ChevronRight className="chev" size={18} />
        <Building2 size={16} style={{ color: 'var(--text-sub)' }} />
        Entreprises cibles
        <span className="toggle-count">
          {companies.length} entreprise{companies.length > 1 ? 's' : ''} · {showCompanies ? 'masquer' : 'afficher / gérer'}
        </span>
      </h3>

      {showCompanies && (
      <>
      {/* Limiter la liste : garde les N meilleures entreprises, supprime le reste. */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-sub)' }}>Limiter à</span>
        <input
          type="number" min={1} value={limitN}
          onChange={(e) => setLimitN(Number(e.target.value))}
          style={{ width: '64px' }}
        />
        <span style={{ fontSize: '13px', color: 'var(--text-sub)' }}>entreprises à contacter</span>
        <button onClick={limitCompanies} disabled={limiting} className="btn-secondary" style={{ fontSize: '12px' }}
          title="Garde les N entreprises les mieux scorées (pertinence + fraîcheur) et supprime les autres. Les entreprises déjà contactées sont conservées.">
          {limiting ? 'Application…' : 'Garder les meilleures'}
        </button>
      </div>

      {/* UX-8v2 : barre d'actions groupées (visible si au moins une sélection). */}
      {selectedCompanyIds.size > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px' }}>{selectedCompanyIds.size} sélectionnée(s)</span>
          <button
            onClick={bulkDeleteCompanies}
            disabled={bulkDeleting}
            style={{ background: '#ff453a', color: '#fff', fontSize: '12px' }}
          >
            {bulkDeleting ? 'Suppression…' : 'Supprimer la sélection'}
          </button>
          <button
            onClick={() => setSelectedCompanyIds(new Set())}
            style={{ fontSize: '12px' }}
          >
            Désélectionner tout
          </button>
        </div>
      )}

      <div className="table-wrap wide">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: 0 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #e0e0e0', color: '#555' }}>
            <th style={{ padding: '6px 8px', width: '28px' }}></th>
            <th style={{ padding: '6px 8px' }}>Entreprise</th>
            <th style={{ padding: '6px 8px' }}>Email</th>
            <th style={{ padding: '6px 8px' }}>Contact</th>
            <th style={{ padding: '6px 8px' }}>Lieu / secteur</th>
            <th style={{ padding: '6px 8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedCompanies.map((c) => (
            editingCompanyId === c.id ? (
              <tr key={c.id}>
                <td colSpan={6} style={{ padding: '8px' }}>
                  <div className="form" style={{ padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
                    <input placeholder="Nom" value={editingCompanyForm.name}
                      onChange={(e) => setEditingCompanyForm({ ...editingCompanyForm, name: e.target.value })} />
                    <input type="email" placeholder="Email" value={editingCompanyForm.contactEmail}
                      onChange={(e) => setEditingCompanyForm({ ...editingCompanyForm, contactEmail: e.target.value })} />
                    <input placeholder="Nom du contact" value={editingCompanyForm.contactName ?? ''}
                      onChange={(e) => setEditingCompanyForm({ ...editingCompanyForm, contactName: e.target.value || null })} />
                    <input placeholder="Rôle du contact" value={editingCompanyForm.contactRole ?? ''}
                      onChange={(e) => setEditingCompanyForm({ ...editingCompanyForm, contactRole: e.target.value || null })} />
                    <input placeholder="Site web" value={editingCompanyForm.website ?? ''}
                      onChange={(e) => setEditingCompanyForm({ ...editingCompanyForm, website: e.target.value || null })} />
                    {companyEditError && <p className="error">{companyEditError}</p>}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button onClick={saveCompany}>Enregistrer</button>
                      <button onClick={() => setEditingCompanyId(null)}>Annuler</button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={c.id} style={{ borderBottom: '1px solid #eee', opacity: c.blacklisted ? 0.55 : 1 }}>
                <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                  <input type="checkbox" checked={selectedCompanyIds.has(c.id)}
                    onChange={() => toggleCompanySelection(c.id)} aria-label={`Sélectionner ${c.name}`} />
                </td>
                <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                  <strong>{c.name}</strong>
                  {c.blacklisted && <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: '#666', color: '#fff', marginLeft: '4px' }}>Blacklisté</span>}
                  {(c.freshnessScore > 0 || c.relevanceScore > 0) && (
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '3px' }}>
                      {c.freshnessScore > 0 && <span title="Fraîcheur" style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '6px', background: '#34c75922', color: '#1a7a3a' }}>⏱ {c.freshnessScore}</span>}
                      {c.relevanceScore > 0 && <span title="Pertinence" style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '6px', background: '#007aff22', color: '#004799' }}>🎯 {c.relevanceScore}</span>}
                    </div>
                  )}
                </td>
                <td style={{ padding: '6px 8px', verticalAlign: 'top', wordBreak: 'break-all' }}>{c.contactEmail}</td>
                <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{c.contactName ? `${c.contactName}${c.contactRole ? ` · ${c.contactRole}` : ''}` : '—'}</td>
                <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                    {(c.city || c.deptName || c.regionAdmin) && <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '6px', background: '#34c75922', color: '#1a7a3a' }}>📍 {c.city || c.deptName || c.regionAdmin}{c.dept ? ` (${c.dept})` : ''}</span>}
                    {c.sector && <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '6px', background: '#007aff22', color: '#004799' }}>🏢 {c.sector}</span>}
                    {c.companySizeBucket && <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '6px', background: '#bf5af222', color: '#6b2a8a' }}>👥 {c.companySizeBucket}</span>}
                    {!(c.city || c.deptName || c.regionAdmin || c.sector || c.companySizeBucket) && <span style={{ color: '#bbb' }}>—</span>}
                  </div>
                </td>
                <td style={{ padding: '6px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <button onClick={() => toggleBlacklist(c.id, c.blacklisted)} disabled={blacklistingId === c.id} title={c.blacklisted ? 'Retirer de la blacklist' : 'Blacklister'} style={{ fontSize: '13px', padding: '2px 6px' }}>{c.blacklisted ? '✅' : '🚫'}</button>{' '}
                  <button onClick={() => startEditCompany(c)} style={{ fontSize: '12px' }}>Modifier</button>{' '}
                  <button onClick={() => deleteCompany(c.id)} style={{ fontSize: '12px' }}>Supprimer</button>
                </td>
              </tr>
            )
          ))}
          {companies.length === 0 && (
            <tr><td colSpan={6} style={{ padding: '10px 8px', color: '#888' }}>Aucune entreprise cible.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {/* UX-3v3 : pagination + sélecteur de taille de page (entreprises). */}
      <div style={{ display: 'flex', gap: '8px', margin: '8px 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '12px', color: '#555' }}>
          Afficher{' '}
          <select value={companiesPageSize}
            onChange={(e) => { setCompaniesPageSize(Number(e.target.value)); setCompaniesPage(0); }}>
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>{' '}par page
        </label>
        {totalCompanyPages > 1 && (
          <>
            <button onClick={() => setCompaniesPage((p) => Math.max(0, p - 1))} disabled={companiesPage === 0}>← Précédent</button>
            <span>Page {companiesPage + 1} / {totalCompanyPages}</span>
            <button onClick={() => setCompaniesPage((p) => Math.min(totalCompanyPages - 1, p + 1))} disabled={companiesPage >= totalCompanyPages - 1}>Suivant →</button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowAddCompany((v) => !v)}
        className={showAddCompany ? 'btn-secondary' : ''}
        style={{ marginTop: '4px', marginBottom: '8px' }}
      >
        {showAddCompany
          ? <><X size={15} />Fermer le formulaire</>
          : <><Plus size={15} />Ajouter une entreprise</>}
      </button>
      {showAddCompany && (
      <div className="form">
        <input placeholder="Nom de l'entreprise"
               value={companyForm.name}
               onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
        <input type="email" placeholder="Email du contact"
               value={companyForm.contactEmail}
               onChange={(e) => setCompanyForm({ ...companyForm, contactEmail: e.target.value })} />
        <input placeholder="Nom du contact (optionnel)"
               value={companyForm.contactName ?? ''}
               onChange={(e) => setCompanyForm({ ...companyForm, contactName: e.target.value || null })} />
        <input placeholder="Rôle du contact (optionnel)"
               value={companyForm.contactRole ?? ''}
               onChange={(e) => setCompanyForm({ ...companyForm, contactRole: e.target.value || null })} />
        <input placeholder="Site web (optionnel)"
               value={companyForm.website ?? ''}
               onChange={(e) => setCompanyForm({ ...companyForm, website: e.target.value || null })} />
        {formError && <p className="error">{formError}</p>}
        <div>
          <button onClick={addCompany}>Ajouter</button>
          <button onClick={importCsv} disabled={isImporting}>
            {isImporting ? 'Import…' : 'Importer un CSV…'}
          </button>
          {/* UX-3 : bouton Télécharger le modèle CSV. */}
          <button onClick={downloadCsvTemplate}>Télécharger le modèle CSV</button>
        </div>
        {importMessage && <p>{importMessage}</p>}

        {/* FM-04 : avertissement de doublon potentiel. */}
        {showSimilarWarning && (
          <div style={{ marginTop: '8px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', padding: '10px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '13px' }}>
              ⚠️ Entreprise similaire existante : <strong>{similarCompanies.map((c) => c.name).join(', ')}</strong>. Continuer quand même ?
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={submitAddCompany} style={{ background: '#ffc107', color: '#000' }}>Oui, ajouter</button>
              <button onClick={() => { setShowSimilarWarning(false); setSimilarCompanies([]); }}>Annuler</button>
            </div>
          </div>
        )}
      </div>
      )}
      </>
      )}

      <h3>Candidatures ({apps.length})</h3>

      {/* Le choix du moteur IA est centralisé sur la page Accueil. */}

      {/* Barre d'actions ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={generate} disabled={isGenerating}>
          <Sparkles size={15} />
          {isGenerating ? 'Génération…' : 'Générer les emails manquants'}
        </button>
        <button onClick={regenerateAll} disabled={isGenerating} className="btn-secondary"
          title="Régénère (écrase) tous les brouillons + génère les manquants avec le prompt actuel. N'affecte pas les candidatures déjà envoyées.">
          <Sparkles size={15} />
          {isGenerating ? 'Génération…' : 'Régénérer toutes les lettres'}
        </button>
        {/* TEST-CAMPAGNE : envoi de test de tous les brouillons à soi-même. */}
        <button onClick={sendTestAll} disabled={isTestingAll || isSendingAll} className="btn-secondary" title="S'envoyer tous les brouillons en test (rendu + CV) sans rien envoyer aux entreprises">
          <Send size={15} />{isTestingAll ? 'Test en cours…' : 'Tester (m\'envoyer les brouillons)'}
        </button>
        {/* UX-9 : export CSV. */}
        <button onClick={exportCsv} className="btn-secondary"><Download size={15} />Exporter en CSV</button>
        {/* Envoi RÉEL aux entreprises — isolé à DROITE (marginLeft:auto) pour le distinguer
            nettement du bouton « Tester », trop facile à confondre auparavant. */}
        <button onClick={sendAll} disabled={isSendingAll} className="btn-success" style={{ marginLeft: 'auto' }}>
          <Send size={15} />
          {isSendingAll ? 'Envoi en cours…' : 'Envoyer Candidature'}
        </button>
      </div>

      {/* TEST-CAMPAGNE : rapport du test de campagne. */}
      {testAllReport && (
        <div style={{
          background: '#eef6ff', border: '1px solid #5ac8fa', borderRadius: '6px',
          padding: '10px 16px', marginBottom: '8px', fontSize: '13px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{testAllReport}</span>
          <button onClick={() => setTestAllReport(null)} style={{ fontSize: '12px' }}>×</button>
        </div>
      )}

      {/* FM11 : panneau d'aperçu avant envoi en masse. */}
      {sendPreview?.visible && (
        <div style={{
          background: '#f0f4ff', border: '1px solid #007aff', borderRadius: '8px',
          padding: '16px', marginBottom: '12px',
        }}>
          <h4 style={{ margin: '0 0 8px' }}>
            Aperçu — {sendPreview.toSend.length} email(s) à envoyer
            {' '}({sendPreview.toSend.filter((a) => a.status === 'DRAFT').length} brouillons
            + {sendPreview.toSend.filter((a) => a.status === 'FAILED').length} échecs)
          </h4>
          <ul style={{ margin: '0 0 8px', paddingLeft: '16px', fontSize: '13px' }}>
            {sendPreview.toSend.slice(0, 5).map((a) => (
              <li key={a.id}><strong>{a.companyName}</strong> — {a.subject || '(pas d\'objet)'}</li>
            ))}
            {sendPreview.toSend.length > 5 && (
              <li style={{ color: '#888' }}>… et {sendPreview.toSend.length - 5} autre(s)</li>
            )}
          </ul>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={confirmSendAll}
              style={{ background: '#007aff', color: '#fff' }}
            >
              Confirmer l'envoi
            </button>
            <button onClick={() => setSendPreview(null)}>Annuler</button>
          </div>
        </div>
      )}

      {/* FM12 : bannière de rapport post-envoi. */}
      {sendReport && (
        <div style={{
          background: '#d4edda', border: '1px solid #28a745', borderRadius: '6px',
          padding: '10px 16px', marginBottom: '8px', fontSize: '13px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{sendReport}</span>
          <button onClick={() => setSendReport(null)} style={{ fontSize: '12px' }}>×</button>
        </div>
      )}

      {/* PERF-2 : barre de recherche + filtre statut. */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
          <Search size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-sub)', pointerEvents: 'none' }} />
          <input
            placeholder="Rechercher une entreprise, un objet…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setAppsPage(0); }}
            style={{ flex: 1, paddingLeft: '32px' }}
          />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setAppsPage(0); }}>
          <option value="">Tous</option>
          <option value="DRAFT">Brouillon</option>
          <option value="SENT">Envoyé</option>
          <option value="REPLIED">Réponse reçue</option>
          <option value="FAILED">Échec</option>
          <option value="FOLLOWED_UP">Relancé</option>
        </select>
      </div>

      <div className="table-wrap">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: 0 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #e0e0e0', color: '#555' }}>
            <th style={{ padding: '6px 8px' }}>Entreprise</th>
            <th style={{ padding: '6px 8px' }}>Objet</th>
            <th style={{ padding: '6px 8px' }}>Statut</th>
            <th style={{ padding: '6px 8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedApps.map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                <strong>{a.companyName}</strong>
                {(((isUnverifiedEmail(a) && a.status !== 'SENT' && a.status !== 'REPLIED')) || a.manualStatus || a.emailBounced) && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {isUnverifiedEmail(a) && a.status !== 'SENT' && a.status !== 'REPLIED' && (
                      <span title={`L'adresse ${a.contactEmail} a été générée automatiquement (pattern), non confirmée — risque de rebond. Éditez l'email pour la vérifier.`} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: '#ffd60a', color: '#5c4400', fontWeight: 600, cursor: 'help' }}>✎ à vérifier</span>
                    )}
                    {a.manualStatus && (
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: manualStatusColor(a.manualStatus), color: '#fff' }}>{MANUAL_STATUS_OPTIONS.find((o) => o.value === a.manualStatus)?.label ?? a.manualStatus}</span>
                    )}
                    {a.emailBounced && (
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: '#ff453a', color: '#fff', fontWeight: 600 }}>⚠ rebondi</span>
                    )}
                  </div>
                )}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', color: '#555' }}>
                {a.subject || '(pas encore généré)'}
                {a.errorMessage && <div className="error" style={{ fontSize: '11px', marginTop: '2px' }}>{friendlyError(a.errorMessage)}</div>}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                <span className={`status status-${a.status.toLowerCase()}`}>{statusLabel(a.status)}</span>
                {a.status === 'REPLIED' && (
                  <div style={{ marginTop: '4px' }}>
                    <select value={a.manualStatus ?? ''} onChange={(e) => setManualStatus(a.id, e.target.value)} style={{ fontSize: '11px' }}>
                      {MANUAL_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                  </div>
                )}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <button onClick={() => setEditing(a)} style={{ fontSize: '12px' }}>Voir / Éditer</button>
                  {a.body && <button onClick={() => setPreviewAppId(a.id)} style={{ fontSize: '12px', background: '#5ac8fa', color: '#000' }}>Aperçu HTML</button>}
                  {(a.status === 'DRAFT' || a.status === 'FAILED') && (
                    <button onClick={() => sendOne(a.id)} disabled={sendingId === a.id} style={{ fontSize: '12px' }}>{sendingId === a.id ? 'Envoi…' : 'Envoyer'}</button>
                  )}
                  {/* Email deviné (pattern) bloqué à l'envoi normal : bypass explicite en un clic. */}
                  {a.status === 'FAILED' && isUnverifiedEmail(a) && (
                    <button onClick={() => sendUnverified(a)} disabled={sendingId === a.id}
                      title="Envoie quand même malgré le risque de rebond (email non vérifié)"
                      style={{ fontSize: '12px', background: '#ff9f0a', color: '#fff' }}>
                      {sendingId === a.id ? 'Envoi…' : '⚠ Envoyer quand même'}
                    </button>
                  )}
                  {(a.status === 'DRAFT' || a.status === 'FAILED') && (
                    <button onClick={() => regenerateOne(a.id)} disabled={regeneratingId === a.id} style={{ fontSize: '12px' }}>{regeneratingId === a.id ? 'Régénération…' : '⟳ Regénérer'}</button>
                  )}
                  {isFollowUpEligible(a) && (
                    <button onClick={() => openFollowUpPreview(a)} disabled={loadingFollowUpId === a.id} style={{ fontSize: '12px', background: '#ff9f0a', color: '#fff' }}>
                      {loadingFollowUpId === a.id ? 'Aperçu…' : 'Relancer'}
                    </button>
                  )}
                  {a.emailBounced && (() => {
                    const company = companies.find((c) => c.id === a.companyId);
                    const nextEmail = company?.emailAlternatives?.[0];
                    return nextEmail ? (
                      <button onClick={() => retryBounce(a)} disabled={retryingBounceId === a.id} style={{ fontSize: '12px', background: '#ff9f0a', color: '#fff' }} title={`Réessayer avec ${nextEmail}`}>{retryingBounceId === a.id ? 'Changement…' : `↻ ${nextEmail}`}</button>
                    ) : null;
                  })()}
                </div>
              </td>
            </tr>
          ))}
          {filteredApps.length === 0 && (
            <tr><td colSpan={4} style={{ padding: '10px 8px', color: '#888' }}>{apps.length === 0 ? 'Aucune candidature — générez les emails ci-dessus.' : 'Aucune candidature ne correspond aux filtres.'}</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {/* PERF-1 : pagination + sélecteur de taille de page (candidatures). */}
      <div style={{ display: 'flex', gap: '8px', margin: '8px 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '12px', color: '#555' }}>
          Afficher{' '}
          <select value={appsPageSize}
            onChange={(e) => { setAppsPageSize(Number(e.target.value)); setAppsPage(0); }}>
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>{' '}par page
        </label>
        {totalAppPages > 1 && (
          <>
            <button onClick={() => setAppsPage((p) => Math.max(0, p - 1))} disabled={appsPage === 0}>← Précédent</button>
            <span>Page {appsPage + 1} / {totalAppPages}</span>
            <button onClick={() => setAppsPage((p) => Math.min(totalAppPages - 1, p + 1))} disabled={appsPage >= totalAppPages - 1}>Suivant →</button>
          </>
        )}
      </div>

      {/* FM-07 : modal d'aperçu HTML de l'email. */}
      {previewAppId && (() => {
        const previewApp = apps.find((a) => a.id === previewAppId);
        if (!previewApp) return null;
        return <EmailPreviewModal app={previewApp} onClose={() => setPreviewAppId(null)} />;
      })()}

      {/* UX-S8 : modal d'aperçu éditable de la relance avant envoi. */}
      {followUpPreview && (
        <div
          onClick={() => !sendingFollowUp && setFollowUpPreview(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', padding: '20px', width: '100%', maxWidth: '640px', maxHeight: '85vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Relancer {followUpPreview.companyName}</h3>
            <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
              Aperçu généré — tu peux l'éditer avant l'envoi. La relance part dans le fil de la candidature initiale.
            </p>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>Objet</label>
            <input
              value={followUpPreview.subject}
              onChange={(e) => setFollowUpPreview({ ...followUpPreview, subject: e.target.value })}
              style={{ width: '100%', marginBottom: '10px' }}
            />
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>Message</label>
            <textarea
              value={followUpPreview.body}
              onChange={(e) => setFollowUpPreview({ ...followUpPreview, body: e.target.value })}
              rows={12}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: '13px', lineHeight: 1.5 }}
            />
            {followUpError && (
              <p className="error" style={{ marginTop: '10px', marginBottom: 0 }}>{followUpError}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button onClick={() => { setFollowUpPreview(null); setFollowUpError(null); }} disabled={sendingFollowUp} className="btn-secondary">Annuler</button>
              <button onClick={confirmFollowUp} disabled={sendingFollowUp || !followUpPreview.body.trim()} style={{ background: '#ff9f0a', color: '#fff' }}>
                {sendingFollowUp ? 'Envoi…' : 'Envoyer la relance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <>
          <div className="modal-overlay" onClick={closeModal} />
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Édition de la candidature pour ${editing.companyName}`}
               onClick={(e) => e.stopPropagation()}>
            <h3>Aperçu — {editing.companyName}</h3>
            {/* FM4 : afficher l'adresse d'envoi pour que l'utilisateur vérifie le bon compte. */}
            {senderEmail && <p style={{ fontSize: '12px', color: '#888' }}>De : {senderEmail}</p>}
            <p>À : {editing.contactEmail}</p>
            {/* UX-8v3 : indicateur de modifications non sauvegardées. */}
            {draftBodyChanged && (
              <p style={{ fontSize: '12px', color: '#ff9f0a', margin: '4px 0' }}>
                ⚠ Modifications non sauvegardées
              </p>
            )}
            <label>Objet
              <input value={editing.subject}
                     readOnly={editing.status !== 'DRAFT' && editing.status !== 'FAILED'}
                     onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
            </label>
            <label style={{ flex: 1 }}>Corps
              <textarea value={draftBody}
                        readOnly={editing.status !== 'DRAFT' && editing.status !== 'FAILED'}
                        onChange={(e) => handleBodyChange(e.target.value)} />
            </label>
            {/* UX-S5 : fil de conversation. */}
            <ConversationThread app={editing} />

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(editing.status === 'DRAFT' || editing.status === 'FAILED') && (
                <button onClick={saveDraft}>Enregistrer</button>
              )}
              {/* UX-7v3 : envoi test à soi-même. */}
              <button
                onClick={() => sendTest(editing.id)}
                disabled={sendingTestId === editing.id}
                style={{ background: '#5856d6', color: '#fff' }}
              >
                {sendingTestId === editing.id ? 'Envoi test…' : 'Envoyer en test'}
              </button>
              <button onClick={closeModal}>Fermer (Échap)</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

