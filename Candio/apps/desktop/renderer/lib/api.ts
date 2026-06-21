import type { DesktopApi } from '../../electron/preload';

// L'objet est exposé par preload.ts via contextBridge. On le déclare en global
// pour que TypeScript le voie sur `window.api`.
declare global {
  interface Window {
    api: DesktopApi;
  }
}

// Raccourci d'import : `import { api } from '../lib/api'` puis `api.invoke(…)`.
export const api = window.api;
