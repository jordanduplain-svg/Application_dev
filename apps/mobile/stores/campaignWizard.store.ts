import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Rôle : État global de l'assistant (wizard) de création de campagne.
 *
 * L'utilisateur remplit le formulaire en plusieurs étapes ; cet état est
 * persisté dans AsyncStorage pour survivre à une fermeture de l'app en cours
 * de saisie. Les données ne sont pas sensibles → AsyncStorage suffit
 * (contrairement au token d'auth qui, lui, va dans SecureStore).
 */

// Données saisies par l'utilisateur tout au long du wizard.
interface WizardData {
  name: string;
  jobTitle: string;
  location: string;
  contractTypes: string[];
  salaryMin?: number;
  salaryMax?: number;
  prompt: string;
  applicationQuota: number;
  cvFile?: {
    name: string;
    uri: string;
    size?: number;
  };
}

// État du store : étape courante, données, et actions de mise à jour.
interface WizardState {
  step: number;
  data: WizardData;
  setStep: (step: number) => void;
  setData: (data: Partial<WizardData>) => void;
  reset: () => void;
}

// Valeurs par défaut du formulaire à l'ouverture du wizard.
const initialData: WizardData = {
  name: '',
  jobTitle: '',
  location: '',
  contractTypes: ['CDI'],
  prompt: '',
  applicationQuota: 50,
};

export const useCampaignWizardStore = create<WizardState>()(
  persist(
    (set) => ({
      step: 1,
      data: initialData,
      // Change l'étape affichée du wizard.
      setStep: (step) => set({ step }),
      // Fusionne des champs partiels dans les données existantes.
      setData: (newData) => set((state) => ({ data: { ...state.data, ...newData } })),
      // Réinitialise le wizard (après création ou abandon de la campagne).
      reset: () => set({ step: 1, data: initialData }),
    }),
    {
      name: 'campaign-wizard-storage',
      storage: createJSONStorage(() => AsyncStorage), // Non-sensitive form data can live in AsyncStorage
    }
  )
);
