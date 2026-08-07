import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, ApiError, type ImportRunDto } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AdminShell, StatusBadge } from "./AdminShell";

/**
 * Journal des imports (Admin / HSE) — « mon import est-il passé, et qu'est-ce
 * qui a été rejeté ? ». Lecture seule ; chaque run affiche ses compteurs et le
 * détail de ses anomalies (n° de ligne source pour corriger vite).
 */
export function ImportsPage(): JSX.Element {
  const { t } = useTranslation();
  const { call, logout } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<ImportRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call(api.imports)
      .then(setRuns)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof ApiError ? err.message : t("imports.error"));
      });
  }, [call, logout, navigate, t]);

  const fmt = (iso: string): string => new Date(iso).toLocaleString("fr-FR");

  return (
    <AdminShell title={t("imports.title")} subtitle={t("imports.subtitle")}>
      {error !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {runs !== null && runs.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {t("imports.empty")}
        </p>
      )}
      <div className="space-y-3">
        {runs?.map((run) => (
          <article key={run.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <StatusBadge status={run.status} />
                <span className="font-medium text-slate-900">{run.sourceLabel}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  {t(`sources.list_types.${run.listType}`, { defaultValue: run.listType })}
                </span>
              </div>
              <span className="tnum text-xs text-slate-400">{fmt(run.startedAt)}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {t("imports.counts", {
                read: run.rowsRead,
                created: run.created,
                updated: run.updated,
                unchanged: run.unchanged,
                anomalies: run.anomalies.length,
              })}
            </p>
            {run.anomalies.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-amber-700">
                  {t("imports.show_anomalies", { count: run.anomalies.length })}
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {run.anomalies.map((a, i) => (
                    <li key={i} className="rounded bg-amber-50/60 px-2 py-1">
                      {t("imports.anomaly_line", { row: a.rowNumber })} — {a.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
      </div>
    </AdminShell>
  );
}
