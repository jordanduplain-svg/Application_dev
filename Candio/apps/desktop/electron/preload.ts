import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, IpcRequests, IpcEvents } from '@candio/shared';

/**
 * Pont sécurisé entre le renderer (UI) et le process principal.
 *
 * Le renderer n'a JAMAIS accès direct à Node, à la base ou au réseau :
 * tout passe par les deux fonctions exposées ici (`invoke`, `on`), strictement
 * typées par le contrat IPC partagé.
 */
const api = {
  // Appel requête/réponse (renderer → principal). Le rest typé permet
  // d'omettre l'argument quand le canal n'a pas de payload (req = void).
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcRequests[C]['req'] extends void ? [] : [IpcRequests[C]['req']]
  ): Promise<IpcRequests[C]['res']> {
    return ipcRenderer.invoke(channel, args[0]) as Promise<IpcRequests[C]['res']>;
  },

  // Abonnement à un événement poussé par le principal. Renvoie une fonction
  // de désabonnement, à appeler dans la cleanup d'un useEffect.
  on<E extends keyof IpcEvents>(event: E, listener: (data: IpcEvents[E]) => void): () => void {
    const handler = (_e: unknown, data: IpcEvents[E]) => listener(data);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

// Type exporté pour que le renderer puisse déclarer `window.api`.
export type DesktopApi = typeof api;
