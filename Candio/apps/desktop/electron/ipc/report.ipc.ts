import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'fs/promises';
import { handle } from './registry';
import { prisma } from '../../src/lib/prisma';
import { getProfile } from '../../src/modules/profile/profile.service';
import { logger } from '../../src/lib/logger';

/**
 * Justificatif de recherche d'emploi pour France Travail.
 *
 * France Travail exige des « actes positifs et répétés de recherche d'emploi »,
 * justifiables par tout moyen (relevé des candidatures envoyées). On génère un PDF
 * propre listant les candidatures réellement ENVOYÉES (date, entreprise, poste,
 * statut) — prêt à présenter en cas de contrôle / à joindre à l'actualisation.
 */

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Envoyée', REPLIED: 'Réponse reçue', FOLLOWED_UP: 'Relancée',
};

function esc(s: string): string {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function buildHtml(candidate: string, rows: { date: string; company: string; job: string; status: string }[], generatedOn: string): string {
  const lines = rows.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${esc(r.date)}</td>
      <td><strong>${esc(r.company)}</strong></td>
      <td>${esc(r.job)}</td>
      <td>${esc(r.status)}</td>
    </tr>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1d1d1f; font-size: 12px; margin: 32px; }
    h1 { font-size: 19px; margin: 0 0 4px; }
    .sub { color: #555; font-size: 12px; margin: 0 0 18px; }
    .meta { margin: 0 0 18px; font-size: 12px; }
    .meta b { display: inline-block; min-width: 130px; color: #333; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #e3e3e6; vertical-align: top; }
    th { background: #f4f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; color: #555; }
    .num { color: #999; width: 28px; }
    .foot { margin-top: 22px; font-size: 10.5px; color: #777; line-height: 1.5; }
  </style></head><body>
    <h1>Justificatif de recherche d'emploi</h1>
    <p class="sub">Relevé des candidatures spontanées envoyées</p>
    <div class="meta">
      <div><b>Demandeur d'emploi :</b> ${esc(candidate)}</div>
      <div><b>Document généré le :</b> ${esc(generatedOn)}</div>
      <div><b>Nombre de candidatures :</b> ${rows.length}</div>
    </div>
    <table>
      <thead><tr><th class="num">#</th><th>Date d'envoi</th><th>Entreprise</th><th>Poste visé</th><th>Statut</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <p class="foot">Document généré par l'outil personnel de suivi de candidatures du demandeur d'emploi.
    Atteste des démarches actives de recherche d'emploi (candidatures spontanées) au sens des articles
    R5411-1 et suivants du Code du travail. Les justificatifs détaillés (emails envoyés, réponses) peuvent
    être fournis sur demande.</p>
  </body></html>`;
}

export function registerReportHandlers(): void {
  handle('report:franceTravailPdf', async () => {
    const profile = await getProfile();
    const candidate = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';

    const apps = await prisma.application.findMany({
      where: { status: { in: ['SENT', 'REPLIED', 'FOLLOWED_UP'] }, sentAt: { not: null } },
      include: { company: { select: { name: true } }, campaign: { select: { jobTitle: true } } },
      orderBy: { sentAt: 'desc' },
    });
    if (apps.length === 0) {
      throw new Error('Aucune candidature envoyée à justifier pour le moment.');
    }

    const rows = apps.map((a) => ({
      date: a.sentAt ? a.sentAt.toLocaleDateString('fr-FR') : '',
      company: a.company.name,
      job: a.campaign.jobTitle,
      status: STATUS_LABEL[a.status] ?? a.status,
    }));

    const result = await dialog.showSaveDialog({
      title: 'Justificatif France Travail',
      defaultPath: `justificatif-recherche-emploi-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const html = buildHtml(candidate, rows, new Date().toLocaleDateString('fr-FR'));
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
}
