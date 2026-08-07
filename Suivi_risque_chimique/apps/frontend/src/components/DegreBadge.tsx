/**
 * Badge de degré d'exposition.
 *
 * Le degré est POLYMORPHE selon le client (échelle qualitative, score, texte
 * libre — décision de cadrage). On colore uniquement les libellés qualitatifs
 * usuels reconnus ; tout le reste (scores numériques dont l'échelle est
 * inconnue, libellés maison) reste neutre — colorer au hasard induirait en
 * erreur sur un sujet santé. Le rouge/ambre n'est jamais que RENFORCÉ par le
 * libellé : on ne dépend pas de la couleur seule (accessibilité).
 */
const LEVELS: Record<string, string> = {
  "faible": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  "modere": "bg-amber-50 text-amber-700 ring-amber-600/20",
  "moyen": "bg-amber-50 text-amber-700 ring-amber-600/20",
  "fort": "bg-red-50 text-red-700 ring-red-600/20",
  "eleve": "bg-red-50 text-red-700 ring-red-600/20",
  "tres fort": "bg-red-50 text-red-700 ring-red-600/20",
};

const normalize = (v: string): string =>
  v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function DegreBadge({ value }: { value: string | null }): JSX.Element {
  if (value === null) return <span className="text-slate-300">—</span>;
  const tone = LEVELS[normalize(value)] ?? "bg-slate-50 text-slate-600 ring-slate-500/15";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      {value}
    </span>
  );
}
