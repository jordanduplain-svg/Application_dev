import { z } from 'zod';

// FM2 : schémas de validation Zod pour les payloads IPC critiques.
// Toute erreur de validation produit un message utilisateur clair (errors[0].message).

// Schéma de création / mise à jour de campagne.
export const CampaignCreateSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(200, 'Le nom est trop long (max 200 car.)'),
  prompt: z.string().max(5000, 'Le prompt est trop long (max 5000 car.)'),
  jobTitle: z.string().min(1, 'L\'intitulé du poste est requis').max(200),
  location: z.string().max(200),
  contractTypes: z.array(z.string()),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  notes: z.string().max(10000, 'Les notes sont trop longues (max 10000 car.)').nullable().optional(),
  // AVAIL : disponibilité saisie (texte libre court, ex. « début octobre 2026 »).
  availability: z.string().max(200, 'La disponibilité est trop longue (max 200 car.)').nullable().optional(),
  promptVariantB: z.string().max(5000, 'La variante B est trop longue (max 5000 car.)').nullable().optional(),
  // CV-MULTI : CV choisi pour la campagne (id ou null).
  cvId: z.string().nullable().optional(),
});

// Schéma pour les opérations sur un enregistrement unique.
export const IdSchema = z.object({ id: z.string().min(1, 'L\'identifiant est requis') });

export const CampaignIdSchema = z.object({
  campaignId: z.string().min(1, 'L\'identifiant de campagne est requis'),
});

// Schéma pour l'envoi d'une candidature. force=true : contourne le blocage anti-bounce
// des emails devinés (décision explicite depuis le bouton « Envoyer quand même »).
export const ApplicationSendSchema = z.object({ id: z.string().min(1), force: z.boolean().optional() });

export const ApplicationUpdateDraftSchema = z.object({
  id: z.string().min(1),
  subject: z.string().max(500, 'L\'objet est trop long (max 500 car.)'),
  body: z.string().max(50000, 'Le corps est trop long (max 50 000 car.)'),
});

export const ManualStatusSchema = z.object({
  id: z.string().min(1),
  manualStatus: z
    .enum(['INTERVIEWED', 'OFFER', 'REJECTED', 'ACCEPTED'])
    .nullable(),
});

export const FollowUpNoteSchema = z.object({
  id: z.string().min(1),
  note: z.string().max(10000, 'La note est trop longue (max 10 000 car.)'),
});

export const CampaignScheduleSchema = z.object({
  id: z.string().min(1),
  scheduledAt: z
    .string()
    .datetime({ message: 'Date de planification invalide' })
    .nullable()
    .refine(
      (d) => d === null || new Date(d) > new Date(),
      'La date de planification doit être dans le futur'
    ),
});

// Schéma de configuration SMTP.
export const SmtpSchema = z.object({
  host: z.string().min(1, 'L\'hôte SMTP est requis'),
  port: z.number().int().min(1).max(65535, 'Port invalide (1-65535)'),
  secure: z.boolean(),
  user: z.string().min(1, 'L\'utilisateur SMTP est requis'),
  pass: z.string().min(1, 'Le mot de passe SMTP est requis'),
});

export const ImapSchema = z.object({
  host: z.string().min(1, 'L\'hôte IMAP est requis'),
  port: z.number().int().min(1).max(65535, 'Port invalide (1-65535)'),
  secure: z.boolean(),
  user: z.string().min(1, 'L\'utilisateur IMAP est requis'),
  pass: z.string().min(1, 'Le mot de passe IMAP est requis'),
});

export const AiModelSchema = z.object({
  model: z.string().min(1, 'Le modèle est requis').max(100),
});

// Schéma pour l'intervalle de polling IMAP.
export const PollIntervalSchema = z.object({
  minutes: z.number().int().min(1, 'Intervalle min : 1 min').max(1440, 'Intervalle max : 24h'),
});

// MOD-05 : schéma de configuration DKIM.
export const DkimConfigSchema = z.object({
  domainName: z.string().min(1, 'Le nom de domaine est requis').max(255),
  keySelector: z.string().min(1, 'Le sélecteur est requis').max(63),
  privateKey: z.string().min(1, 'La clé privée est requise'),
});

// FM-05 : schéma de mise à jour du profil avec les nouveaux champs.
export const ProfileUpdateSchema = z.object({
  firstName: z.string().min(1, 'Le prénom est requis').max(100),
  lastName: z.string().min(1, 'Le nom est requis').max(100),
  emailSender: z.string().email('Adresse email invalide').nullable().optional(),
  phone: z.string().max(30, 'Téléphone trop long').nullable().optional(),
  linkedin: z.string().url('URL LinkedIn invalide').max(300).nullable().optional().or(z.literal('').transform(() => null)),
  portfolio: z.string().url('URL Portfolio invalide').max(300).nullable().optional().or(z.literal('').transform(() => null)),
  github: z.string().url('URL GitHub invalide').max(300).nullable().optional().or(z.literal('').transform(() => null)),
});

export const BulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(5000, 'Trop d\'éléments sélectionnés (max 5000)'),
});

export const CvParsedSchema = z.object({
  cvParsed: z.object({
    experiences: z.array(z.object({
      title: z.string(),
      company: z.string(),
      duration: z.string(),
    })).max(100),
    education: z.array(z.object({
      degree: z.string(),
      school: z.string(),
      year: z.string(),
    })).max(50),
    skills: z.array(z.string()).max(200),
    languages: z.array(z.string()).max(50),
  }),
});

// B3 : justificatif France Travail — bornes de période (format date natif) + plafond.
export const ReportRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de début invalide').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de fin invalide').optional(),
  detailCap: z.number().int().min(0).max(100000).optional(),
}).refine((v) => !v.from || !v.to || v.from <= v.to, {
  message: 'La date de début doit précéder la date de fin',
});

export const ApplicationListSchema = z.object({
  campaignId: z.string().min(1),
  page: z.number().int().min(0).optional(),
  pageSize: z.number().int().min(1).max(10000).optional(),
});

/**
 * Valide un payload et renvoie les données typées, ou lève une erreur avec un
 * message lisible par l'utilisateur si la validation échoue.
 */
export function validate<T>(schema: z.ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    // Retourner le premier message d'erreur — suffisamment précis pour l'UI.
    throw new Error(result.error.errors[0]?.message ?? 'Données invalides');
  }
  return result.data;
}
