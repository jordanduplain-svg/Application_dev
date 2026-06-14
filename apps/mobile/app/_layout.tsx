import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { useNotifications } from '@/hooks/useNotifications';
import 'react-native-reanimated';
import './global.css';

// Monitoring des crashs (Sentry) : activé uniquement si un DSN est fourni
// dans la config Expo (`expo.extra.sentryDsn`). Sans DSN, l'app fonctionne
// normalement sans monitoring.
const sentryDsn = Constants.expoConfig?.extra?.sentryDsn;
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn });
}

import { useAuthStore } from '@/constants/authStore';
import { useColorScheme } from '@/components/useColorScheme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Layout racine de l'application.
 * Rôles : chargement des polices, garde d'authentification (redirige selon
 * que l'utilisateur est connecté ou non), et mise en place des providers
 * globaux (React Query, thème, gestes, safe area).
 */

// Client React Query instancié hors du composant pour ne pas être recréé
// à chaque rendu.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 30, // 30 seconds
    },
  },
});

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  const segments = useSegments();
  const router = useRouter();
  const isAuthenticated = useAuthStore(state => !!state.accessToken);
  // Indique si l'état d'auth a fini d'être relu depuis SecureStore.
  const hasHydrated = useAuthStore(state => state.hasHydrated);
  useNotifications();

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // Garde d'authentification : surveille l'état de connexion et la route
  // courante, puis redirige en conséquence.
  useEffect(() => {
    // On attend que les polices ET la réhydratation du store soient prêtes :
    // sinon `accessToken` vaut `null` au premier rendu et un utilisateur déjà
    // connecté serait brièvement renvoyé vers l'écran de connexion.
    if (!loaded || !hasHydrated) return;

    // `(auth)` est le groupe de routes login/register.
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Non connecté hors de l'espace d'auth → on renvoie vers la connexion.
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Connecté mais encore sur un écran d'auth → on entre dans l'app.
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, segments, loaded, hasHydrated]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="campaign/wizard" options={{ title: 'Nouvelle Campagne', presentation: 'card' }} />
              {/* Détail de campagne et facturation : en-tête géré par l'écran. */}
              <Stack.Screen name="campaign/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="settings/billing" options={{ headerShown: false }} />
              {/* Écrans de retour de paiement (sans en-tête, plein écran). */}
              <Stack.Screen name="campaign/payment-success" options={{ headerShown: false }} />
              <Stack.Screen name="campaign/payment-cancel" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
            </Stack>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

export default RootLayout;
