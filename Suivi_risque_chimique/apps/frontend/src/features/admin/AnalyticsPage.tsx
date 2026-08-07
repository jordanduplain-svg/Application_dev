import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, ApiError, type AnalyticsOverviewDto, type NamedCountDto } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AdminShell } from "./AdminShell";

/**
 * Vue data analyst : explorateur de modèle (tables + colonnes + volumes) et
 * tableaux de bord analytiques pré-construits (non nominatifs). Graphiques en
 * barres CSS — zéro dépendance.
 */
export function AnalyticsPage(): JSX.Element {
  const { t } = useTranslation();
  const { call, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<AnalyticsOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call(api.analytics)
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof ApiError ? err.message : t("analytics.error"));
      });
  }, [call, logout, navigate, t]);

  const a = data?.analytics;

  return (
    <AdminShell title={t("analytics.title")} subtitle={t("analytics.subtitle")}>
      {error !== null && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {data !== null && a !== undefined && (
        <>
          {/* KPI globaux */}
          <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label={t("analytics.workers")} value={a.totals.workers} />
            <Kpi label={t("analytics.products")} value={a.totals.products} />
            <Kpi label={t("analytics.exposures")} value={a.totals.exposures} />
            <Kpi label={t("analytics.cmr_products")} value={a.cmr.products} tone="warn" />
            <Kpi label={t("analytics.cmr_workers")} value={a.cmr.workers} tone="warn" />
          </section>

          {/* Graphiques */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={t("analytics.by_sector")} truncated={a.truncated.bySector}>
              <BarChart data={a.bySector} empty={t("analytics.empty")} />
            </Panel>
            <Panel title={t("analytics.by_product")} truncated={a.truncated.byProduct}>
              <BarChart data={a.byProduct} empty={t("analytics.empty")} />
            </Panel>
            <Panel title={t("analytics.by_degree")}>
              <BarChart data={a.byDegree} empty={t("analytics.empty")} tone="violet" />
            </Panel>
          </div>

          {/* Explorateur de modèle (5.1) */}
          <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-900">{t("analytics.model_title")}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {data.model.map((m) => (
              <div key={m.listType} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-900">
                  {t(`sources.list_types.${m.listType}`, { defaultValue: m.listType })}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{m.rowCount}</p>
                <p className="text-[11px] text-slate-500">{t("analytics.rows")}</p>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {m.columns.map((c) => (
                    <li
                      key={c.field}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                      title={c.required ? t("analytics.required") : undefined}
                    >
                      {c.label}
                      {c.required && <span className="text-red-500">*</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </AdminShell>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <p className={`text-xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{label}</p>
    </div>
  );
}

function Panel({
  title,
  truncated,
  children,
}: {
  title: string;
  truncated?: boolean;
  children: ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">
        {title}
        {truncated === true && (
          <span className="ml-2 text-[11px] font-normal text-slate-400">{t("analytics.top10")}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

function BarChart({
  data,
  empty,
  tone = "teal",
}: {
  data: NamedCountDto[];
  empty: string;
  tone?: "teal" | "violet";
}): JSX.Element {
  if (data.length === 0) return <p className="text-sm text-slate-400">{empty}</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  const bar = tone === "violet" ? "bg-violet-500/70" : "bg-teal-500/70";
  return (
    <ul className="space-y-1.5">
      {data.map((d) => (
        <li key={d.name} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate text-slate-600" title={d.name}>
            {d.name}
          </span>
          <span className="relative h-4 flex-1 overflow-hidden rounded bg-slate-100">
            <span
              className={`absolute inset-y-0 left-0 rounded ${bar}`}
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right tabular-nums text-slate-700">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}
