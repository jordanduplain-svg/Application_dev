import { Stack } from 'expo-router';

/**
 * Layout du groupe de routes d'authentification (connexion / inscription).
 * En-têtes masqués : ces écrans gèrent leur propre mise en page.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ title: 'Connexion' }} />
      <Stack.Screen name="register" options={{ title: 'Inscription' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Mot de passe oublié' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Réinitialisation' }} />
    </Stack>
  );
}
