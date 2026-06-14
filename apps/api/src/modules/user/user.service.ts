import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../middleware/error';
import { deleteFromR2 } from '../../lib/storage';
import { logger } from '../../lib/logger';

/**
 * Champs du profil qu'un utilisateur est autorisé à modifier lui-même.
 * Doit rester synchronisé avec le schéma Zod `updateProfileSchema` de user.routes.ts.
 */
interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  // `null` autorisé : efface le token push (notifications désactivées).
  pushToken?: string | null;
}

export class UserService {
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailSender: true,
        cvUrl: true,
        cvParsed: true,
        plan: true,
        createdAt: true,
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    return user;
  }

  /**
   * Met à jour le profil de l'utilisateur.
   * `data` est typé en liste blanche (et non `any`) : seuls ces champs peuvent
   * être modifiés. Le filtrage réel est garanti par le schéma Zod `.strict()`
   * de la route, ce type empêche en plus toute régression côté code.
   * On renvoie un `select` explicite pour ne jamais exposer `passwordHash`
   * ni `smtpConfig` (config SMTP chiffrée) dans la réponse.
   */
  async updateProfile(userId: string, data: UpdateProfileData) {
    return prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailSender: true,
        cvUrl: true,
        cvParsed: true,
        plan: true,
        createdAt: true,
      },
    });
  }

  async updateCVParsed(userId: string, cvParsed: any) {
    return prisma.user.update({
      where: { id: userId },
      data: { cvParsed },
    });
  }

  /**
   * Enregistre l'URL du CV uploadé.
   * Appelé dès la réception du fichier (avant l'analyse asynchrone) pour que
   * le profil reflète immédiatement « CV importé ».
   */
  async updateCvUrl(userId: string, cvUrl: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { cvUrl },
    });
  }

  /**
   * Enregistre la configuration du compte d'envoi d'emails.
   * `smtpConfig` contient déjà le mot de passe chiffré (cf. user.routes.ts) ;
   * `emailSender` est l'adresse d'expédition affichée dans les emails.
   */
  async updateSmtpConfig(userId: string, smtpConfig: any, emailSender: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { smtpConfig, emailSender },
      select: { id: true, emailSender: true },
    });
  }

  /**
   * Export RGPD (S3) : renvoie l'ensemble des données personnelles de
   * l'utilisateur, dans un format JSON portable (droit à la portabilité).
   *
   * On exclut volontairement `passwordHash` et `smtpConfig` : ce sont des
   * secrets (hash et identifiants chiffrés), pas des « données personnelles »
   * exploitables — les inclure créerait un risque sans valeur pour l'usager.
   */
  async exportData(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailSender: true,
        cvUrl: true,
        cvParsed: true,
        plan: true,
        tosAcceptedAt: true,
        tosVersion: true,
        createdAt: true,
        campaigns: {
          orderBy: { createdAt: 'desc' },
          include: { applications: { orderBy: { createdAt: 'desc' } } },
        },
        invoices: { orderBy: { issuedAt: 'desc' } },
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return { exportedAt: new Date().toISOString(), data: user };
  }

  /**
   * Suppression définitive du compte (S3 — droit à l'effacement).
   *
   * Ordre imposé par les clés étrangères : candidatures → campagnes/factures →
   * jetons → utilisateur. On exécute le tout dans une transaction pour qu'un
   * échec en cours de route ne laisse pas le compte dans un état incohérent.
   * Le fichier CV est supprimé du stockage AVANT (best effort) : même s'il
   * subsiste, la suppression du compte doit aboutir.
   */
  async deleteAccount(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, cvUrl: true },
    });
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Suppression du CV (best effort — ne bloque pas l'effacement du compte).
    if (user.cvUrl) {
      try {
        await deleteFromR2(user.cvUrl);
      } catch (err) {
        logger.error({ err, userId }, '[RGPD] Échec suppression du fichier CV');
      }
    }

    await prisma.$transaction([
      prisma.application.deleteMany({ where: { campaign: { userId } } }),
      prisma.invoice.deleteMany({ where: { userId } }),
      prisma.campaign.deleteMany({ where: { userId } }),
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    return { success: true };
  }
}
