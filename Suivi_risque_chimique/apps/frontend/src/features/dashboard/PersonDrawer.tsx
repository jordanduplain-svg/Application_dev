import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { DegreBadge } from "../../components/DegreBadge";
import { api, type DashboardRowDto } from "../../lib/api";

/**
 * Fiche individuelle — panneau latéral ouvert depuis une ligne du tableau.
 *
 * Aucune donnée supplémentaire n'est chargée : on regroupe les lignes DÉJÀ
 * reçues (donc déjà filtrées par le RBAC serveur) pour la personne choisie.
 * Écrit en langage humain (règle UX : la fiche se lit, elle ne se décode
 * pas).
 *
 * Export individuel : ADMIN/HSE/MEDECINE l'exportent d'ICI (le matricule
 * cible est connu), pas depuis le menu d'export global — le serveur exige un
 * matricule pour ce type d'export et n'en a pas de contexte là-bas.
 */

const EXPORT_ROLES = new Set(["ADMIN", "HSE", "MEDECINE"]);

const dateFr = (iso: string | null): string =>
  iso === null ? "" : new Date(iso).toLocaleDateString("fr-FR");

const duree = (annees: number): string =>
  annees < 0.1 ? "moins d'un mois" : `${annees.toFixed(1).replace(".", ",")} ans`;

/**
 * Exposition passée = la date de fin EFFECTIVE (la première des dates connues :
 * retrait du produit ou sortie de secteur) est révolue. Une date de fin
 * planifiée dans le futur ne rend pas l'exposition « passée ».
 */
const isExposurePast = (r: DashboardRowDto): boolean => {
  const ends = [r.dateRetrait, r.dateFinSecteur]
    .filter((iso): iso is string => iso !== null)
    .map((iso) => new Date(iso).getTime());
  return ends.length > 0 && Math.min(...ends) <= Date.now();
};

export interface PersonKey {
  nom: string;
  prenom: string;
  matricule: string | null;
}

export function PersonDrawer({
  person,
  rows,
  role,
  token,
  onClose,
}: {
  person: PersonKey;
  rows: DashboardRowDto[];
  role: string;
  token: string | null;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Les lignes de la personne, regroupées par secteur (affectation).
  const personRows = rows.filter(
    (r) => r.nom === person.nom && r.prenom === person.prenom && r.matricule === person.matricule,
  );
  const sectors = [...new Set(personRows.map((r) => r.codeSecteur))];

  // Export individuel : nécessite un matricule (identité stable) et un rôle
  // habilité à consulter la fiche d'un tiers (cf. exportPermissions.ts côté serveur).
  const canExport = token !== null && person.matricule !== null && EXPORT_ROLES.has(role);
  const downloadIndividual = async (format: "pdf" | "xlsx"): Promise<void> => {
    if (!canExport || token === null || person.matricule === null) return;
    setBusy(format);
    setExportError(null);
    try {
      const { blob, filename } = await api.exportFile(token, "individual", format, person.matricule);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(t("export.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t("drawer.title")}>
      <button
        aria-label={t("drawer.close")}
        onClick={onClose}
        className="overlay-enter absolute inset-0 cursor-default bg-slate-900/25"
      />
      <aside className="drawer-enter absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                {t("drawer.title")}
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                {person.prenom} {person.nom}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {personRows[0]?.fonction ?? ""}
                {person.matricule !== null && (
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500">
                    {person.matricule}
                  </span>
                )}
              </p>
              {person.matricule === null && (
                <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
                  {t("drawer.identity_warning")}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label={t("drawer.close")}
              className="pressable rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {EXPORT_ROLES.has(role) && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">{t("drawer.export_label")}</span>
              {(["pdf", "xlsx"] as const).map((format) => (
                <button
                  key={format}
                  disabled={!canExport || busy !== null}
                  title={person.matricule === null ? t("drawer.export_needs_matricule") : undefined}
                  onClick={() => void downloadIndividual(format)}
                  className="pressable rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-teal-600 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === format ? t("export.generating") : format.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {exportError !== null && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {exportError}
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {sectors.map((sector) => {
            const sectorRows = personRows.filter((r) => r.codeSecteur === sector);
            const first = sectorRows[0];
            return (
              <section key={sector} className="mb-7">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("drawer.sector", { sector })}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {first?.dateFinSecteur === null
                    ? t("drawer.since", { date: dateFr(first.dateDebutSecteur) })
                    : t("drawer.from_to", {
                        from: dateFr(first?.dateDebutSecteur ?? null),
                        to: dateFr(first?.dateFinSecteur ?? null),
                      })}
                </p>

                <ul className="mt-3 space-y-2.5">
                  {sectorRows.map((r) => (
                    <li
                      key={`${r.designation}`}
                      className="rounded-lg border border-slate-150 border-slate-200 p-3.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-900">{r.designation}</span>
                        <DegreBadge value={r.degreExposition} />
                      </div>
                      {r.mentionDanger !== null && (
                        <p className="mt-1 text-xs text-slate-500">{r.mentionDanger}</p>
                      )}
                      <p className="mt-2 text-sm text-slate-600">
                        {r.exposureAnomalies.length > 0 ? (
                          <span className="font-medium text-amber-700">
                            {t("drawer.anomaly_notice")}
                          </span>
                        ) : (
                          t(
                            isExposurePast(r) ? "drawer.exposure_past" : "drawer.exposure_ongoing",
                            { duration: duree(r.dureeExpositionAnnees) },
                          )
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <footer className="border-t border-slate-100 px-6 py-3">
          <p className="text-xs text-slate-400">{t("drawer.footer_note")}</p>
        </footer>
      </aside>
    </div>
  );
}
