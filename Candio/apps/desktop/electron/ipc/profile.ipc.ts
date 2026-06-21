import { handle } from './registry';
import * as profileService from '../../src/modules/profile/profile.service';
import { assertEmail, assertNonEmpty } from '../../src/lib/validation';
import { validate, ProfileUpdateSchema } from './validation';

// CV-MULTI : la gestion du CV a été déplacée dans cv.ipc.ts (plusieurs CV nommés,
// choisis par campagne). Le profil ne gère plus que l'identité + les coordonnées.

/** Handlers IPC du domaine Profil. */
export function registerProfileHandlers(): void {
  handle('profile:get', () => profileService.getProfile());

  handle('profile:update', async (input) => {
    // FM-05 : valider avec le schéma étendu (phone, linkedin, portfolio).
    const data = validate(ProfileUpdateSchema, input);
    // H6 : valider l'email avant persistance.
    assertNonEmpty(data.firstName, 'Prénom');
    assertNonEmpty(data.lastName, 'Nom');
    if (data.emailSender) {
      assertEmail(data.emailSender, 'Adresse d\'envoi');
    }
    return profileService.updateProfile({
      firstName: data.firstName,
      lastName: data.lastName,
      emailSender: data.emailSender ?? null,
      phone: data.phone,
      linkedin: data.linkedin,
      portfolio: data.portfolio,
      github: data.github,
    });
  });
}
