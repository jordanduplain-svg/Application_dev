/**
 * deliverability — Contrôles de délivrabilité côté expéditeur.
 *
 * - checkSenderDeliverability(email) : vérifie SPF + DMARC du domaine d'envoi
 *   via la résolution DNS TXT intégrée Node.js (aucune lib externe).
 *
 * Tout est local — aucun appel réseau externe au-delà des lookups DNS.
 */

import { promises as dns } from 'dns';
import { logger } from './logger';

// ── SPF / DMARC ───────────────────────────────────────────────────────────────

export interface DeliverabilityReport {
  domain: string;
  hasSpf: boolean;
  dmarcPolicy: 'none' | 'quarantine' | 'reject' | 'unknown';
  warnings: string[];
}

async function resolveTxt(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((r) => r.join(''));
  } catch {
    return [];
  }
}

/**
 * Vérifie les enregistrements SPF et DMARC du domaine d'envoi.
 * À appeler une fois lors de la vérification SMTP (bouton « Tester »).
 * Les résultats sont purement informatifs — on n'empêche pas l'envoi.
 */
export async function checkSenderDeliverability(fromEmail: string): Promise<DeliverabilityReport> {
  const domain = fromEmail.split('@')[1] ?? '';
  if (!domain) {
    return { domain: '', hasSpf: false, dmarcPolicy: 'unknown', warnings: ['Adresse email invalide'] };
  }

  const warnings: string[] = [];

  // SPF : enregistrement TXT « v=spf1 … » sur le domaine d'envoi.
  const spfRecords = await resolveTxt(domain);
  const hasSpf = spfRecords.some((r) => r.startsWith('v=spf1'));
  if (!hasSpf) {
    warnings.push(
      `Aucun enregistrement SPF sur ${domain}. `
      + 'Vos emails risquent d\'être marqués spam. '
      + 'Ajoutez un enregistrement TXT « v=spf1 include:_spf.google.com ~all » (ou l\'équivalent de votre hébergeur).'
    );
  }

  // DMARC : enregistrement TXT « v=DMARC1 … » sur _dmarc.<domain>.
  const dmarcRecords = await resolveTxt(`_dmarc.${domain}`);
  const dmarcRec = dmarcRecords.find((r) => r.startsWith('v=DMARC1')) ?? '';
  const pMatch = dmarcRec.match(/\bp=(\w+)/i);
  const dmarcPolicy = (pMatch?.[1]?.toLowerCase() ?? 'unknown') as DeliverabilityReport['dmarcPolicy'];

  if (!dmarcRec) {
    warnings.push(
      `Aucun enregistrement DMARC sur ${domain}. `
      + 'Sans DMARC, certains serveurs traitent vos emails avec moins de confiance. '
      + 'Ajoutez _dmarc.' + domain + ' TXT « v=DMARC1; p=none; rua=mailto:dmarc@' + domain + ' ».'
    );
  } else if (dmarcPolicy === 'none') {
    // p=none = monitoring seulement, aucun effet sur la livraison — info positive.
    logger.info(`[DELIVERABILITY] ${domain} : DMARC p=none (monitoring)`);
  } else if (dmarcPolicy === 'quarantine') {
    warnings.push(
      `DMARC p=quarantine sur ${domain} : les emails qui échouent à l'alignement `
      + 'SPF/DKIM peuvent atterrir en spam côté destinataire. Vérifiez que votre '
      + 'configuration DKIM est correcte.'
    );
  } else if (dmarcPolicy === 'reject') {
    warnings.push(
      `DMARC p=reject sur ${domain} : emails mal alignés rejetés côté destinataire. `
      + 'Assurez-vous que DKIM est configuré et que votre adresse d\'envoi correspond '
      + 'bien au domaine protégé.'
    );
  }

  if (warnings.length > 0) {
    logger.warn(`[DELIVERABILITY] ${domain} — ${warnings.length} avertissement(s)`);
  } else {
    logger.info(`[DELIVERABILITY] ${domain} — SPF ✓, DMARC ${dmarcPolicy}`);
  }

  return { domain, hasSpf, dmarcPolicy, warnings };
}
