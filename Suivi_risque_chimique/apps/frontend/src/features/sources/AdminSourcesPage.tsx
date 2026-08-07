import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, ApiError, type SourceDto, type SourceSchemaDto } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { SourceWizard } from "./SourceWizard";

/**
 * Espace « Administration des données » — liste des sources d'import et accès
 * au wizard de configuration. Réservé ADMIN/HSE : un autre rôle reçoit 403 du
 * serveur (l'UI redirige alors vers le tableau de bord).
 */

const MANAGER_ROLES = new Set(["ADMIN", "HSE"]);

export function AdminSourcesPage(): JSX.Element {
  const { t } = useTranslation();
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();

  const [schema, setSchema] = useState<SourceSchemaDto | null>(null);
  const [sources, setSources] = useState<SourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{ editing: SourceDto | null } | null>(null);

  const allowed = user !== null && MANAGER_ROLES.has(user.role);

  const refresh = useCallback(() => {
    if (token === null) return;
    api
      .listSources(token)
      .then(setSources)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          navigate("/", { replace: true });
          return;
        }
        setError(err instanceof ApiError ? err.message : t("sources.error_generic"));
      });
  }, [token, navigate, t]);

  useEffect(() => {
    if (token === null || !allowed) return;
    api.sourceSchema(token).then(setSchema).catch(() => setError(t("sources.error_generic")));
    refresh();
  }, [token, allowed, refresh, t]);

  const remove = async (id: string): Promise<void> => {
    if (token === null) return;
    try {
      await api.deleteSource(token, id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sources.error_generic"));
    }
  };

  const toggleEnabled = async (s: SourceDto): Promise<void> => {
    if (token === null) return;
    try {
      // PUT sans fileToken : on conserve le fichier déjà rattaché.
      await api.updateSource(token, s.id, {
        name: s.name,
        listType: s.listType,
        connectorType: s.connectorType,
        ...(s.sheet !== null ? { sheet: s.sheet } : {}),
        columns: s.columns,
        ...(s.rules.length > 0 ? { rules: s.rules } : {}),
        enabled: !s.enabled,
      });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sources.error_generic"));
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="pressable inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("sources.back_to_dashboard")}
            </button>
            <span className="h-4 w-px bg-slate-200" />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">
              {t("sources.title")}
            </span>
          </div>
          <button
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
            className="pressable rounded-md px-3 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            {t("nav.logout")}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-screen-xl px-6 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t("sources.heading")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("sources.subtitle")}</p>
          </div>
          <button
            disabled={schema === null}
            onClick={() => setWizard({ editing: null })}
            className="pressable rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-600 disabled:opacity-50"
          >
            {t("sources.new_source")}
          </button>
        </div>

        {error !== null && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-600/10">
            {error}
          </p>
        )}

        {sources !== null && sources.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-sm text-slate-500">{t("sources.empty")}</p>
          </div>
        )}

        {sources !== null && sources.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2.5">{t("sources.col_name")}</th>
                  <th className="px-4 py-2.5">{t("sources.col_list")}</th>
                  <th className="px-4 py-2.5">{t("sources.col_connector")}</th>
                  <th className="px-4 py-2.5">{t("sources.col_status")}</th>
                  <th className="px-4 py-2.5 text-right">{t("sources.col_actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sources.map((s) => (
                  <tr key={s.id} className="transition-colors hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                    <td className="px-4 py-3 text-slate-600">{t(`sources.list_types.${s.listType}`)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                        {s.connectorType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void toggleEnabled(s)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                          s.enabled
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 hover:bg-emerald-100"
                            : "bg-slate-100 text-slate-500 ring-slate-300 hover:bg-slate-200"
                        }`}
                      >
                        {s.enabled ? t("sources.enabled") : t("sources.disabled")}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setWizard({ editing: s })}
                        className="pressable rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
                      >
                        {t("sources.edit")}
                      </button>
                      <button
                        onClick={() => void remove(s.id)}
                        className="pressable ml-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                      >
                        {t("sources.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {wizard !== null && schema !== null && token !== null && (
        <SourceWizard
          token={token}
          schema={schema}
          editing={wizard.editing}
          onClose={() => setWizard(null)}
          onSaved={() => {
            setWizard(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}
