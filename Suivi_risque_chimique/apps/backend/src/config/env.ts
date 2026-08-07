import { z } from "zod";

/** Traite une valeur d'env vide ("") comme absente avant validation. */
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return z.preprocess((v) => (v === "" ? undefined : v), schema) as unknown as z.ZodEffects<T>;
}

/**
 * Schéma de configuration d'environnement.
 *
 * Validé au démarrage : si une variable manque ou est invalide, l'app refuse de démarrer
 * plutôt que d'échouer à la première requête.
 *
 * Pourquoi un refus dur sur JWT_SECRET laissé à la valeur d'exemple : un déploiement
 * avec un secret par défaut est une vulnérabilité critique (impersonation
 * d'utilisateurs). On préfère planter au démarrage que livrer une faille.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BACKEND_PORT: z.coerce.number().int().positive().default(3001),
  // Une ou plusieurs origines autorisées (CORS), séparées par des virgules.
  FRONTEND_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .refine(
      (v) => v.split(",").every((o) => /^https?:\/\/[^\s,]+$/.test(o.trim())),
      "FRONTEND_ORIGIN doit être une liste d'URLs http(s) séparées par des virgules",
    ),

  DATABASE_URL: z.string().min(1, "DATABASE_URL est obligatoire"),

  // "local" : auth gérée par l'app (email/password + argon2 + JWT), zéro dépendance externe.
  // "oidc"  : délégué à un fournisseur OpenID Connect choisi et hébergé par l'utilisateur
  //           (Keycloak, Authentik, Zitadel… ou tout autre OIDC compatible).
  AUTH_PROVIDER: z.enum(["local", "oidc"]).default("local"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET doit faire au moins 32 caractères")
    .refine((v) => !v.startsWith("replace_me"), {
      message: "JWT_SECRET utilise la valeur d'exemple — refusé.",
    }),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  // `.env` contient souvent `OIDC_ISSUER_URL=` (clé présente, valeur vide) :
  // une chaîne vide doit être traitée comme « non renseigné », pas comme une
  // URL invalide.
  OIDC_ISSUER_URL: emptyAsUndefined(z.string().url().optional()),
  OIDC_CLIENT_ID: emptyAsUndefined(z.string().optional()),
  OIDC_CLIENT_SECRET: emptyAsUndefined(z.string().optional()),
  OIDC_REDIRECT_URI: emptyAsUndefined(z.string().url().optional()),

  // Connecteur SharePoint (Microsoft Graph, app-only / client credentials).
  // Mêmes valeurs que l'app Entra OIDC possibles. Optionnel : absent =
  // connecteur SharePoint indisponible.
  SHAREPOINT_TENANT_ID: emptyAsUndefined(z.string().optional()),
  SHAREPOINT_CLIENT_ID: emptyAsUndefined(z.string().optional()),
  SHAREPOINT_CLIENT_SECRET: emptyAsUndefined(z.string().optional()),

  // Chiffrement au repos : DÉLÉGUÉ AU DÉPLOIEMENT (volume chiffré / Postgres
  // TDE), cf. README. Variable OPTIONNELLE et non utilisée par l'app au MVP —
  // réservée pour un éventuel chiffrement applicatif des champs plus tard. Si
  // une valeur est fournie, on refuse quand même l'exemple (un secret bidon en
  // prod = faux sentiment de sécurité).
  FIELD_ENCRYPTION_KEY: emptyAsUndefined(
    z
      .string()
      .refine((v) => !v.startsWith("replace_me"), {
        message: "FIELD_ENCRYPTION_KEY utilise la valeur d'exemple — refusé.",
      })
      .optional(),
  ),

  // Mode « tout-en-un » : l'application démarre elle-même un PostgreSQL
  // embarqué (binaire natif, sans Docker ni installation) puis applique les
  // migrations avant de servir. Activé aussi par l'option CLI `--embedded`.
  // Laisser à false pour pointer vers un PostgreSQL externe (prod entreprise,
  // ou base lancée à part via `pnpm db:embedded` en dev watch).
  DB_EMBEDDED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  K_ANONYMITY_THRESHOLD: z.coerce.number().int().min(1).default(5),
  DATA_RETENTION_YEARS: z.coerce.number().int().min(0).default(40),

  // Dossier où sont stockés les fichiers importés via l'UI (Excel/CSV). Les
  // sources persistées y pointent ; le scheduler les relit depuis là. Doit être
  // un volume durable en production. Aucune donnée réelle n'y est commitée
  // (cf. .gitignore). Les chemins fournis par le client sont confinés à ce
  // dossier côté serveur (anti path-traversal).
  UPLOADS_DIR: z.string().default("./var/uploads"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration d'environnement invalide :\n${issues}`);
  }
  if (parsed.data.AUTH_PROVIDER === "oidc") {
    const missing = (["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const).filter(
      (k) => !parsed.data[k],
    );
    if (missing.length > 0) {
      throw new Error(`AUTH_PROVIDER=oidc mais variables manquantes : ${missing.join(", ")}`);
    }
  }
  return parsed.data;
}
