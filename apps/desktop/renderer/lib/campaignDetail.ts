import type { Application, CompanyInput } from '@candio/shared';
import { UNVERIFIED_EMAIL_SOURCES } from '@candio/shared';

/**
 * Helpers purs de la page Détail de campagne (extraits de CampaignDetailPage
 * pour l'alléger — REFACTO #22). Aucune dépendance à l'état React.
 */

// DELIV-01 : email « deviné » (pattern) non confirmé → à vérifier avant envoi.
export const isUnverifiedEmail = (a: Application): boolean =>
  (UNVERIFIED_EMAIL_SOURCES as readonly string[]).includes(a.emailSource);

// UX-4v3 : libellés des statuts manuels post-réponse.
export const MANUAL_STATUS_OPTIONS = [
  { value: '', label: '— Aucun —' },
  { value: 'INTERVIEWED', label: 'Entretien' },
  { value: 'OFFER', label: 'Offre reçue' },
  { value: 'REJECTED', label: 'Refusé' },
  { value: 'ACCEPTED', label: 'Accepté' },
];

// UX-4v3 : couleur par statut manuel.
export function manualStatusColor(s: string | null): string {
  if (s === 'INTERVIEWED') return '#ff9f0a';
  if (s === 'OFFER') return '#34c759';
  if (s === 'REJECTED') return '#ff453a';
  if (s === 'ACCEPTED') return '#007aff';
  return '#888';
}

export type CompanyForm = Omit<CompanyInput, 'campaignId'>;
export const EMPTY_COMPANY: CompanyForm = {
  name: '', website: null, contactEmail: '', contactName: null, contactRole: null,
};

// M4 : messages d'erreur techniques → messages compréhensibles.
export function friendlyError(msg: string): string {
  if (msg.includes('Clé OpenAI') || msg.includes('openai') || msg.includes('401'))
    return 'Clé OpenAI incorrecte ou absente — vérifiez les Réglages';
  if (msg.includes('SMTP') || msg.includes('smtp'))
    return 'Erreur d\'envoi SMTP — vérifiez la configuration dans les Réglages';
  if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo'))
    return 'Serveur SMTP introuvable — vérifiez l\'hôte dans les Réglages';
  if (msg.includes('ENOENT') || msg.includes('no such file'))
    return 'Fichier introuvable (CV déplacé ?)';
  return msg;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PERF-1 / UX-3v3 : pagination — tailles de page sélectionnables (entreprises + candidatures).
export const PAGE_SIZE_OPTIONS = [10, 25, 50];

// FM-07 : convertit le texte en HTML (version renderer, sans import externe).
export function toHtmlRenderer(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(/\n/g, '<br>');
}
