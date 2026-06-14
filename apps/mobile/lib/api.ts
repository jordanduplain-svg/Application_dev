import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '@/constants/authStore';

import { Platform } from 'react-native';

// URL Dynamique via Expo Constants (fallback sur localhost/10.0.2.2 si non défini)
const API_URL = Constants.expoConfig?.extra?.apiUrl ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000/api' : 'http://127.0.0.1:3000/api');

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  // Indispensable pour que le cookie httpOnly `refreshToken` soit transmis
  // lors de l'appel à /auth/refresh (en particulier sur Expo Web).
  withCredentials: true,
});

// Intercepteur pour injecter le Token
api.interceptors.request.use(async (config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// --- Gestion du rafraîchissement du token d'accès ---
// Lorsqu'un 401 survient, on tente UN rafraîchissement via /auth/refresh.
// Si plusieurs requêtes échouent simultanément, on ne déclenche qu'un seul
// appel /refresh : les autres requêtes attendent son résultat dans cette file.
let isRefreshing = false;
let pendingQueue: Array<(token: string | null) => void> = [];

// Débloque toutes les requêtes en attente avec le nouveau token
// (ou `null` si le rafraîchissement a échoué).
function flushQueue(token: string | null) {
  pendingQueue.forEach((resolve) => resolve(token));
  pendingQueue = [];
}

// Intercepteur de réponse : rafraîchissement automatique sur 401
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (AxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // Cas non gérables ici (autre erreur qu'un 401, ou requête déjà retentée) :
    // on remonte une erreur formatée. L'API renvoie `{ error: '...' }`,
    // on lit donc bien `data.error` (et non `data.message`).
    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
      const message =
        (error.response?.data as any)?.error || 'Erreur réseau ou serveur';
      return Promise.reject(new Error(message));
    }

    // On marque la requête pour ne pas boucler indéfiniment sur les 401.
    originalRequest._retry = true;

    // Un rafraîchissement est déjà en cours : on met cette requête en attente
    // plutôt que de lancer un second appel /refresh concurrent.
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push((token) => {
          if (!token) {
            reject(error);
            return;
          }
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(api(originalRequest));
        });
      });
    }

    isRefreshing = true;
    try {
      // Appel /auth/refresh. Sur mobile natif, on envoie le refresh token dans
      // le corps (la persistance des cookies y est peu fiable) ; sur le web,
      // le cookie httpOnly sert aussi grâce à `withCredentials`.
      // On utilise `axios` directement (et non `api`) pour éviter de
      // re-déclencher cet intercepteur si /refresh renvoie lui-même un 401.
      const currentRefreshToken = useAuthStore.getState().refreshToken;
      const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(
        `${API_URL}/auth/refresh`,
        { refreshToken: currentRefreshToken },
        // `timeout` explicite : `axios` brut n'hérite PAS du timeout de
        // l'instance `api`. Sans lui, un /refresh qui ne répond jamais
        // laisserait `isRefreshing` bloqué et la file d'attente grossir sans fin.
        { withCredentials: true, timeout: 10000 }
      );

      const newToken = data.accessToken;
      // Rotation : on enregistre le nouvel access token ET le nouveau
      // refresh token renvoyés par le serveur.
      useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
      flushQueue(newToken);

      // On rejoue la requête initiale avec le nouveau token.
      originalRequest.headers = originalRequest.headers ?? {};
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      // Le rafraîchissement a échoué (refresh token expiré ou révoqué) :
      // on libère la file et on déconnecte proprement l'utilisateur.
      flushQueue(null);
      useAuthStore.getState().logout();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
