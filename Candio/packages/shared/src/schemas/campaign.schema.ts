import { z } from 'zod';

// Schéma de base (ZodObject) : sert à dériver les schémas create et update.
const campaignFields = z
  .object({
    name: z.string().min(2),
    prompt: z.string().min(10), // User's natural language research criteria
    jobTitle: z.string().min(2),
    location: z.string().min(2),
    contractTypes: z.array(z.string()).min(1),
    // Bornes (M-F) : le salaire est stocké dans une colonne INTEGER Postgres
    // (max ~2,1 milliards). On plafonne très en deçà pour exclure tout
    // dépassement d'entier (qui ferait échouer la création en base).
    salaryMin: z.number().int().min(0).max(10_000_000).optional(),
    salaryMax: z.number().int().min(0).max(10_000_000).optional(),
    // Quota borné : un quota non plafonné permettrait, via un appel API direct,
    // de demander des millions de candidatures et d'épuiser la base / les workers.
    applicationQuota: z.number().int().min(1).max(1000),
  })
  .strict();

// Cohérence de la fourchette (L-A) : le minimum ne peut pas dépasser le maximum.
const salaryOrderCheck = (d: { salaryMin?: number; salaryMax?: number }) =>
  d.salaryMin == null || d.salaryMax == null || d.salaryMin <= d.salaryMax;
const salaryOrderError = {
  message: 'Le salaire minimum ne peut pas dépasser le maximum',
  path: ['salaryMax'],
};

export const createCampaignSchema = campaignFields.refine(salaryOrderCheck, salaryOrderError);

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = campaignFields
  .partial()
  .strict()
  .refine(salaryOrderCheck, salaryOrderError);

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
