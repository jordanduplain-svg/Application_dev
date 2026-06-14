import { useColorScheme as useColorSchemeCore } from 'react-native';

/**
 * Renvoie le thème de couleurs courant ('light' ou 'dark').
 * Encapsule le hook natif de React Native pour fournir une valeur de repli.
 */
export const useColorScheme = (): 'light' | 'dark' => {
  const coreScheme = useColorSchemeCore();
  // Le hook natif peut renvoyer `null`/`undefined` (thème indéterminé) :
  // on retombe alors sur le thème clair pour toujours fournir une clé valide
  // à la palette `Colors`.
  return coreScheme ?? 'light';
};
