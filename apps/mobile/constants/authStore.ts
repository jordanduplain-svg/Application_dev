import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

/**
 * Rôle : État global d'authentification, persisté de façon sécurisée.
 *
 * Les tokens sont stockés dans Expo SecureStore (chiffré par l'OS).
 * Le `refreshToken` y est conservé car, sur mobile natif, la persistance des
 * cookies httpOnly est peu fiable : on l'envoie donc explicitement à /refresh.
 */

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  // `true` une fois la réhydratation depuis SecureStore terminée. Tant qu'il
  // est `false`, on ne connaît pas encore l'état réel de connexion : la garde
  // d'authentification (_layout.tsx) doit attendre avant de rediriger.
  hasHydrated: boolean;
  // Connexion/inscription : enregistre l'utilisateur et les deux tokens.
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  // Après un /refresh réussi : met à jour les deux tokens (rotation).
  setTokens: (accessToken: string, refreshToken: string) => void;
  setHasHydrated: (value: boolean) => void;
  logout: () => void;
}

// Stockage personnalisé basé sur Expo SecureStore (chiffré).
const secureStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await SecureStore.getItemAsync(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await SecureStore.deleteItemAsync(name);
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hasHydrated: false,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: 'auth-secure-storage',
      storage: createJSONStorage(() => secureStorage),
      // On ne persiste que les données réellement utiles (pas `hasHydrated`,
      // qui est un état d'exécution recalculé à chaque démarrage).
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      // Appelé une fois la lecture du stockage terminée.
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
