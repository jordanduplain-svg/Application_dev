/**
 * UX-7 : traductions françaises des statuts de campagne et de candidature.
 * La classe CSS `status-${x.toLowerCase()}` reste inchangée.
 */

const STATUS_LABELS: Record<string, string> = {
  // CampaignStatus
  DRAFT: 'Brouillon',
  RUNNING: 'En cours',
  COMPLETED: 'Terminée',
  // ApplicationStatus
  SENDING: 'En envoi…',
  SENT: 'Envoyé',
  REPLIED: 'Réponse reçue',
  FAILED: 'Échec',
  FOLLOWED_UP: 'Relancé',
  // UX-4v3 : statuts manuels post-réponse.
  INTERVIEWED: 'Entretien',
  OFFER: 'Offre reçue',
  REJECTED: 'Refusé',
  ACCEPTED: 'Accepté',
};

/** Retourne le libellé français du statut, ou le statut brut si inconnu. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
