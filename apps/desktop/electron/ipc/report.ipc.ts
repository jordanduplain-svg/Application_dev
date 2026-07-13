import { BrowserWindow, dialog, shell } from 'electron';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { handle } from './registry';
import { validate, ReportRangeSchema } from './validation';
import { prisma } from '../../src/lib/prisma';
import { getProfile } from '../../src/modules/profile/profile.service';
import { MAX_FOLLOWUPS } from '../../src/modules/application/application.service';
import { logger } from '../../src/lib/logger';

/**
 * Justificatif de recherche d'emploi pour France Travail.
 *
 * France Travail exige des « actes positifs et répétés de recherche d'emploi »,
 * justifiables par tout moyen (relevé des candidatures envoyées). On génère un PDF
 * propre listant les candidatures réellement ENVOYÉES sur une période choisie
 * (date, entreprise, poste, état), suivi des lettres de motivation et des réponses
 * reçues, groupées par entreprise — prêt à présenter en cas de contrôle.
 */

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Envoyée', REPLIED: 'Réponse reçue', FOLLOWED_UP: 'Relancée',
  // État manuel post-réponse (manualStatus) — reflète l'état actuel.
  INTERVIEWED: 'Entretien', OFFER: 'Offre reçue', REJECTED: 'Refusée', ACCEPTED: 'Acceptée',
};

