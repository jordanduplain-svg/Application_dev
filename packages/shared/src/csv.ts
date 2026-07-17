// Écriture CSV sûre pour les fichiers OUVERTS PAR UN HUMAIN dans un tableur.
//
// Deux protections combinées :
//  1. Échappement CSV standard (guillemets/virgules/sauts de ligne) — validité du format.
//  2. Garde anti-injection de formule : Excel/LibreOffice EXÉCUTENT une cellule qui commence
//     par = + - @ (ou tab / CR). Un nom d'entreprise scrapé « =HYPERLINK(...) » ou
//     « =cmd|'/c calc'!A1 » lancerait alors du code à l'ouverture. On neutralise en préfixant
//     d'une apostrophe (le tableur affiche le texte brut sans l'évaluer).
//
// ⚠️ À N'UTILISER QUE pour des exports destinés à un humain. NE PAS l'appliquer à un CSV
// relu par une machine (ex. master de leads round-trippé par le scraper Python) : la garde
// modifierait la donnée relue.
export function csvCell(value: string | null | undefined): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(fields: (string | null | undefined)[]): string {
  return fields.map(csvCell).join(',');
}
