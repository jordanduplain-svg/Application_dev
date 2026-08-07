import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, ApiError, type AuditEventDto } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AdminShell } from "./AdminShell";

/**
 * Journal d'accès (Admin) — qui a consulté/exporté quoi. Traçabilité RGPD
 * consultable. Le `detail` ne contient que des compteurs et identifiants
 * techniques (jamais de PII salarié) — on l'affiche tel quel.
 */
export function AuditPage(): JSX.Element {
  const { t } = useTranslation();
  const { call, logout } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<AuditEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call(api.audit)
      .then(setEvents)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof ApiError ? err.message : t("audit.error"));
      });
  }, [call, logout, navigate, t]);

  const fmt = (iso: string): string => new Date(iso).toLocaleString("fr-FR");

  return (
    <AdminShell title={t("audit.title")} subtitle={t("audit.subtitle")}>
      {error !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {events !== null && events.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {t("audit.empty")}
        </p>
      )}
      {events !== null && events.length > 0 && (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
                <th scope="col" className="px-3 py-2.5">{t("audit.col_at")}</th>
                <th scope="col" className="px-3 py-2.5">{t("audit.col_action")}</th>
                <th scope="col" className="px-3 py-2.5">{t("audit.col_user")}</th>
                <th scope="col" className="px-3 py-2.5">{t("audit.col_detail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-slate-500">{fmt(e.at)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{e.action}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{e.userId ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {e.detail !== null ? JSON.stringify(e.detail) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
