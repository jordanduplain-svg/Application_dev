import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type DepartureDto } from "../../lib/api";
import { useAuth } from "../../lib/auth";

/**
 * Rappel de conformité : travailleurs partis pour qui l'attestation
 * individuelle d'exposition doit être remise (décret 2024-307). Réservé aux
 * rôles habilités (le serveur renvoie 403 sinon → la bannière se masque).
 * Chaque ligne génère l'attestation à la demande (réutilise l'export individuel).
 */
const dateFr = (iso: string): string => new Date(iso).toLocaleDateString("fr-FR");

export function DeparturesBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const { token, call } = useAuth();
  const [list, setList] = useState<DepartureDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    call(api.departures)
      .then(setList)
      .catch(() => setList([]));
  }, [call]);

  if (list === null || list.length === 0) return null;

  const downloadAttestation = async (matricule: string): Promise<void> => {
    if (token === null) return;
    setBusy(matricule);
    try {
      const { blob, filename } = await api.exportFile(token, "individual", "pdf", matricule);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // erreur silencieuse : l'utilisateur peut réessayer
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-amber-800">
          {t("departures.banner", { count: list.length })}
        </span>
        <span aria-hidden="true" className="text-xs text-amber-700">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <ul className="mt-3 space-y-1.5">
          {list.map((w, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium text-slate-900">
                  {w.prenom} {w.nom}
                </span>
                <span className="ml-2 text-xs text-slate-500">
                  {t("departures.left_on", { date: dateFr(w.lastDeparture) })}
                </span>
              </span>
              {w.matricule !== null ? (
                <button
                  disabled={busy === w.matricule}
                  onClick={() => void downloadAttestation(w.matricule as string)}
                  className="pressable shrink-0 rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                >
                  {busy === w.matricule ? t("departures.generating") : t("departures.download")}
                </button>
              ) : (
                <span className="shrink-0 text-xs text-slate-400">
                  {t("departures.no_matricule")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