function esc(s: string): string {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// Conserve les sauts de ligne du texte brut dans le HTML.
function escMultiline(s: string): string {
  return esc(s).replace(/\n/g, '<br>');
}

type Row = { date: string; company: string; job: string; status: string };
type Group = { company: string; job: string; date: string; letter: string; reply: string; repliedDate: string };

function buildHtml(candidate: string, contact: string, period: string, rows: Row[], groups: Group[], omitted: number, generatedOn: string): string {
  const lines = rows.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${esc(r.date)}</td>
      <td><strong>${esc(r.company)}</strong></td>
      <td>${esc(r.job)}</td>
      <td>${esc(r.status)}</td>
    </tr>`).join('');

  const details = groups.map((g) => `
    <div class="grp">
      <h3>${esc(g.company)} — <span class="job">${esc(g.job)}</span></h3>
      <div class="lbl">Lettre de motivation envoyée le ${esc(g.date)}</div>
      <div class="box">${escMultiline(g.letter) || '<em>—</em>'}</div>
      ${g.reply ? `
      <div class="lbl">Réponse reçue le ${esc(g.repliedDate)}</div>
      <div class="box reply">${escMultiline(g.reply)}</div>` : ''}
    </div>`).join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1d1d1f; font-size: 12px; margin: 32px; }
    h1 { font-size: 19px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 26px 0 10px; padding-top: 14px; border-top: 2px solid #e3e3e6; }
    .sub { color: #555; font-size: 12px; margin: 0 0 18px; }
    .meta { margin: 0 0 18px; font-size: 12px; }
    .meta b { display: inline-block; min-width: 130px; color: #333; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #e3e3e6; vertical-align: top; }
    th { background: #f4f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; color: #555; }
    .num { color: #999; width: 28px; }
    .grp { margin: 0 0 18px; page-break-inside: avoid; }
    .grp h3 { font-size: 13px; margin: 14px 0 6px; }
    .grp .job { color: #666; font-weight: normal; }
    .lbl { font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; color: #888; margin: 8px 0 3px; }
    .box { border: 1px solid #e3e3e6; border-radius: 6px; padding: 9px 11px; font-size: 11.5px; line-height: 1.5; background: #fafafa; }
    .box.reply { background: #f0f6ff; border-color: #cfe0f5; }
    .foot { margin-top: 22px; font-size: 10.5px; color: #777; line-height: 1.5; }
  </style></head><body>
    <h1>Justificatif de recherche d'emploi</h1>
    <p class="sub">Relevé des candidatures spontanées envoyées</p>
    <div class="meta">
      <div><b>Demandeur d'emploi :</b> ${esc(candidate)}</div>
      ${contact ? `<div><b>Coordonnées :</b> ${esc(contact)}</div>` : ''}
      ${period ? `<div><b>Période couverte :</b> ${esc(period)}</div>` : ''}
      <div><b>Document généré le :</b> ${esc(generatedOn)}</div>
      <div><b>Nombre de candidatures :</b> ${rows.length}</div>
    </div>

    <h2>État des candidatures</h2>
    <table>
      <thead><tr><th class="num">#</th><th>Date d'envoi</th><th>Entreprise</th><th>Poste visé</th><th>État actuel</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>

    <h2>Lettres de motivation &amp; réponses reçues</h2>
    ${omitted > 0 ? `<p class="sub">Toutes les réponses reçues figurent ci-dessous. Pour rester lisible, ${omitted} lettre(s) de motivation supplémentaire(s) ne sont pas reproduites ici — elles restent disponibles sur demande (le relevé complet figure dans le tableau ci-dessus).</p>` : ''}
    ${details}

    <p class="foot">Document généré par l'outil personnel de suivi de candidatures du demandeur d'emploi.
    Atteste des démarches actives de recherche d'emploi (candidatures spontanées) au sens des articles
    R5411-1 et suivants du Code du travail.</p>
  </body></html>`;
}

export function registerReportHandlers(): void {
  handle('report:franceTravailPdf', async (payload) => {
    // B3 : valide les bornes (format date natif) avant de toucher Prisma —
    // un `from` malformé donnait sinon `new Date('xT00:00:00')` = Invalid Date.
    const { from, to, detailCap } = validate(ReportRangeSchema, payload ?? {});
    const profile = await getProfile();
    const candidate = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
    const contact = profile ? [profile.emailSender, profile.phone].filter(Boolean).join(' · ') : '';

    // Période : bornes optionnelles sur sentAt (`to` inclusif → fin de journée).
    const sentAt: { not: null; gte?: Date; lte?: Date } = { not: null };
    if (from) sentAt.gte = new Date(from + 'T00:00:00');
    if (to) sentAt.lte = new Date(to + 'T23:59:59.999');

    const apps = await prisma.application.findMany({
      where: { status: { in: ['SENT', 'REPLIED', 'FOLLOWED_UP'] }, sentAt },
      include: { company: { select: { name: true } }, campaign: { select: { jobTitle: true } } },
      orderBy: { sentAt: 'desc' },
    });
    if (apps.length === 0) {
      throw new Error('Aucune candidature envoyée à justifier sur cette période.');
    }

    const rows: Row[] = apps.map((a) => ({
      date: a.sentAt ? a.sentAt.toLocaleDateString('fr-FR') : '',
      company: a.company.name,
      job: a.campaign.jobTitle,
      // État actuel : manualStatus prioritaire (entretien/offre/refus), sinon statut technique.
      status: STATUS_LABEL[a.manualStatus ?? a.status] ?? a.manualStatus ?? STATUS_LABEL[a.status] ?? a.status,
    }));

    // À grande échelle (centaines de candidatures), dumper toutes les lettres rend le
    // PDF ingérable. On garde TOUJOURS les candidatures ayant reçu une réponse (la
    // partie qui compte), puis on complète avec des lettres jusqu'à un plafond.
    // Plafond choisi par l'utilisateur (0/absent = toutes les lettres) ; le tableau reste exhaustif.
    const DETAIL_CAP = detailCap && detailCap > 0 ? detailCap : Infinity;
    const withReply = apps.filter((a) => a.replyContent);
    const withoutReply = apps.filter((a) => !a.replyContent);
    const detail = [...withReply, ...withoutReply].slice(0, Math.max(DETAIL_CAP, withReply.length));
    const omitted = apps.length - detail.length;

    const groups: Group[] = detail.map((a) => ({
      company: a.company.name,
      job: a.campaign.jobTitle,
      date: a.sentAt ? a.sentAt.toLocaleDateString('fr-FR') : '',
      letter: a.body,
      reply: a.replyContent ?? '',
      repliedDate: a.repliedAt ? a.repliedAt.toLocaleDateString('fr-FR') : '',
    }));

    const result = await dialog.showSaveDialog({
      title: 'Justificatif France Travail',
      defaultPath: `justificatif-recherche-emploi-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;

    // rows triées par sentAt desc → première = plus récente, dernière = plus ancienne.
    const period = rows.length ? `du ${rows[rows.length - 1].date} au ${rows[0].date}` : '';
    const html = buildHtml(candidate, contact, period, rows, groups, omitted, new Date().toLocaleDateString('fr-FR'));
    // Fenêtre hors écran → rendu HTML → export PDF natif Chromium (aucune dépendance).
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await win.webContents.printToPDF({ printBackground: true });
      await writeFile(result.filePath, pdf);
    } finally {
      win.destroy();
    }
    logger.info(`[report] Justificatif France Travail : ${result.filePath} (${rows.length} candidatures)`);
    return { path: result.filePath, count: rows.length };
  });

  // ── Export CSV de toutes les candidatures (suivi perso / tableur) ──────────
  handle('report:applicationsCsv', async () => {
    const apps = await prisma.application.findMany({
      include: { company: { select: { name: true, contactEmail: true } }, campaign: { select: { jobTitle: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (apps.length === 0) throw new Error('Aucune candidature à exporter.');

    const result = await dialog.showSaveDialog({
      title: 'Exporter les candidatures (CSV)',
      defaultPath: `candidatures-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const header = ['Entreprise', 'Poste', 'Email contact', 'Statut', 'État manuel', 'Envoyée le', 'Réponse le', 'Relancée le'];
    const fmt = (d: Date | null) => (d ? d.toLocaleDateString('fr-FR') : '');
    const rows = apps.map((a) => [
      a.company.name, a.campaign.jobTitle, a.company.contactEmail,
      STATUS_LABEL[a.status] ?? a.status, a.manualStatus ? (STATUS_LABEL[a.manualStatus] ?? a.manualStatus) : '',
      fmt(a.sentAt), fmt(a.repliedAt), fmt(a.followUpSentAt),
    ]);
    // BOM UTF-8 → Excel ouvre les accents correctement.
    const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    await writeFile(result.filePath, csv, 'utf8');
    logger.info(`[report] Export CSV : ${result.filePath} (${apps.length} candidatures)`);
    return { path: result.filePath, count: apps.length };
  });

  // ── Agenda : prochaines relances dues + entretiens à venir ─────────────────
  handle('report:agenda', async () => {
    // Relances à venir : SENT/FOLLOWED_UP sans réponse, sous le plafond. dueDate =
    // (dernière relance ou envoi initial) + 10 j. Inclut les retards (dueDate passée).
    const apps = await prisma.application.findMany({
      where: { repliedAt: null, followUpCount: { lt: MAX_FOLLOWUPS }, status: { in: ['SENT', 'FOLLOWED_UP'] } },
      include: { company: { select: { name: true } }, campaign: { select: { jobTitle: true } } },
    });
    const followUps = apps.flatMap((a) => {
      const base = a.followUpSentAt ?? a.sentAt;
      if (!base) return [];
      const due = new Date(base.getTime() + 10 * 24 * 60 * 60 * 1000);
      return [{ id: a.id, companyName: a.company.name, jobTitle: a.campaign.jobTitle, dueDate: due.toISOString() }];
    }).sort((x, y) => x.dueDate.localeCompare(y.dueDate));

    // Entretiens : à partir d'aujourd'hui (minuit local), les plus proches d'abord.
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const iv = await prisma.application.findMany({
      where: { interviewDate: { gte: startOfToday } },
      include: { company: { select: { name: true } } },
      orderBy: { interviewDate: 'asc' },
    });
    const interviews = iv.map((a) => ({
      id: a.id, companyName: a.company.name,
      date: a.interviewDate!.toISOString(), location: a.interviewLocation,
    }));

    return { followUps, interviews };
  });

  // ── .ics d'un entretien → ouvert dans l'app calendrier par défaut ──────────
  handle('report:interviewIcs', async ({ id }) => {
    const a = await prisma.application.findUnique({
      where: { id },
      include: { company: { select: { name: true } }, campaign: { select: { jobTitle: true } } },
    });
    if (!a) throw new Error('Candidature introuvable.');
    if (!a.interviewDate) throw new Error("Aucune date d'entretien définie pour cette candidature.");

    const start = a.interviewDate;
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 h par défaut
    const summary = `Entretien — ${a.company.name} (${a.campaign.jobTitle})`;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Carreer-ops//FR', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:entretien-${a.id}@carreer-ops`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEsc(summary)}`,
      ...(a.interviewLocation ? [`LOCATION:${icsEsc(a.interviewLocation)}`] : []),
      ...(a.interviewNotes ? [`DESCRIPTION:${icsEsc(a.interviewNotes)}`] : []),
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');

    const file = join(tmpdir(), `entretien-${a.id}.ics`);
    await writeFile(file, ics, 'utf8');
    await shell.openPath(file); // l'app calendrier propose « ajouter l'événement »
    logger.info(`[report] .ics entretien généré : ${file}`);
    return { ok: true };
  });
}

// Échappe un champ CSV (RFC 4180 : guillemets si , " ou saut de ligne).
function csvCell(v: string): string {
  const s = v ?? '';
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Date au format iCalendar UTC : YYYYMMDDTHHMMSSZ.
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Échappe le texte iCalendar (RFC 5545 : \ ; , et sauts de ligne).
function icsEsc(s: string): string {
  return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
