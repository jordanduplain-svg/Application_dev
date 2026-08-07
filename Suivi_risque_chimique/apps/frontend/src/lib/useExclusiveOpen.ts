import { useEffect, useRef, useState } from "react";

/**
 * État « ouvert » d'un menu déroulant, exclusif entre tous les menus de la
 * page : ouvrir l'un ferme automatiquement les autres (barre de navigation
 * avec plusieurs menus indépendants — sans ça, plusieurs restent ouverts en
 * même temps).
 *
 * Important : fermer les autres composants doit se faire EN DEHORS de tout
 * updater de `setState` (jamais imbriqué dans un `setOpenState(prev => …)`) —
 * React interdit de déclencher le setState d'un autre composant pendant le
 * rendu d'un composant, ce qui se produit si l'appel est nesté dans un
 * updater fonctionnel. On calcule donc la valeur AVANT, via une ref, puis on
 * notifie les autres, puis on met à jour son propre état.
 */
const listeners = new Set<() => void>();

export function useExclusiveOpen(): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const closeSelf = useRef(() => setOpenState(false));

  useEffect(() => {
    const close = closeSelf.current;
    listeners.add(close);
    return () => {
      listeners.delete(close);
    };
  }, []);

  const setOpen = (next: boolean | ((prev: boolean) => boolean)): void => {
    const value = typeof next === "function" ? next(openRef.current) : next;
    if (value) {
      for (const close of listeners) if (close !== closeSelf.current) close();
    }
    setOpenState(value);
  };

  return [open, setOpen];
}
