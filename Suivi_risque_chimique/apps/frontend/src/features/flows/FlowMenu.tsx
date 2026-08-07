import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type FlowDto, type FlowRunSummaryDto } from "../../lib/api";
import { useExclusiveOpen } from "../../lib/useExclusiveOpen";

/**
 * Panneau « Imports » (Admin / HSE) — sert la règle UX n°4 : l'état du système
 * est toujours visible. Montre les flux planifiés, leur dernier passage, et
 * permet un déclenchement manuel (« Lancer maintenant »).
 *
 * Visible uniquement pour les rôles habilités côté UI ; la sécurité reste
 * serveur (403 sinon). On ne rend rien pour les autres rôles.
 */

const MANAGER_ROLES = new Set(["ADMIN", "HSE"]);

const STATUS_TONE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  partial: "bg-amber-50 text-amber-700 ring-amber-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
};

const dateTimeFr = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function FlowMenu({ role, token }: { role: string; token: string }): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useExclusiveOpen();
  const [flows, setFlows] = useState<FlowDto[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<FlowRunSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api
      .flows(token)
      .then(setFlows)
      .catch(() => setError(t("flows.error")));
  }, [token, t]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (open && flows === null) refresh();
  }, [open, flows, refresh]);

  if (!MANAGER_ROLES.has(role)) return null;

  const run = async (id: string): Promise<void> => {
    setRunning(id);
    setError(null);
    setLastSummary(null);
    try {
      const summary = await api.runFlow(token, id);
      setLastSummary(summary);
      refresh();
    } catch {
      setError(t("flows.run_error"));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="pressable inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3.5V8l3 2M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("flows.button")}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{t("flows.title")}</p>
            <p className="mt-0.5 text-xs text-slate-500">{t("flows.subtitle")}</p>
          </div>

          {flows === null && <p className="px-4 py-4 text-sm text-slate-500">{t("flows.loading")}</p>}

          {flows?.map((flow) => (
            <div key={flow.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{flow.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-400">{flow.cronExpression}</p>
                </div>
                {flow.lastRunStatus !== null && (
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[flow.lastRunStatus] ?? ""}`}
                  >
                    {t(`flows.status.${flow.lastRunStatus}`)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t("flows.last_run", { date: dateTimeFr(flow.lastRunAt) })}
              </p>
              <button
                disabled={running !== null}
                onClick={() => void run(flow.id)}
                className="pressable mt-2 rounded-md bg-teal-700 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
              >
                {running === flow.id ? t("flows.running") : t("flows.run_now")}
              </button>
            </div>
          ))}

          {lastSummary !== null && (
            <div className="bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <p className="font-medium text-slate-700">{t("flows.summary_title")}</p>
              <ul className="mt-1 space-y-0.5">
                {lastSummary.sources.map((s) => (
                  <li key={s.sourceId}>
                    {s.name} — {t("flows.summary_line", {
                      created: s.created,
                      updated: s.updated,
                      unchanged: s.unchanged,
                      anomalies: s.anomalies,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error !== null && (
            <p role="alert" className="bg-red-50 px-4 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
