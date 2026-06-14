import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from '@/lib/api';
import { useAuthStore } from '@/constants/authStore';
import { usePreferencesStore } from '@/stores/preferences.store';

/**
 * Rôle : Hook de gestion des notifications push (Expo).
 *
 * À l'authentification de l'utilisateur, il :
 *  1. demande la permission et récupère le token push Expo de l'appareil ;
 *  2. enregistre ce token côté API (pour que le back puisse notifier l'utilisateur) ;
 *  3. installe les listeners de réception / clic sur notification.
 */

// Définit comment afficher une notification reçue alors que l'app est ouverte.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | undefined>(undefined);
  // On ne déclenche l'enregistrement que pour un utilisateur connecté.
  const isAuthenticated = useAuthStore(state => !!state.accessToken);
  // Préférence utilisateur : les notifications sont-elles activées ?
  const notificationsEnabled = usePreferencesStore(state => state.notificationsEnabled);
  const prefsHydrated = usePreferencesStore(state => state.hasHydrated);

  useEffect(() => {
    // On attend la réhydratation de la préférence pour ne pas (dés)enregistrer
    // le token sur la base d'une valeur par défaut transitoire.
    if (!isAuthenticated || !prefsHydrated) return;

    if (!notificationsEnabled) {
      // Notifications désactivées : on retire le token côté serveur pour que
      // l'API cesse réellement d'envoyer des push (best effort).
      api.patch('/me', { pushToken: null }).catch(() => {});
      return;
    }

    registerForPushNotificationsAsync().then(token => {
      setExpoPushToken(token);
      if (token) {
        saveTokenToBackend(token);
      }
    });

    // Listener : notification reçue alors que l'app est au premier plan.
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      // Traitement éventuel de la notification reçue.
    });

    // Listener : l'utilisateur a cliqué sur une notification.
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      // Navigation éventuelle vers l'écran concerné.
    });

    // Nettoyage des listeners au démontage / changement d'état.
    return () => {
      notificationListener.remove();
      responseListener.remove();
    };
  }, [isAuthenticated, notificationsEnabled, prefsHydrated]);

  /** Envoie le token push à l'API pour l'associer au profil utilisateur. */
  async function saveTokenToBackend(token: string) {
    try {
      // Route de mise à jour du profil : /api/me (prefix '/api' + route '/me').
      await api.patch('/me', { pushToken: token });
    } catch (error) {
      console.warn('Failed to save push token:', error);
    }
  }

  return { expoPushToken };
}

/**
 * Demande la permission de notification et récupère le token push Expo.
 * Renvoie `undefined` si on est sur un émulateur ou si la permission est refusée.
 */
async function registerForPushNotificationsAsync() {
  let token;

  // Android exige la déclaration d'un canal de notification.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  // Les notifications push ne fonctionnent que sur un appareil physique.
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    // Si la permission n'a pas encore été accordée, on la demande.
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    // Permission refusée : pas de token.
    if (finalStatus !== 'granted') {
      return;
    }

    // projectId EAS, requis par Expo pour générer le token push.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;

    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (e) {
      console.warn('Error fetching push token', e);
    }
  }

  return token;
}
