import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { authGuard } from '../../middleware/authGuard';
import { UserService } from './user.service';
import { cvParsingQueue } from '../../lib/queue';
import { uploadToR2 } from '../../lib/storage';
import { encryptSymmetric } from '../../lib/crypto';

/**
 * Schéma de mise à jour du profil : liste BLANCHE explicite des champs
 * qu'un utilisateur a le droit de modifier lui-même.
 * `.strict()` rejette tout champ non listé (ex: `plan`, `email`, `smtpConfig`,
 * `passwordHash`) afin d'empêcher une élévation de privilèges par mass assignment.
 *
 * `emailSender` est volontairement EXCLU : il n'est défini que via la route
 * /me/smtp (à partir du champ `fromEmail`), pour garder une source unique.
 */
const updateProfileSchema = z
  .object({
    firstName: z.string().min(2).optional(),
    lastName: z.string().min(2).optional(),
    // `nullable` : permet d'envoyer `null` pour EFFACER le token push
    // (l'utilisateur a désactivé les notifications).
    pushToken: z.string().nullable().optional(),
  })
  .strict();

/**
 * Schéma de configuration du compte d'envoi d'emails.
 * `port` est coercé en nombre car l'app mobile peut l'envoyer en chaîne.
 */
const smtpConfigSchema = z
  .object({
    provider: z.enum(['GMAIL', 'SMTP', 'RESEND']),
    host: z.string().optional(),
    port: z.coerce.number().optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    fromEmail: z.string().email(),
  })
  .strict();

// Hôtes/ports SMTP des fournisseurs gérés (GMAIL et RESEND sont préconfigurés).
const SMTP_PRESETS: Record<string, { host: string; port: number }> = {
  GMAIL: { host: 'smtp.gmail.com', port: 465 },
  RESEND: { host: 'smtp.resend.com', port: 465 },
};

/**
 * Résout l'hôte et le port SMTP effectifs : imposés par le preset pour GMAIL
 * et RESEND, fournis par l'utilisateur pour le provider SMTP générique.
 */
function resolveSmtpHostPort(data: z.infer<typeof smtpConfigSchema>) {
  const preset = SMTP_PRESETS[data.provider];
  return {
    host: preset?.host ?? data.host,
    port: preset?.port ?? data.port,
  };
}

export async function userRoutes(app: FastifyInstance) {
  const userService = new UserService();

  // Protéger toutes les routes de ce module
  app.addHook('onRequest', authGuard);

  app.get('/me', async (request, reply) => {
    const user = await userService.getProfile(request.user.sub);
    return reply.send(user);
  });

  app.patch('/me', async (request, reply) => {
    // On valide/filtre le corps de la requête AVANT de l'envoyer au service.
    const data = updateProfileSchema.parse(request.body);
    const user = await userService.updateProfile(request.user.sub, data);
    return reply.send(user);
  });

  // Upload et analyse du CV
  app.post('/me/cv', async (request, reply) => {
    const data = await request.file();
    
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (data.mimetype !== 'application/pdf') {
      return reply.status(400).send({ error: 'Only PDF files are supported' });
    }

    const buffer = await data.toBuffer();

    // Validation du CONTENU réel (L-E) : le `mimetype` du multipart est fourni
    // par le client et donc falsifiable. Tout PDF valide commence par « %PDF ».
    if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      return reply.status(400).send({ error: "Le fichier fourni n'est pas un PDF valide" });
    }

    try {
      const fileUrl = await uploadToR2(buffer, data.filename);

      // On enqueue l'analyse AVANT de persister `cvUrl` (L-F) : si Redis est
      // indisponible, on échoue ici sans avoir marqué un CV « importé » qui ne
      // serait jamais analysé.
      await cvParsingQueue.add('parse-cv-job', { userId: request.user.sub, fileUrl }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      });

      // Persister `cvUrl` : le profil et la checklist d'onboarding reflètent
      // immédiatement « CV importé » (l'analyse `cvParsed` reste asynchrone).
      await userService.updateCvUrl(request.user.sub, fileUrl);

      return reply.status(202).send({ status: 'PARSING', message: 'Analyse en cours...' });
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Failed to queue CV upload' });
    }
  });

  // Test de connexion SMTP (U3) : vérifie les identifiants AVANT de les
  // enregistrer, pour éviter qu'une campagne entière échoue à l'envoi à cause
  // d'un mot de passe erroné. Aucune donnée n'est persistée ici.
  app.post('/me/smtp/test', async (request, reply) => {
    const data = smtpConfigSchema.parse(request.body);

    const { host, port } = resolveSmtpHostPort(data);
    if (!host || !port) {
      return reply.status(400).send({ error: 'Hôte et port SMTP requis' });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: data.username, pass: data.password },
      // Délais courts : un serveur injoignable ne doit pas faire traîner la
      // requête (verify() pourrait sinon attendre très longtemps).
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    try {
      // `verify()` ouvre une connexion et tente l'authentification, sans
      // envoyer d'email.
      await transporter.verify();
      return reply.send({ status: 'OK', message: 'Connexion SMTP réussie.' });
    } catch (err: any) {
      return reply
        .status(400)
        .send({ error: `Échec de la connexion SMTP : ${err.message}` });
    } finally {
      transporter.close();
    }
  });

  // Enregistrement de la configuration du compte d'envoi d'emails.
  // Le mot de passe / la clé API est chiffré (AES-256-GCM) avant stockage :
  // il ne transite jamais en clair vers la base.
  app.post('/me/smtp', async (request, reply) => {
    const data = smtpConfigSchema.parse(request.body);

    // Pour GMAIL et RESEND, l'hôte/port sont imposés ; pour SMTP, fournis
    // par l'utilisateur.
    const { host, port } = resolveSmtpHostPort(data);
    if (!host || !port) {
      return reply.status(400).send({ error: 'Hôte et port SMTP requis' });
    }

    // Forme attendue par le worker d'envoi (smtp-sender.worker.ts).
    const smtpConfig = {
      host,
      port,
      secure: port === 465, // 465 = TLS implicite
      user: data.username,
      pass: encryptSymmetric(data.password),
    };

    const user = await userService.updateSmtpConfig(
      request.user.sub,
      smtpConfig,
      data.fromEmail
    );
    return reply.send({ status: 'SAVED', emailSender: user.emailSender });
  });

  // Export RGPD (S3) : renvoie toutes les données personnelles de
  // l'utilisateur en JSON (droit à la portabilité).
  app.get('/me/export', async (request, reply) => {
    const data = await userService.exportData(request.user.sub);
    return reply
      .header('Content-Disposition', 'attachment; filename="candio-export.json"')
      .send(data);
  });

  // Suppression définitive du compte (S3 — droit à l'effacement).
  // Réponse 204 : le client doit ensuite purger sa session locale.
  app.delete('/me', async (request, reply) => {
    await userService.deleteAccount(request.user.sub);
    return reply.status(204).send();
  });
}
