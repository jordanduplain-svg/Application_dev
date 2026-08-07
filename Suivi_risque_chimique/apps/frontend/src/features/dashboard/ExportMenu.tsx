import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { useExclusiveOpen } from "../../lib/useExclusiveOpen";

/**
 * Menu d'export réglementaire. N'affiche QUE les exports autorisés pour le
 * rôle — mais la sécurité reste serveur (le backend renvoie 403 sinon). Ici
 * c'est de l'ergonomie : ne pas proposer ce qui sera refusé.
 *
 * Le téléchargement passe par fetch authentifié (le jeton est en en-tête, pas
 * dans l'URL — pas de PII ni de secret dans l'historique de navigation), puis
 * un Blob déclenche l'enregistrement.
 */

type ExportType = "individual" | "cse_anonymized" | "spst_nominative";
type ExportFormat = "pdf" | "xlsx";

// « individual » n'apparaît ici QUE pour COLLABORATEUR : le serveur force
// alors sa propre fiche (aucune cible à choisir). Pour ADMIN/HSE/MEDECINE,
// l'export individuel exige un matricule cible — il se déclenche depuis la
// fiche d'une personne (PersonDrawer), pas depuis ce menu global.
const EXPORTS_BY_ROLE: Record<string, ExportType[]> = {
  ADMIN: ["spst_nominative", "cse_anonymized"],
  HSE: ["spst_nominative", "cse_anonymized"],
  MEDECINE: ["spst_nominative"],
  RH: ["cse_anonymized"],
  MANAGER: [],
  COLLABORATEUR: ["individual"],
};

export function ExportMenu({ role, token }: { role: string; token: string }): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useExclusiveOpen();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const available = EXPORTS_BY_ROLE[role] ?? [];
  if (available.length === 0) return null;

  const download = async (type: ExportType, format: ExportFormat): Promise<void> => {
    setBusy(`${type}:${format}`);
    setError(null);
    try {
      const { blob, filename } = await api.exportFile(token, type, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setError(t("export.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="pressable inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-600"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("export.button")}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {available.map((type) => (
            <div key={type} className="border-b border-slate-100 px-3.5 py-3 last:border-b-0">
              <p className="text-sm font-medium text-slate-900">{t(`export.types.${type}.label`)}</p>
              <p className="mt-0.5 text-xs text-slate-500">{t(`export.types.${type}.hint`)}</p>
              <div className="mt-2 flex gap-2">
                {(["pdf", "xlsx"] as const).map((format) => (
                  <button
                    key={format}
                    disabled={busy !== null}
                    onClick={() => void download(type, format)}
                    className="pressable rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-teal-600 hover:text-teal-700 disabled:opacity-50"
                  >
                    {busy === `${type}:${format}` ? t("export.generating") : format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {error !== null && (
            <p role="alert" className="bg-red-50 px-3.5 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
