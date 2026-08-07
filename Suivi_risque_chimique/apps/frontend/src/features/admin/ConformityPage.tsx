import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  api,
  ApiError,
  type ConformitySummaryDto,
  type JoinAnomalyDto,
  type PurgeResultDto,
  type TransmissionDto,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AdminShell } from "./AdminShell";

const dateFr = (iso: string): string => new Date(iso).toLocaleDateString("fr-FR");

/**
 * Hub Conformité : synthèse « êtes-vous à jour ? » (1.2), transmissions au SPST
 * tracées (1.4), qualité des données (1.3), purge de rétention (1.5, Admin).
 */
export function ConformityPage(): JSX.Element {
  const { t } = useTranslation();
  const { user, token, call, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "ADMIN";

  const [summary, setSummary] = useState<ConformitySummaryDto | null>(null);
  const [anomalies, setAnomalies] = useState<JoinAnomalyDto[]>([]);
  const [transmissions, setTransmissions] = useState<TransmissionDto[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [purge, setPurge] = useState<PurgeResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onAuthError = (err: unknown): void => {
    if (err instanceof ApiError && err.status === 401) {
      logout();
      navigate("/login", { replace: true });
      return;
    }
    setError(err instanceof ApiError ? err.message : t("conformity.error"));
  };

  const reload = (): void => {
    call(api.conformity).then(setSummary).catch(onAuthError);
    call(api.dataQuality).then(setAnomalies).catch(() => undefined);
    call(api.transmissions).then(setTransmissions).catch(() => undefined);
  };
  useEffect(reload, [call]); // eslint-disable-line react-hooks/exhaustive-deps

  const record = async (): Promise<void> => {
    if (token === null || summary === null) return;
    setBusy(true);
    setError(null);
    try {
      await call((tk) =>
        api.recordTransmission(tk, {
          rowCount: summary.cmrExposedWorkers,
          ...(note.trim() !== "" ? { note: note.trim() } : {}),
        }),
      );
      setNote("");
      reload();
    } catch (err) {
      onAuthError(err);
    } finally {
      setBusy(false);
    }
  };

  const runPurge = async (execute: boolean): Promise<void> => {
    if (execute && !window.confirm(t("conformity.purge_confirm"))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call((tk) => api.purge(tk, execute));
      setPurge(r);
      if (execute) reload();
    } catch (err) {
      onAuthError(err);
    } finally {
      setBusy(false);
    }
  };

  const purgeTotal = purge !== null ? purge.personnel + purge.risques + purge.degres : 0;

  return (
    <AdminShell title={t("conformity.title")} subtitle={t("conformity.subtitle")}>
      {error !== null && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* 1.2 — Synthèse */}
      {summary !== null && (
        <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi
            label={t("conformity.last_transmission")}
            value={summary.lastTransmission !== null ? dateFr(summary.lastTransmission.at) : t("conformity.never")}
            tone={summary.lastTransmission !== null ? "ok" : "warn"}
          />
          <Kpi
            label={t("conformity.departures_pending")}
            value={String(summary.departuresPending)}
            tone={summary.departuresPending > 0 ? "warn" : "ok"}
          />
          <Kpi label={t("conformity.cmr_products")} value={String(summary.cmrProducts)} tone="neutral" />
          <Kpi label={t("conformity.cmr_workers")} value={String(summary.cmrExposedWorkers)} tone="neutral" />
          <Kpi
            label={t("conformity.anomalies")}
            value={String(summary.joinAnomalies)}
            tone={summary.joinAnomalies > 0 ? "warn" : "ok"}
          />
        </section>
      )}

      {/* 1.4 — Transmissions SPST */}
      <Panel title={t("conformity.transmissions_title")} hint={t("conformity.transmissions_hint")}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("conformity.transmission_note")}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
          />
          <button
            onClick={() => void record()}
            disabled={busy || summary === null}
            className="pressable rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {t("conformity.record_transmission")}
          </button>
        </div>
        {transmissions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">{t("conformity.no_transmission")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {transmissions.map((tr) => (
              <li key={tr.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-slate-700">
                  {dateFr(tr.at)} · {t("conformity.row_count", { count: tr.rowCount })}
                  {tr.note !== null && <span className="ml-2 text-slate-400">— {tr.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* 1.3 — Qualité des données */}
      <Panel title={t("conformity.quality_title")} hint={t("conformity.quality_hint")}>
        {anomalies.length === 0 ? (
          <p className="text-sm text-emerald-700">{t("conformity.no_anomaly")}</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {anomalies.map((a, i) => (
              <li key={i} className="rounded-lg bg-amber-50/60 px-3 py-2 text-slate-700">
                <span className="font-mono text-amber-700">{a.code}</span>
                <span className="ml-2 text-slate-400">[{a.codeSecteur}]</span> {a.message}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* 1.5 — Rétention (Admin) */}
      {isAdmin && (
        <Panel title={t("conformity.retention_title")} hint={t("conformity.retention_hint")}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void runPurge(false)}
              disabled={busy}
              className="pressable rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
            >
              {t("conformity.purge_simulate")}
            </button>
            <button
              onClick={() => void runPurge(true)}
              disabled={busy || purge === null || purgeTotal === 0}
              className="pressable rounded-lg border border-red-300 px-3.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {t("conformity.purge_execute")}
            </button>
          </div>
          {purge !== null && (
            <p className="mt-3 text-sm text-slate-600">
              {t("conformity.purge_result", {
                count: purgeTotal,
                cutoff: dateFr(purge.cutoff),
              })}
            </p>
          )}
        </Panel>
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
  value: string;
  tone: "ok" | "warn" | "neutral";
}): JSX.Element {
  const toneClass =
    tone === "warn"
      ? "text-amber-700"
      : tone === "ok"
        ? "text-emerald-700"
        : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <p className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{label}</p>
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-500">{hint}</p>
      {children}
    </section>
  );
}
