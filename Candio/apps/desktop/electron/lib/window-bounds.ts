import { screen, type Rectangle } from 'electron';

/**
 * Bornes de fenêtre ajustées à l'écran.
 *
 * Largeur/hauteur plafonnées à la zone de travail de l'écran cible (l'écran
 * principal, ou celui qui contient `near` — typiquement la fenêtre actuellement
 * au premier plan), puis fenêtre centrée. Évite qu'une fenêtre s'ouvre plus
 * grande que l'écran ou hors champ (souci Windows multi-écrans / mise à
 * l'échelle DPI). Partagé par toutes les fenêtres de l'app.
 */
export function fitToWorkArea(
  desiredWidth: number,
  desiredHeight: number,
  near?: Rectangle,
): { x: number; y: number; width: number; height: number } {
  const wa = (near ? screen.getDisplayMatching(near) : screen.getPrimaryDisplay()).workArea;
  const width = Math.min(desiredWidth, wa.width);
  const height = Math.min(desiredHeight, wa.height);
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height,
  };
}
