import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { aiService } from '../modules/ai/ai.service';
import { UserService } from '../modules/user/user.service';
import { downloadFromR2 } from '../lib/storage';
import { NotificationService } from '../services/notification.service';
const pdfParse = require('pdf-parse');

/**
 * Rôle : Worker BullMQ — analyse du CV uploadé par un utilisateur.
 *
 * Étapes : télécharger le PDF → en extraire le texte → le faire structurer
 * par l'IA → enregistrer le résultat sur le profil utilisateur.
 * Les jobs sont ajoutés à la file 'cv-parsing' depuis user.routes.ts.
 */

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

interface CVParsingJob {
  userId: string;
  fileUrl: string;
}

const userService = new UserService();

export const cvParserWorker = new Worker<CVParsingJob>(
  'cv-parsing',
  async (job: Job<CVParsingJob>) => {
    const { userId, fileUrl } = job.data;

    // 1. Récupération du fichier depuis le stockage (R2 en prod, disque en mock).
    const buffer = await downloadFromR2(fileUrl);

    // 2. Extraction du texte du PDF. Un échec ici déclenche la retry policy BullMQ.
    const pdfData = await pdfParse(buffer);
    if (!pdfData.text || pdfData.text.trim() === '') {
      throw new Error('Empty PDF or impossible to extract text.');
    }

    // 3. Structuration du CV en JSON via GPT-4o.
    const parsedCV = await aiService.parseCV(pdfData.text);

    // 4. Sauvegarde du CV parsé sur le profil de l'utilisateur.
    await userService.updateCVParsed(userId, parsedCV);
  },
  {
    connection: connection as any,
    // 5 jobs en parallèle : le parsing de CV est indépendant d'un utilisateur à l'autre.
    concurrency: 5,
  }
);

// Échec DÉFINITIF de l'analyse (PDF illisible, IA indisponible…) : on notifie
// l'utilisateur. Sans cela, l'échec est totalement silencieux (`POST /me/cv`
// a déjà répondu 202) et ses futures candidatures échoueront faute de CV
// analysé (M-H). On n'agit qu'à l'épuisement des tentatives.
cvParserWorker.on('failed', async (job) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const userId = job.data?.userId;
  if (!userId) return;
  await NotificationService.sendPushNotification(
    userId,
    '⚠️ Analyse du CV échouée',
    "Nous n'avons pas pu analyser votre CV. Vérifiez que le PDF est lisible et réimportez-le."
  );
});
