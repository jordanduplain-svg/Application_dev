import { toast } from 'sonner';
import type { DesktopApi } from '../../electron/preload';

// L'objet est exposé par preload.ts via contextBridge. On le déclare en global
// pour que TypeScript le voie sur `window.api`.
declare global {
  interface Window {
    api: DesktopApi;
  }
}

// ROUAGE du pont renderer→main : `window.api` est le SEUL canal du React vers Node.
// Il a été injecté par preload.ts (contextBridge) au démarrage de la fenêtre. Toute la
// communication passe par `api.invoke(canal, payload)` (requête/réponse typée) et
// `api.on(event, cb)` (push du main). Le renderer n'a aucun autre accès à Node/DB/réseau.
const raw = window.api;

// Filet d'erreur global : tout `invoke` rejeté → log console + toast utilisateur,
// puis on RE-LANCE l'erreur pour que les .catch() déjà présents gardent la main.
// Couvre d'un seul point les ~170 appels qui n'avaient aucun catch.
export const api: DesktopApi = {
  on: raw.on.bind(raw),
  invoke: ((channel: Parameters<DesktopApi['invoke']>[0], ...args: unknown[]) =>
    (raw.invoke as (...a: unknown[]) => Promise<unknown>)(channel, ...args).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ipc] ${channel} a échoué :`, err);
      toast.error(`Erreur : ${msg}`); // ponytail: message brut, suffit pour un outil perso
      throw err;
    })) as DesktopApi['invoke'],
};
