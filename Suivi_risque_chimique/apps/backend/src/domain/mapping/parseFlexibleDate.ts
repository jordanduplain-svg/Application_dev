/**
 * Parser de dates tolérant aux formats réels des fichiers d'entreprise.
 *
 * Décision de cadrage : les fichiers RH/HSE réels mélangent ISO (2024-01-15),
 * format français (15/01/2024), numéros de série Excel (45123) et parfois de
 * vrais objets Date (cellules typées date lues par exceljs). On parse tout ça,
 * on stocke en interne en UTC, et tout ce qui est ambigu ou non parsable
 * devient une ANOMALIE — jamais une valeur devinée.
 *
 * Choix assumés :
 *  - Format FR = JJ/MM/AAAA strictement. On REFUSE de deviner MM/JJ/AAAA
 *    (format US) : si jour <= 12 et mois <= 12 l'ambiguïté est invisible, et
 *    une date d'exposition fausse de plusieurs mois est inacceptable. Le
 *    produit cible des entreprises françaises ; si un client US arrive, le
 *    format attendu deviendra un paramètre de la config d'import.
 *  - Les dates sont interprétées à MINUIT UTC. On ne veut aucun décalage de
 *    fuseau : une date métier (entrée dans un secteur) est un jour calendaire,
 *    pas un instant.
 *  - Série Excel : nombre de jours depuis le 30/12/1899 (epoch Windows/1900 du
 *    format xlsx, bug "1900 bissextile" inclus dans cette convention).
 *    PIÈGE ÉVITÉ : une cellule contenant l'année nue « 2024 » serait, lue
 *    comme série, le 16/07/1905 — faux en silence. On n'accepte donc les
 *    séries QUE dans la fenêtre [18264 ; 73415] (1950-01-01 à 2100-12-31) :
 *    aucune année nue (≤ 9999) ne peut s'y glisser, et la fenêtre couvre
 *    largement toute date d'emploi réaliste (traçabilité 40 ans comprise).
 *    Tout nombre hors fenêtre → anomalie, charge à l'utilisateur de corriger.
 */

export type FlexibleDateResult =
  | { ok: true; date: Date }
  | { ok: false; reason: "empty" | "unparseable" | "out_of_range" };

/** Epoch du système de dates Excel : 30 décembre 1899 UTC. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Bornes de plausibilité pour une date métier (traçabilité 40 ans). */
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/**
 * Fenêtre d'acceptation des séries Excel : 1950-01-01 à 2100-12-31.
 * Volontairement plus étroite que MIN/MAX_YEAR — cf. « PIÈGE ÉVITÉ » ci-dessus.
 */
const MIN_EXCEL_SERIAL = 18264;
const MAX_EXCEL_SERIAL = 73415;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const FR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function buildUtcDate(year: number, month: number, day: number): FlexibleDateResult {
  if (year < MIN_YEAR || year > MAX_YEAR) return { ok: false, reason: "out_of_range" };
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejet des dates "recalées" par JS (ex. 31/02 devient 03/03) : si les
  // composantes relues ne correspondent pas, la date d'origine était invalide.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, reason: "unparseable" };
  }
  return { ok: true, date };
}

export function parseFlexibleDate(value: unknown): FlexibleDateResult {
  // --- Cellule vide / null : ce n'est PAS une erreur ici. Les champs date
  // nullables (date_fin_secteur, date_retrait) sont légitimes à vide ; c'est
  // le mapper qui décide si l'absence est permise pour un champ donné.
  if (value === null || value === undefined) return { ok: false, reason: "empty" };

  // --- Déjà une Date (exceljs lit les cellules typées date en Date JS).
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ok: false, reason: "unparseable" };
    // Re-projection à minuit UTC : on ne garde que le jour calendaire.
    return buildUtcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  // --- Numéro de série Excel (fenêtre restreinte, cf. en-tête).
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, reason: "unparseable" };
    const serial = Math.floor(value);
    if (serial < MIN_EXCEL_SERIAL || serial > MAX_EXCEL_SERIAL) {
      return { ok: false, reason: "out_of_range" };
    }
    const d = new Date(EXCEL_EPOCH_MS + serial * MS_PER_DAY);
    return {
      ok: true,
      date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    };
  }

  if (typeof value !== "string") return { ok: false, reason: "unparseable" };

  const text = value.trim();
  if (text === "") return { ok: false, reason: "empty" };

  const iso = ISO_DATE.exec(text);
  if (iso) {
    return buildUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const fr = FR_DATE.exec(text);
  if (fr) {
    return buildUtcDate(Number(fr[3]), Number(fr[2]), Number(fr[1]));
  }

  // Chaîne numérique pure ("45123") : série Excel exportée en texte.
  if (/^\d{4,6}$/.test(text)) {
    return parseFlexibleDate(Number(text));
  }

  return { ok: false, reason: "unparseable" };
}
