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
export const api = window.api;
