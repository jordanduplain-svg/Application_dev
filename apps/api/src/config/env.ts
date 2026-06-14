import { z } from 'zod';
import * as dotenv from 'dotenv';
import path from 'path';

/**
 * Rôle : Validation centralisée des variables d'environnement au démarrage
 */

// On remonte à la racine du monorepo pour trouver le fichier .env
const envPath = process.env.NODE_ENV === 'test' 
  ? path.resolve(__dirname, '../../.env.test') 
  : path.resolve(__dirname, '../../../../.env');

dotenv.config({ path: envPath });

// En production, les secrets ne doivent JAMAIS retomber sur une valeur par
// défaut : un défaut codé en clair dans le dépôt permettrait, par exemple, de
// forger des JWT et d'usurper n'importe quel compte. `secret()` n'autorise donc
// la valeur de repli (pratique en dev) que hors production.
const isProd = process.env.NODE_ENV === 'production';
const secret = (devDefault: string, min = 32) =>
  isProd ? z.string().min(min) : z.string().min(min).default(devDefault);

// Comme `secret()`, mais sans contrainte de longueur : pour les clés d'API
// tierces (OpenAI, Stripe). OBLIGATOIRES en production — pas de valeur de
// repli, sinon le service démarrerait avec une clé factice (échecs silencieux).
const apiKey = (devDefault: string) =>
  isProd ? z.string().min(1) : z.string().min(1).default(devDefault);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  // DATABASE_URL : OBLIGATOIRE et sans valeur par défaut. Un défaut « localhost »
  // masquerait une mauvaise configuration en production (l'API démarrerait
  // puis échouerait silencieusement à se connecter). Ici, l'absence de la
  // variable provoque un arrêt immédiat (fail-fast) au démarrage.
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  // Secret cryptographique : obligatoire en production (cf. `secret()`).
  // NB : le refresh token n'est PAS un JWT (secret aléatoire hashé en base) —
  // il n'y a donc pas de `JWT_REFRESH_SECRET`.
  JWT_ACCESS_SECRET: secret('your-super-secret-access-key-min-32-chars-dev'),
  // Clés d'API tierces : obligatoires en production (pas de repli factice).
  OPENAI_API_KEY: apiKey('sk-test'),
  // La clé est dérivée en 32 octets via SHA-256 (cf. lib/crypto.ts) : sa
  // longueur exacte n'a plus d'importance, on impose juste un minimum.
  ENCRYPTION_KEY: secret('your-32-char-aes-256-key-is-here', 16),
  STRIPE_SECRET_KEY: apiKey('sk_test_1234'),
  STRIPE_WEBHOOK_SECRET: apiKey('whsec_1234'),
  SENTRY_DSN: z.string().url().optional(),
  // URL publique de l'API : sert à construire l'URL absolue du pixel de
  // tracking inséré dans les emails. OBLIGATOIRE en production — un repli sur
  // `localhost` y rendrait le pixel injoignable (tracking silencieusement HS).
  API_URL: isProd
    ? z.string().url()
    : z.string().url().default('http://localhost:3000'),
  // Email transactionnel (réinitialisation de mot de passe, etc.).
  // Optionnel : sans clé Resend, le mailer bascule en mode "log" (le contenu
  // de l'email est écrit dans les logs) — pratique en développement.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Candio <noreply@candio.app>'),
  // Origines navigateur autorisées par le CORS (liste séparée par des virgules).
  // Les apps mobiles natives n'envoient pas d'en-tête Origin et ne sont donc pas concernées.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081,http://localhost:19006,http://127.0.0.1:8081'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;
