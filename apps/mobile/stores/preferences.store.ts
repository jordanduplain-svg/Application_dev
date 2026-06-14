import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Rôle : Préférences utilisateur de l'app (non sensibles), persistées.
 *
 * Pour l'instant : activation des notifications push. La valeur est lue par
 * `useNotifications` (enregistrement/retrait du token push) et pilotée par le
 * commutateur de l'écran Profil.
 */
interface PreferencesState {
  notificationsEnabled: boolean;
  // `true` une fois la valeur relue depuis AsyncStorage. Tant qu'il est
  // `false`, on ne connaît pas encore la préférence réelle.
  hasHydrated: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  setHasHydrated: (value: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      notificationsEnabled: true,
      hasHydrated: false,
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'preferences-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // On ne persiste que la préférence ; `hasHydrated` est recalculé au démarrage.
      partialize: (state) => ({ notificationsEnabled: state.notificationsEnabled }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
